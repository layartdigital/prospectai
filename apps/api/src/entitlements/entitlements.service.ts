import {
  ForbiddenException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PlanLimits } from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';

export type Capability =
  | 'export.csv'
  | 'export.xlsx'
  | 'pipeline'
  | 'ai.outreach'
  | 'phone.full'
  | 'audit.run'
  | 'audit.export';

/**
 * Limites de quem não tem plano identificável.
 *
 * Acontece quando a assinatura aponta para um plano que o Master desativou, ou
 * quando o cache ainda não carregou. **O padrão é o mais restritivo possível**,
 * e não o do FREE: FREE é uma decisão comercial que pode mudar, isto é uma
 * rede de segurança. Errar para o lado generoso aqui significa entregar
 * recurso pago de graça sem ninguém perceber.
 */
const LIMITES_MINIMOS: PlanLimits = {
  leadsIncluded: 0,
  searchesPerMonth: 0,
  aiGenerationsPerMonth: 0,
  auditsPerMonth: 0,
  maxUsers: 1,
  exportFormats: [],
  retentionDays: 30,
  maskPhones: true,
  pipelineEnabled: false,
};

/** De quanto em quanto tempo o cache se atualiza sozinho. */
const INTERVALO_RECARGA_MS = 60_000;

/**
 * Ponto único de verificação de plano.
 *
 * Nenhum controller, serviço ou componente lê limite diretamente. Quando um
 * limite muda, muda aqui — e não em quinze lugares espalhados, que é como
 * um produto acaba mostrando "500 leads" numa tela e "150" na outra.
 *
 * ---------------------------------------------------------------------------
 * Os limites vêm do banco, não de constante compilada
 * ---------------------------------------------------------------------------
 *
 * Passo 2 de `docs/strategic/lacunas-estruturais.md` §11.1, e o passo que
 * decide se a mudança inteira serviu. Enquanto o gate lesse `PLAN_LIMITS`,
 * editar um limite na tela do Master não mudaria o comportamento do produto —
 * e tela que mente é pior que tela ausente.
 *
 * **Por que cache e não consulta a cada chamada.** `limits()` é síncrono e é
 * chamado no meio de laços — mascarar telefone roda uma vez por lead da
 * listagem. Torná-lo assíncrono transformaria uma decisão de arquitetura em
 * uma consulta por linha de tabela.
 *
 * O cache recarrega sozinho a cada minuto, o que resolve o caso de haver mais
 * de uma instância da API: quem editou o plano recarrega na hora, as demais
 * em até um minuto. Um minuto de defasagem num limite de plano não machuca
 * ninguém; uma consulta por lead, sim.
 */
