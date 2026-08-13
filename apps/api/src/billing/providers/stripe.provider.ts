import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BillingEvent,
  CheckoutInput,
  CheckoutSession,
  PaymentProvider,
  RemotePrice,
  RemoteSubscription,
  RemoteSubscriptionStatus,
  VerifiedWebhook,
} from '@propectai/types';
import Stripe from 'stripe';

/**
 * Implementação do `PaymentProvider` sobre o Stripe.
 *
 * **Este arquivo e o mock são os únicos que podem importar `stripe`.** Se o
 * SDK aparecer num service de domínio, a abstração vazou — e o dia de trocar
 * de gateway vira reescrita em vez de troca de uma linha de configuração.
 *
 * Tudo que sai daqui já é tipo nosso. Nenhum `Stripe.Subscription` atravessa
 * a fronteira.
 */
@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';

  private readonly logger = new Logger(StripePaymentProvider.name);
  private readonly client: Stripe | null;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim() ?? '';

    // `apiVersion` omitido de propósito: sem ele o SDK usa a versão contra a
    // qual foi compilado, e não a versão padrão da conta. Fixar no painel do
    // Stripe faria a API mudar sob os pés da aplicação sem nenhum deploy.
    this.client = key ? new Stripe(key) : null;
  }

  get configurado(): boolean {
    return this.client !== null;
  }

  private get stripe(): Stripe {
    if (!this.client) {
      throw new Error('STRIPE_SECRET_KEY ausente — cobrança não está configurada');
    }
    return this.client;
  }

  // ---------------------------------------------------------------- checkout

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      // `line_items` leva o id do preço, não o valor. É o que garante que
      // divergência de cache seja erro visual e nunca cobrança errada.
      line_items: [{ price: input.priceId, quantity: 1 }],
      currency: input.currency.toLowerCase(),
      ...(input.customerId
        ? { customer: input.customerId }
        : { customer_email: input.email, customer_creation: 'always' as const }),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // Metadados na assinatura, não só na sessão: a sessão é efêmera e some
      // dos eventos posteriores. Todo `customer.subscription.*` que chegar daqui
      // a um ano ainda vai carregar o tenantId.
      subscription_data: { metadata: input.metadata },
      metadata: input.metadata,
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      ...(input.taxId
        ? {
            customer_update: input.customerId
              ? { name: 'auto' as const, address: 'auto' as const }
              : undefined,
          }
        : {}),
    });

    if (!session.url) {
      throw new Error('O Stripe não devolveu URL de checkout');
    }

    return { externalId: session.id, url: session.url };
  }

  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });

    return { url: session.url };
  }

  // ------------------------------------------------------------ assinaturas

  async getSubscription(externalId: string): Promise<RemoteSubscription | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(externalId);
      return this.traduzirAssinatura(sub);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError) return null;
      throw error;
    }
  }

  async setCancelAtPeriodEnd(
    externalId: string,
    cancel: boolean,
  ): Promise<RemoteSubscription> {
    const sub = await this.stripe.subscriptions.update(externalId, {
      cancel_at_period_end: cancel,
    });

    return this.traduzirAssinatura(sub);
  }

  // ----------------------------------------------------------------- preços

  async listPrices(): Promise<RemotePrice[]> {
    // `currency_options` só vem quando pedido explicitamente. Sem o expand a
    // lista chega com uma moeda só, e o cache de preços nasceria incompleto
    // sem nenhum erro — o pior tipo de falha.
    const prices = await this.stripe.prices.list({
      active: true,
      limit: 100,
      expand: ['data.currency_options'],
    });

    return prices.data.map((price) => this.traduzirPreco(price));
  }

  // --------------------------------------------------------------- webhooks

  verifyWebhook(rawBody: Buffer, signature: string): VerifiedWebhook {
    if (!this.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET ausente — webhook não pode ser verificado');
    }

    // Lança quando a assinatura não confere, e é isso que se quer: um webhook
    // não verificado é uma requisição anônima capaz de alterar assinaturas.
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );

    return {
      externalId: event.id,
      type: event.type,
      payload: event as unknown,
      event: this.traduzirEvento(event),
    };
  }

  private traduzirEvento(event: Stripe.Event): BillingEvent {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        return {
          kind: 'SUBSCRIPTION_CHANGED',
          subscription: this.traduzirAssinatura(
            event.data.object as Stripe.Subscription,
          ),
        };

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        return {
          kind: 'PAYMENT_FAILED',
          customerId: idDe(invoice.customer) ?? '',
          subscriptionId: assinaturaDaFatura(invoice),
          hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        };
      }

      case 'price.updated':
      case 'price.created':
        return {
          kind: 'PRICE_CHANGED',
          price: this.traduzirPreco(event.data.object as Stripe.Price),
        };

      default:
        // Não é lacuna: o Stripe emite dezenas de tipos, e reagir a todos
        // seria acoplar o produto ao vocabulário dele. `checkout.session.
        // completed`, por exemplo, é redundante — a criação da assinatura já
        // chega por `customer.subscription.created`, com os metadados.
        return { kind: 'IGNORED', reason: event.type };
    }
  }

  // -------------------------------------------------------------- tradução

  private traduzirAssinatura(sub: Stripe.Subscription): RemoteSubscription {
    const item = sub.items?.data?.[0];

    return {
      externalId: sub.id,
      customerId: idDe(sub.customer) ?? '',
      priceId: item?.price?.id ?? null,
      status: traduzirStatus(sub.status),
      currency: (sub.currency ?? 'brl').toUpperCase(),
      currentPeriodStart: emData(periodo(sub, 'start')) ?? new Date(),
      currentPeriodEnd: emData(periodo(sub, 'end')),
      trialEndsAt: emData(sub.trial_end),
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      canceledAt: emData(sub.canceled_at),
      metadata: sub.metadata ?? {},
    };
  }

  private traduzirPreco(price: Stripe.Price): RemotePrice {
    const amounts: Record<string, number> = {};

    if (price.unit_amount !== null && price.unit_amount !== undefined) {
      amounts[price.currency.toUpperCase()] = price.unit_amount;
    }

    for (const [moeda, opcao] of Object.entries(price.currency_options ?? {})) {
      if (opcao?.unit_amount !== null && opcao?.unit_amount !== undefined) {
        amounts[moeda.toUpperCase()] = opcao.unit_amount;
      }
    }

    return {
      externalId: price.id,
      productId: idDe(price.product),
      active: price.active,
      amountsByCurrency: amounts,
    };
  }
}

