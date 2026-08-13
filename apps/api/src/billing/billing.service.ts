import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RemoteInvoice, RemotePrice, RemoteSubscription } from '@propectai/types';

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

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
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
   */
  async criarCheckout(tenantId: string, planCode: string): Promise<{ url: string }> {
    const [tenant, plan] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.prisma.plan.findUnique({ where: { code: planCode } }),
    ]);

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

    const dono = await this.prisma.membership.findFirst({
      where: { tenantId, role: 'OWNER' },
      include: { user: { select: { email: true } } },
    });

    if (!dono) throw new BadRequestException('Workspace sem proprietário');

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

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        action: 'billing.checkout.created',
        entityType: 'Plan',
        entityId: plan.id,
        after: { planCode, currency: moeda },
      },
    });

    return { url: sessao.url };
  }

  /** Portal do provedor: trocar cartão, ver faturas, cancelar. */
  async abrirPortal(tenantId: string): Promise<{ url: string }> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    });

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

    const assinatura = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

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

    if (assinatura) {
      await this.prisma.subscription.update({ where: { tenantId }, data: dados });
    } else if (plan) {
      await this.prisma.subscription.create({ data: { tenantId, planId: plan.id, ...dados } });
    } else {
      throw new Error(
        `Assinatura ${remota.externalId} referencia o preço ${remota.priceId}, ` +
          'que não corresponde a nenhum plano. Rode a sincronização de preços.',
      );
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeCustomerId: remota.customerId },
    });

    await this.ajustarAcesso(tenantId, remota.status);
  }

  /**
   * Suspende ou reativa conforme o estado da assinatura.
   *
   * `PAST_DUE` não suspende: é o provedor ainda tentando cobrar, e a causa
   * mais comum é cartão vencido. Suspender aí perderia cliente por um
   * problema que se resolve sozinho na segunda tentativa.
   */
  private async ajustarAcesso(tenantId: string, status: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const inadimplente = status === 'UNPAID' || status === 'CANCELED';

    if (inadimplente && !tenant.suspendedAt) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: new Date(), suspendedReason: MOTIVO_INADIMPLENCIA },
      });

      await this.prisma.auditLog.create({
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
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: null, suspendedReason: null },
      });

      await this.prisma.auditLog.create({
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

  private async acharTenant(remota: RemoteSubscription): Promise<string | null> {
    const pelosMetadados = remota.metadata?.tenantId;
    if (pelosMetadados) {
      const existe = await this.prisma.tenant.findUnique({
        where: { id: pelosMetadados },
        select: { id: true },
      });
      if (existe) return existe.id;
    }

    const pelaConta = await this.prisma.tenant.findUnique({
      where: { stripeCustomerId: remota.customerId },
      select: { id: true },
    });

    return pelaConta?.id ?? null;
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

    await this.prisma.invoice.upsert({
      where: {
        provider_externalId: {
          provider: this.provider.name,
          externalId: fatura.externalId,
        },
      },
      create: { provider: this.provider.name, externalId: fatura.externalId, ...dados },
      update: dados,
    });
  }

  // ---------------------------------------------------------------- preços

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
