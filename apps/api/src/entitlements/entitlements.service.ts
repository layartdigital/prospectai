import {
  ForbiddenException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { PlanLimits } from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';

export type Capability =
  | 'export.csv'
  | 'export.xlsx'
  | 'pipeline'
  | 'ai.outreach'
  | 'phone.full';

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
      this.cache.set(plano.code, plano.limits as unknown as PlanLimits);
    }
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

  /** Período de consumo do mês corrente, criado sob demanda. */
  async currentUsage(tenantId: string) {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    return this.prisma.planUsage.upsert({
      where: { tenantId_periodStart: { tenantId, periodStart } },
      create: { tenantId, periodStart, periodEnd },
      update: {},
    });
  }

  /**
   * Saldo de leads disponível.
   *
   * `reserved` conta o que está em voo; `settled` conta o que virou lead novo
   * de fato. Duplicado não entra em nenhum dos dois.
   */
  async availableLeadCredits(tenantId: string, planCode: string): Promise<number> {
    const usage = await this.currentUsage(tenantId);
    const included = this.limits(planCode).leadsIncluded;
    return Math.max(0, included - usage.leadsReserved - usage.leadsSettled);
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