// =============================================================================
// Auxiliares de leitura da resposta do Stripe.
//
// Ficam fora da classe porque não dependem de estado, e juntos porque todos
// resolvem o mesmo problema: campos que o Stripe move de lugar entre versões
// da API, ou que devolve ora como id, ora como objeto expandido.
// =============================================================================

/** Campo que vem como `string` ou como objeto expandido. */
function idDe(valor: string | { id: string } | null | undefined): string | null {
  if (!valor) return null;
  return typeof valor === 'string' ? valor : valor.id;
}

/** Epoch em segundos para `Date`. */
function emData(segundos: number | null | undefined): Date | null {
  return segundos ? new Date(segundos * 1000) : null;
}

/**
 * Início e fim do período corrente.
 *
 * A partir da versão Basil da API o Stripe **moveu estes campos da assinatura
 * para o item da assinatura** — uma assinatura pode ter itens com ciclos
 * diferentes. Ler os dois lugares mantém o código correto nas duas versões, e
 * o custo é este comentário.
 *
 * Ler só o campo antigo produziria `currentPeriodEnd` nulo em silêncio, e
 * `currentPeriodEnd` nulo é a data que decide quando o acesso termina.
 */
function periodo(sub: Stripe.Subscription, ponta: 'start' | 'end'): number | null {
  const item = sub.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;

  const noItem = ponta === 'start' ? item?.current_period_start : item?.current_period_end;
  if (noItem) return noItem;

  const legado = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };

  return (
    (ponta === 'start' ? legado.current_period_start : legado.current_period_end) ?? null
  );
}

/**
 * Assinatura ligada a uma fatura.
 *
 * Mesma história: `invoice.subscription` virou
 * `invoice.parent.subscription_details.subscription`.
 */
function assinaturaDaFatura(invoice: Stripe.Invoice): string | null {
  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } } };
    subscription?: string | { id: string };
  });

  return idDe(parent.parent?.subscription_details?.subscription ?? parent.subscription);
}

/**
 * Estado do Stripe para o nosso enum.
 *
 * Duas traduções não são óbvias e valem a explicação:
 *
 * - `incomplete_expired` é o checkout que começou, nunca foi pago e expirou.
 *   Vira `CANCELED` e não `INCOMPLETE` porque não há mais nada a esperar —
 *   deixar como incompleto manteria para sempre uma assinatura fantasma
 *   aparecendo como "em processamento" na tela do cliente.
 *
 * - `paused` é a assinatura cujo teste acabou sem forma de pagamento. Vira
 *   `UNPAID`, que é o efeito prático: acesso suspenso por falta de pagamento.
 */
function traduzirStatus(status: Stripe.Subscription.Status): RemoteSubscriptionStatus {
  switch (status) {
    case 'trialing':
      return 'TRIALING';
    case 'active':
      return 'ACTIVE';
    case 'past_due':
      return 'PAST_DUE';
    case 'unpaid':
    case 'paused':
      return 'UNPAID';
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED';
    case 'incomplete':
      return 'INCOMPLETE';
    default:
      // Estado novo do Stripe. `INCOMPLETE` é o padrão seguro: não libera
      // acesso e não suspende quem está pagando.
      return 'INCOMPLETE';
  }
}
