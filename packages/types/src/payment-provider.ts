/**
 * Contrato do provedor de pagamento.
 *
 * Mesmo desenho do `LeadSourceProvider` e do `AIProvider`, e pela mesma razão:
 * o domínio não pode conhecer o fornecedor. Aqui a razão é mais forte que nos
 * outros dois — trocar de gateway é decisão que se toma por preço, por país
 * não atendido ou por conta bloqueada, e nas três situações a troca é urgente.
 * Abstração escrita depois, sob pressão, sai errada.
 *
 * **O teste de que funcionou:** `apps/api/src/billing/providers/` é a única
 * pasta do repositório que importa o SDK do Stripe. Se um `Stripe.Subscription`
 * aparecer num service de domínio, a abstração vazou.
 *
 * Nenhum tipo aqui tem campo de valor monetário que a aplicação envie ao
 * provedor. A aplicação diz **qual** preço, nunca **quanto** — ver
 * `docs/strategic/lacunas-estruturais.md` §10.1.
 */

/** Estados de assinatura. Mesmos nomes do enum do Prisma, e do Stripe. */
export type RemoteSubscriptionStatus =
  | 'INCOMPLETE'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'UNPAID'
  | 'CANCELED';

export interface CheckoutInput {
  /** Cliente existente no provedor. Nulo faz o provedor criar um. */
  customerId: string | null;
  email: string;
  /** Identificador do preço no provedor. Nunca um valor. */
  priceId: string;
  /** ISO 4217. Precisa existir nas opções de moeda do preço. */
  currency: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Identificação fiscal, quando houver.
   *
   * Habilita reverse charge na venda B2B europeia. Ausente não impede a
   * compra — impede apenas a isenção.
   */
  taxId?: { type: string; value: string } | null;
  /**
   * Carregado em toda a cadeia de eventos do provedor.
   *
   * É o que liga um webhook ao tenant sem depender de o cliente já estar
   * gravado no banco: o checkout pode ser abandonado e retomado dias depois.
   */
  metadata: Record<string, string>;
}

export interface CheckoutSession {
  externalId: string;
  url: string;
}

export interface RemoteSubscription {
  externalId: string;
  customerId: string;
  priceId: string | null;
  status: RemoteSubscriptionStatus;
  currency: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  metadata: Record<string, string>;
}

export interface RemotePrice {
  externalId: string;
  productId: string | null;
  active: boolean;
  /**
   * Centavos por moeda: `{ "BRL": 14900, "EUR": 2700 }`.
   *
   * Um preço com várias moedas, e não um preço por moeda — ver §10.2. Achatar
   * as `currency_options` aqui evita que o resto da aplicação precise saber
   * que o Stripe as modela como um campo opcional dentro de outro.
   */
  amountsByCurrency: Record<string, number>;
}

/**
 * Evento do provedor, já traduzido.
 *
 * O provedor emite dezenas de tipos; ao domínio interessam quatro situações.
 * Traduzir na borda é o que impede um `switch` sobre strings do Stripe
 * espalhado por services — e é o que torna um segundo provedor viável, já que
 * ele terá nomes de evento completamente diferentes para as mesmas coisas.
 *
 * Homônimo do model `BillingEvent` do Prisma, e a diferença importa: o model é
 * o envelope cru guardado para idempotência, este é o conteúdo já traduzido.
 * Quem precisar dos dois no mesmo arquivo apelida o do Prisma.
 */
export type BillingEvent =
  | { kind: 'SUBSCRIPTION_CHANGED'; subscription: RemoteSubscription }
  | { kind: 'PRICE_CHANGED'; price: RemotePrice }
  | {
      kind: 'PAYMENT_FAILED';
      customerId: string;
      subscriptionId: string | null;
      /** Página de pagamento da fatura, para o aviso na interface. */
      hostedInvoiceUrl: string | null;
    }
  /**
   * Recebido, verificado, sem ação. Continua sendo gravado: saber que um
   * evento chegou e foi ignorado de propósito é diferente de não saber nada.
   */
  | { kind: 'IGNORED'; reason: string };

export interface VerifiedWebhook {
  /** Id do evento no provedor. Chave de idempotência. */
  externalId: string;
  /** Tipo cru, preservado para diagnóstico. */
  type: string;
  payload: unknown;
  event: BillingEvent;
}

export interface PaymentProvider {
  readonly name: string;
  readonly configurado: boolean;

  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;

  /**
   * Portal do provedor: trocar cartão, ver faturas, cancelar.
   *
   * Deliberadamente não reimplementado. Tela de cartão de crédito própria
   * significa PCI-DSS, e nada no produto justifica isso.
   */
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  getSubscription(externalId: string): Promise<RemoteSubscription | null>;

  setCancelAtPeriodEnd(
    externalId: string,
    cancel: boolean,
  ): Promise<RemoteSubscription>;

  listPrices(): Promise<RemotePrice[]>;

  /**
   * Verifica a assinatura criptográfica e traduz.
   *
   * Recebe o corpo **cru**: o payload é assinado byte a byte, e qualquer
   * reserialização — a que o parser de JSON faz sem avisar — invalida a
   * verificação. Endpoint de webhook sem verificação de assinatura é endpoint
   * público que altera assinaturas; qualquer um poderia enviar
   * `subscription.updated` e liberar acesso.
   *
   * Síncrono de propósito: não faz I/O, e nada deve acontecer antes dela.
   */
  verifyWebhook(rawBody: Buffer, signature: string): VerifiedWebhook;
}
