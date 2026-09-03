import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RemoteInvoice, RemotePrice, RemoteSubscription } from '@propectai/types';
import type { Prisma } from '@prisma/client';

import { PrismaSistemaService } from '../prisma/prisma-sistema.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderFactory } from './providers/payment-provider.factory';

/**
 * Marcador de suspensão automática.
 *
 * Existe para que a reativação por pagamento **não desfaça uma suspensão
 * manual**. Sem ele, um tenant suspenso por abuso voltaria sozinho no dia em
 * que a fatura fosse paga — e ninguém entenderia por quê.
 */
const MOTIVO_INADIMPLENCIA = 'billing:inadimplencia';

/**
 * ## O tenant deste serviço nem sempre existe quando a chamada começa
 *
 * Duas portas de entrada, com naturezas opostas:
 *
 * - `criarCheckout` e `abrirPortal` vêm de uma requisição autenticada. O
 *   tenant é conhecido antes da primeira consulta, e o `comTenant` cobre tudo.
 *
 * - `receberWebhook` vem do **provedor de pagamento**. Não há sessão, não há
 *   `tenantId` no caminho da chamada: ele é *descoberto* dentro, lendo
 *   `metadata.tenantId` ou procurando por `stripeCustomerId`. É o quinto
 *   caminho legitimamente sem tenant declarado do projeto, e o único em que a
 *   descoberta é a própria operação.
 *
 * A forma que isso impõe: **descobrir fora, escrever dentro**. Assim que o
 * `tenantId` existe, as escritas com escopo de tenant entram num bloco.
 *
 * ### O que isto revela sobre a tabela `tenants`
 *
 * As buscas de descoberta varrem `tenants` **sem** saber o tenant — é
 * literalmente o que elas estão tentando responder. Se um dia a tabela
 * `tenants` ganhar política de RLS (`id = current_setting(...)`), estas duas
 * consultas passam a devolver zero linhas, e todo webhook do produto quebra:
 * a política exige a resposta que a consulta existe para descobrir.
 *
 * Ou `tenants` fica sem política, ou a descoberta roda como `propectai_sistema`.
 * Está registrado no PLANO-RLS como decisão pendente de schema — não é algo
 * que a fase A resolva embrulhando chamada.
 *
 * Delegates com escopo de tenant aqui: `membership`, `auditLog`,
 * `subscription`, `invoice` — oito chamadas. `plan` e `billingEvent` são
 * catálogo e log do provedor, globais, e ficam de fora por não terem
 * `tenantId` para política nenhuma filtrar.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sistema: PrismaSistemaService,
    private readonly providers: PaymentProviderFactory,
    private readonly config: ConfigService,
  ) {}

  private get provider() {
    return this.providers.get();
  }

  private url(caminho: string): string {
    // Mesma variavel do CORS. Duas variaveis para o mesmo endereco divergiriam
    // no primeiro deploy, e a que ficasse errada mandaria o cliente de volta
    // para um dominio que nao existe depois de pagar.
    const base = this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3100';
    return `${base.replace(/\/$/, '')}${caminho}`;
  }

  // ---------------------------------------------------------------- compra

  /**
   * Abre o checkout de um plano.
   *
   * A moeda vem do tenant, não do plano: o mesmo plano é vendido em BRL, USD
   * e EUR sob um único `stripePriceId` (§10.2). Pedir uma moeda que o preço
   * não oferece é erro de configuração e falha aqui, com mensagem — bem antes
   * de o cliente ver uma tela de pagamento quebrada.
   *
   * Dois blocos: a criação da sessão no provedor é I/O externo e fica entre
   * eles. Mesma razão de `outreach.generate` — segurar uma conexão do pool
   * durante uma chamada de rede de segundos é o que o `timeout` de 10 s do
   * `comTenant` existe para impedir.
   */
  async criarCheckout(tenantId: string, planCode: string): Promise<{ url: string }> {
    const { tenant, plan, dono } = await this.prisma.comTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const plan = await tx.plan.findUnique({ where: { code: planCode } });

      /**
       * O `Promise.all` saiu daqui.
       *
       * Dentro de uma transação interativa do Prisma tudo corre numa conexão
       * só, então o paralelismo era aparente — as duas consultas já seriam
       * serializadas. Escrevê-las em sequência diz a verdade sobre o que
       * acontece. Medido: 12 consultas soltas 13,3 ms, num bloco 37,4 ms;
       * aqui são duas leituras baratas.
       */
      const dono = await tx.membership.findFirst({
        where: { tenantId, role: 'OWNER' },
        include: { user: { select: { email: true } } },
      });

      return { tenant, plan, dono };
    });

    if (!plan) throw new NotFoundException('Plano não encontrado');
    if (!plan.isActive) throw new BadRequestException('Plano indisponível');
    if (!plan.stripePriceId) {
      throw new BadRequestException(
        'Este plano não tem preço configurado no provedor de pagamento',
      );
    }

    const moeda = tenant.currency || 'BRL';
    const precos = (plan.pricesByCurrency ?? {}) as Record<string, number>;

    if (Object.keys(precos).length > 0 && !(moeda in precos)) {
      throw new BadRequestException(
        `O plano ${plan.name} não é vendido em ${moeda}. Moedas disponíveis: ` +
          Object.keys(precos).join(', '),
      );
    }

    if (!dono) throw new BadRequestException('Workspace sem proprietário');

    // I/O externo — fora de qualquer transação, de propósito.
    const sessao = await this.provider.createCheckout({
      customerId: tenant.stripeCustomerId,
      email: dono.user.email,
      priceId: plan.stripePriceId,
      currency: moeda,
      successUrl: this.url('/settings/subscription?checkout=ok'),
      cancelUrl: this.url('/settings/subscription?checkout=cancelado'),
      taxId: tenant.taxId ? { type: 'unknown', value: tenant.taxId } : null,
      // O tenantId viaja com a assinatura para sempre. É o que liga um webhook
      // recebido daqui a um ano ao workspace certo.
      metadata: { tenantId, planCode },
    });

    await this.prisma.comTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          action: 'billing.checkout.created',
          entityType: 'Plan',
          entityId: plan.id,
          after: { planCode, currency: moeda },
        },
      }),
    );

    return { url: sessao.url };
  }

  /** Portal do provedor: trocar cartão, ver faturas, cancelar. */
  async abrirPortal(tenantId: string): Promise<{ url: string }> {
    const tenant = await this.prisma.comTenant(tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    );

    if (!tenant.stripeCustomerId) {
      throw new BadRequestException(
        'Este workspace ainda não tem assinatura paga — não há o que gerenciar',
      );
    }

    return this.provider.createPortalSession({
      customerId: tenant.stripeCustomerId,
      returnUrl: this.url('/settings/subscription'),
    });
  }

  // --------------------------------------------------------------- webhook

  /**
   * Recebe, verifica, grava e processa.
   *
   * A ordem importa: **gravar antes de processar**. Se o processamento falhar,
   * o evento continua no banco com `error` preenchido — visível, reprocessável,
   * não perdido. Processar primeiro e gravar depois perderia exatamente os
   * eventos que deram errado, que são os únicos que interessam.
   *
   * Falha de processamento **propaga**. O Stripe reentrega, e a chave única em
   * `externalId` torna a reentrega inofensiva — uma falha transitória de banco
   * se conserta sozinha. O custo é que erro permanente gera reentregas até o
   * Stripe desistir; por isso a linha com `error` preenchido e `processedAt`
   * nulo é fila de conserto manual, não decoração.
   *
   * **`billing_events` não entra em bloco nenhum.** A tabela não tem `tenantId`
   * — no momento em que a linha é gravada, ninguém ainda sabe de que tenant o
   * evento é. Colocá-la sob `comTenant` exigiria inventar um tenant antes de
   * descobri-lo, que é justamente a ordem que este método não pode ter.
   *
   * O `update` do `catch` roda **fora** da transação que falhou. Isso não é
   * detalhe: a transação abortada já foi desfeita e a conexão devolvida antes
   * de a promessa rejeitar, então o registro do erro pega conexão limpa. Se
   * estivesse dentro, o Postgres recusaria o comando (`25P02`) e o motivo da
   * falha se perderia — que é o mesmo defeito consertado em `devolverCota`.
   */
  async receberWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const verificado = this.provider.verifyWebhook(rawBody, signature);

    const registro = await this.prisma.billingEvent.upsert({
      where: {
        provider_externalId: {
          provider: this.provider.name,
          externalId: verificado.externalId,
        },
      },
      create: {
        provider: this.provider.name,
        externalId: verificado.externalId,
        type: verificado.type,
        payload: verificado.payload as never,
        attempts: 1,
      },
      update: { attempts: { increment: 1 } },
    });

    if (registro.processedAt) {
      this.logger.debug(`Evento ${verificado.externalId} já processado; ignorando`);
      return;
    }

    try {
      await this.processar(verificado.event);

      await this.prisma.billingEvent.update({
        where: { id: registro.id },
        data: { processedAt: new Date(), error: null },
      });
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);

      await this.prisma.billingEvent.update({
        where: { id: registro.id },
        data: { error: motivo },
      });

      this.logger.error(
        { externalId: verificado.externalId, type: verificado.type, motivo },
        'Falha ao processar webhook de cobrança',
      );

      throw error;
    }
  }

  private async processar(
    evento: Awaited<ReturnType<typeof this.provider.verifyWebhook>>['event'],
  ): Promise<void> {
    switch (evento.kind) {
      case 'SUBSCRIPTION_CHANGED': {
        // Relê a assinatura em vez de confiar no payload.
        //
        // O provedor não garante ordem de entrega, e um `updated` antigo
        // chegando depois de um `deleted` reativaria quem cancelou. Reler
        // custa uma chamada e elimina a classe inteira de bug de ordenação —
        // não há estado "anterior" a comparar, só o atual.
        const atual =
          (await this.provider.getSubscription(evento.subscription.externalId)) ??
          evento.subscription;

        await this.aplicarAssinatura(atual);
        return;
      }

      case 'PRICE_CHANGED':
        await this.aplicarPreco(evento.price);
        return;

      case 'INVOICE_CHANGED':
        await this.aplicarFatura(evento.invoice);
        return;

      case 'IGNORED':
        return;
    }
  }

  // ------------------------------------------------------------- aplicação

  /**
   * Espelha a assinatura remota no banco e ajusta o acesso.
   *
   * Regras em `docs/strategic/lacunas-estruturais.md` §10.3 e §10.4.
   *
   * Descoberta fora, escrita dentro. O `acharTenant` e a leitura do plano são
   * as duas consultas que **não podem** declarar tenant: uma procura o tenant,
   * a outra lê catálogo global.
   *
   * Do bloco para dentro, tudo o que antes eram quatro a seis escritas soltas
   * passa a ser uma só: espelhar a assinatura, gravar o `stripeCustomerId` e
   * suspender ou reativar o workspace agora vivem ou morrem juntos. Antes, uma
   * falha no meio deixava a assinatura atualizada e o acesso no estado
   * anterior — cliente pagante bloqueado, ou inadimplente com acesso.
   */
  private async aplicarAssinatura(remota: RemoteSubscription): Promise<void> {
    const tenantId = await this.acharTenant(remota);
    if (!tenantId) {
      throw new Error(
        `Assinatura ${remota.externalId} sem tenant identificável ` +
          '(metadata.tenantId ausente e nenhum tenant com este stripeCustomerId)',
      );
    }

    const plan = remota.priceId
      ? await this.prisma.plan.findUnique({ where: { stripePriceId: remota.priceId } })
      : null;

    const dados = {
      status: remota.status,
      currency: remota.currency,
      currentPeriodStart: remota.currentPeriodStart,
      currentPeriodEnd: remota.currentPeriodEnd,
      trialEndsAt: remota.trialEndsAt,
      cancelAtPeriodEnd: remota.cancelAtPeriodEnd,
      cancelledAt: remota.canceledAt,
      stripeSubscriptionId: remota.externalId,
      // Preço desconhecido não rebaixa o plano. Um preço criado no painel do
      // Stripe e ainda não espelhado aqui faria o cliente perder recursos que
      // acabou de comprar.
      ...(plan ? { planId: plan.id } : {}),
    };

    await this.prisma.comTenant(tenantId, async (tx) => {
      const assinatura = await tx.subscription.findUnique({ where: { tenantId } });

      if (assinatura) {
        await tx.subscription.update({ where: { tenantId }, data: dados });
      } else if (plan) {
        await tx.subscription.create({ data: { tenantId, planId: plan.id, ...dados } });
      } else {
        throw new Error(
          `Assinatura ${remota.externalId} referencia o preço ${remota.priceId}, ` +
            'que não corresponde a nenhum plano. Rode a sincronização de preços.',
        );
      }

      await tx.tenant.update({
        where: { id: tenantId },
        data: { stripeCustomerId: remota.customerId },
      });

      await this.ajustarAcesso(tx, tenantId, remota.status);
    });
  }

  /**
   * Suspende ou reativa conforme o estado da assinatura.
   *
   * `PAST_DUE` não suspende: é o provedor ainda tentando cobrar, e a causa
   * mais comum é cartão vencido. Suspender aí perderia cliente por um
   * problema que se resolve sozinho na segunda tentativa.
   *
   * Recebe o `tx` porque é sempre chamado de dentro de um bloco — mesma forma
   * de `assertNaoEUltimoDono` em `team.service.ts`. Abrir transação própria
   * aqui desfaria a atomicidade que o chamador acabou de estabelecer.
   */
  private async ajustarAcesso(
    tx: Prisma.TransactionClient,
    tenantId: string,
    status: string,
  ): Promise<void> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const inadimplente = status === 'UNPAID' || status === 'CANCELED';

    if (inadimplente && !tenant.suspendedAt) {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: new Date(), suspendedReason: MOTIVO_INADIMPLENCIA },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'billing.tenant.suspended',
          entityType: 'Tenant',
          entityId: tenantId,
          after: { status },
        },
      });

      this.logger.warn({ tenantId, status }, 'Workspace suspenso por inadimplência');
      return;
    }

    const ativo = status === 'ACTIVE' || status === 'TRIALING';

    // Só desfaz a suspensão que a cobrança criou. Suspensão manual — abuso,
    // pedido judicial, investigação — não é revogada por um pagamento.
    if (ativo && tenant.suspendedAt && tenant.suspendedReason === MOTIVO_INADIMPLENCIA) {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: null, suspendedReason: null },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'billing.tenant.reactivated',
          entityType: 'Tenant',
          entityId: tenantId,
          after: { status },
        },
      });

      this.logger.log({ tenantId }, 'Workspace reativado após pagamento');
    }
  }

  /**
   * **A consulta que não pode declarar tenant.**
   *
   * As duas leituras aqui varrem `tenants` sem saber o tenant — descobri-lo é
   * a própria função do método. Nenhuma delas entra em `comTenant`, e não é
   * omissão: uma política em `tenants` faria as duas devolverem zero linhas e
   * derrubaria todo webhook de cobrança do produto.
   *
   * Ver a nota no topo da classe.
   */
  private async acharTenant(remota: RemoteSubscription): Promise<string | null> {
    return this.sistema.atravessandoTenants(
      'achar o tenant a partir do webhook do Stripe: nao ha sessao, e o tenant e o resultado da busca',
      async (db) => {
        const pelosMetadados = remota.metadata?.tenantId;
        if (pelosMetadados) {
          const existe = await db.tenant.findUnique({
            where: { id: pelosMetadados },
            select: { id: true },
          });
          if (existe) return existe.id;
        }

        const pelaConta = await db.tenant.findUnique({
          where: { stripeCustomerId: remota.customerId },
          select: { id: true },
        });

        return pelaConta?.id ?? null;
      },
    );
  }

  // --------------------------------------------------------------- faturas

  /**
   * Espelha a fatura no banco.
   *
   * Sem efeito sobre o acesso, de propósito. Fatura recusada é o **começo** do
   * ciclo de tentativas do provedor, não o fim — suspender aqui cancelaria
   * cliente por cartão vencido. Quem decide acesso é a transição da assinatura
   * para `UNPAID`, que chega por `SUBSCRIPTION_CHANGED`.
   *
   * Upsert e não create: o mesmo `in_...` chega várias vezes ao longo da vida
   * da fatura — criada, emitida, tentada, paga. É a mesma fatura mudando de
   * estado, não quatro faturas.
   *
   * Mesma forma de `aplicarAssinatura`: a busca do tenant por
   * `stripeCustomerId` é descoberta e fica fora; o `upsert` da fatura, que tem
   * `tenantId`, entra no bloco.
   */
  private async aplicarFatura(fatura: RemoteInvoice): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { stripeCustomerId: fatura.customerId },
      select: { id: true },
    });

    if (!tenant) {
      // Acontece de verdade: o `invoice.created` do primeiro checkout pode
      // chegar antes de `customer.subscription.created`, que é o evento que
      // grava o `stripeCustomerId`. Lançar faz o provedor reentregar, e aí o
      // tenant já existe — é a ordenação se resolvendo sozinha pela repetição.
      throw new Error(
        `Fatura ${fatura.externalId} sem tenant para o cliente ${fatura.customerId}`,
      );
    }

    const dados = {
      tenantId: tenant.id,
      externalSubscriptionId: fatura.subscriptionId,
      status: fatura.status,
      amountCents: fatura.amountCents,
      amountPaidCents: fatura.amountPaidCents,
      currency: fatura.currency,
      periodStart: fatura.periodStart,
      periodEnd: fatura.periodEnd,
      dueDate: fatura.dueDate,
      paidAt: fatura.paidAt,
      attemptCount: fatura.attemptCount,
      hostedInvoiceUrl: fatura.hostedInvoiceUrl,
      pdfUrl: fatura.pdfUrl,
    };

    await this.prisma.comTenant(tenant.id, (tx) =>
      tx.invoice.upsert({
        where: {
          provider_externalId: {
            provider: this.provider.name,
            externalId: fatura.externalId,
          },
        },
        create: { provider: this.provider.name, externalId: fatura.externalId, ...dados },
        update: dados,
      }),
    );
  }

  // ---------------------------------------------------------------- preços

  /**
   * `plans` é catálogo global — não tem `tenantId`, nenhuma política vai
   * filtrá-la, e envolvê-la em `comTenant` só acrescentaria o custo da
   * transação sem trocar nada em segurança.
   */
  private async aplicarPreco(preco: RemotePrice): Promise<void> {
    const plan = await this.prisma.plan.findUnique({
      where: { stripePriceId: preco.externalId },
    });

    // Preço que não pertence a nenhum plano não é erro: a conta do Stripe pode
    // ter preços de outras coisas, e um preço criado agora ainda não foi
    // associado. Ignorar é o comportamento certo.
    if (!plan) return;

    await this.prisma.plan.update({
      where: { id: plan.id },
      data: {
        pricesByCurrency: preco.amountsByCurrency,
        // Mantém o par legado coerente para telas e seeds que ainda o usam.
        priceCents: preco.amountsByCurrency[plan.currency] ?? plan.priceCents,
      },
    });

    this.logger.log(
      { plan: plan.code, moedas: Object.keys(preco.amountsByCurrency) },
      'Cache de preços atualizado',
    );
  }

  /**
   * Puxa todos os preços do provedor de uma vez.
   *
   * Existe porque webhook perdido é normal — endpoint fora do ar, deploy no
   * momento errado — e sem uma reconciliação o cache diverge para sempre.
   * Chamada pelo painel do provedor e na subida da aplicação em produção.
   *
   * Não tem tenant nenhum: é operação de catálogo, disparada por administrador
   * ou pela subida do processo.
   */
  async sincronizarPrecos(): Promise<{ atualizados: number }> {
    if (!this.provider.configurado) return { atualizados: 0 };

    const precos = await this.provider.listPrices();
    let atualizados = 0;

    for (const preco of precos) {
      const antes = await this.prisma.plan.count({
        where: { stripePriceId: preco.externalId },
      });
      if (antes === 0) continue;

      await this.aplicarPreco(preco);
      atualizados += 1;
    }

    return { atualizados };
  }
}