@Injectable()
export class EntitlementsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EntitlementsService.name);
  private readonly cache = new Map<string, PlanLimits>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.recarregar();

    this.timer = setInterval(() => {
      void this.recarregar().catch((error: unknown) => {
        // Falha de recarga não derruba nada: o cache anterior continua válido.
        // Perder a atualização é bem menos grave que derrubar a API porque o
        // banco piscou.
        this.logger.warn(
          `Não foi possível recarregar os planos: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, INTERVALO_RECARGA_MS);

    // Sem isto o timer segura o processo vivo e o Jest não encerra.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Relê os planos do banco.
   *
   * Pública porque o CRUD de planos precisa chamá-la logo após gravar: esperar
   * o intervalo faria o operador editar um limite, recarregar a tela e ver o
   * valor antigo — e concluir que não salvou.
   */
  async recarregar(): Promise<void> {
    const planos = await this.prisma.plan.findMany({
      select: { code: true, limits: true },
    });

    this.cache.clear();
    for (const plano of planos) {
      this.cache.set(plano.code, this.normalizar(plano.code, plano.limits));
    }
  }

  /**
   * Completa o que faltar com o limite mínimo, e avisa alto.
   *
   * `Plan.limits` é JSON, e `as unknown as PlanLimits` é uma afirmação sem
   * prova: um plano gravado antes de um limite novo existir simplesmente não
   * tem a chave, e o tipo diz que tem. Sem esta etapa, `limits.auditsPerMonth`
   * seria `undefined` no meio de uma comparação numérica, e cada ponto de
   * leitura precisaria do seu próprio `?? 0` — quinze defesas em vez de uma.
   *
   * O padrão é o mínimo, nunca o do FREE, pela mesma razão do
   * `LIMITES_MINIMOS`: errar para o lado generoso entrega recurso pago de
   * graça sem dar sinal.
   *
   * **O aviso não é opcional.** Um plano que perde limite em silêncio degrada
   * o produto para o cliente sem ninguém saber por quê — que é o modo de falha
   * que este arquivo inteiro existe para impedir.
   */
  private normalizar(code: string, bruto: unknown): PlanLimits {
    const parcial = (bruto ?? {}) as Partial<PlanLimits>;
    const faltando = (Object.keys(LIMITES_MINIMOS) as (keyof PlanLimits)[]).filter(
      (chave) => parcial[chave] === undefined,
    );

    if (faltando.length > 0) {
      this.logger.warn(
        `Plano "${code}" não tem ${faltando.join(', ')} em Plan.limits. ` +
          'Aplicando o mínimo nesses campos — rode `pnpm db:seed` para gravar ' +
          'os valores do catálogo.',
      );
    }

    return { ...LIMITES_MINIMOS, ...parcial };
  }

  limits(planCode: string): PlanLimits {
    const limites = this.cache.get(planCode);
    if (limites) return limites;

    // Não é situação normal. Logar alto importa: sem isto o cliente
    // simplesmente perderia recursos, abriria chamado, e o suporte procuraria
    // o problema no lugar errado.
    this.logger.error(
      `Plano "${planCode}" não encontrado no cache. Aplicando os limites ` +
        'mínimos — verifique se o plano foi desativado com assinatura ativa.',
    );

    return LIMITES_MINIMOS;
  }

  can(planCode: string, capability: Capability): boolean {
    const limits = this.limits(planCode);

    switch (capability) {
      case 'export.csv':
        return limits.exportFormats.includes('csv');
      case 'export.xlsx':
        return limits.exportFormats.includes('xlsx');
      case 'pipeline':
        return limits.pipelineEnabled;
      case 'ai.outreach':
        return limits.aiGenerationsPerMonth > 0;
      case 'phone.full':
        return !limits.maskPhones;
      case 'audit.run':
        return limits.auditsPerMonth > 0;
      case 'audit.export':
        // Separado de `audit.run` porque a Fase 4 pode restringir o PDF sem
        // restringir a auditoria — o gate precisa existir antes da regra.
        return limits.auditsPerMonth > 0;
      default:
        return false;
    }
  }

  /**
   * Lança apenas quando o usuário tentou explicitamente executar a ação.
   * Carregar uma página nunca deve chamar este método — é o que provoca
   * paywall abrindo sozinho.
   */
  assert(planCode: string, capability: Capability): void {
    if (!this.can(planCode, capability)) {
      throw new ForbiddenException({
        message: 'Recurso não disponível no seu plano',
        code: 'PLAN_LIMIT',
        capability,
        planCode,
      });
    }
  }

  /**
   * Período de consumo do mês corrente, criado sob demanda.
   *
   * ---------------------------------------------------------------------------
   * O `tx` opcional, e por que ele é opcional
   * ---------------------------------------------------------------------------
   *
   * `plan_usages` tem `tenantId`. Sob política de RLS, este `upsert` **precisa**
   * de contexto declarado, e até aqui ele não tinha nenhum: o serviço usa o
   * client próprio, e quem o chama de dentro de um `comTenant` não conseguia
   * emprestar a transação. Era o último caso especial de código da fase A.
   *
   * **O parâmetro é opcional, e os dois caminhos declaram contexto.** Não existe
   * ramo que rode sem — essa é a propriedade que importa:
   *
   *   - com `tx`, participa da transação de quem chamou, e a leitura do período
   *     fica atômica com a escrita que vem depois;
   *   - sem `tx`, abre bloco próprio.
   *
   * Obrigatório seria mais rígido e pior. Dos treze pontos de chamada, vários
   * são **portão de cota**: rodam antes de qualquer transação existir, para
   * decidir se a ação sequer começa — `createSearch` recusa a busca antes de
   * abrir bloco nenhum, e `outreach.quota` só responde uma pergunta. Forçá-los
   * a abrir transação para perguntar "posso?" inverteria a ordem do fluxo por
   * uma exigência de assinatura.
   *
   * O risco conhecido do opcional é alguém esquecer de passar o `tx` e ganhar
   * uma transação a mais em silêncio. Custa ~5 ms e nada de correção — é
   * exatamente o comportamento de hoje, então não é regressão; é o que deixa
   * de melhorar.
   */
  async currentUsage(tenantId: string, tx?: Prisma.TransactionClient) {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const upsert = (cliente: Prisma.TransactionClient) =>
      cliente.planUsage.upsert({
        where: { tenantId_periodStart: { tenantId, periodStart } },
        create: { tenantId, periodStart, periodEnd },
        update: {},
      });

    return tx ? upsert(tx) : this.prisma.comTenant(tenantId, upsert);
  }

  /**
   * Saldo de leads disponível.
   *
   * `reserved` conta o que está em voo; `settled` conta o que virou lead novo
   * de fato. Duplicado não entra em nenhum dos dois.
   */
  async availableLeadCredits(
    tenantId: string,
    planCode: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const usage = await this.currentUsage(tenantId, tx);
    const included = this.limits(planCode).leadsIncluded;
    return Math.max(0, included - usage.leadsReserved - usage.leadsSettled);
  }

  /**
   * Saldo de auditorias do periodo.
   *
   * Espelha `availableLeadCredits`, e a diferenca e que aqui nao ha reserva:
   * a auditoria e sob demanda e sincrona do ponto de vista da cota — conta ao
   * executar, nao ao enfileirar. Nao ha o caso "reservou e nao virou lead".
   */
  async availableAuditCredits(
    tenantId: string,
    planCode: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const usage = await this.currentUsage(tenantId, tx);
    const included = this.limits(planCode).auditsPerMonth;
    return Math.max(0, included - usage.auditsCount);
  }

  /** Mascara o telefone quando o plano exige: (11) ••••••-0924 */
  maskPhone(phone: string | null, planCode: string): string | null {
    if (!phone) return null;
    if (!this.limits(planCode).maskPhones) return phone;

    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6) return '••••••';

    const ddd = digits.slice(-11, -9) || digits.slice(0, 2);
    const last = digits.slice(-4);
    return `(${ddd}) ••••••-${last}`;
  }
}
