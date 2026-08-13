import type {
  CheckoutInput,
  CheckoutSession,
  PaymentProvider,
  RemotePrice,
  RemoteSubscription,
  VerifiedWebhook,
} from '@propectai/types';

/**
 * Provider de cobrança para desenvolvimento e teste.
 *
 * Não simula pagamento: **recusa**. Toda operação que moveria dinheiro lança.
 *
 * Um mock que devolvesse "assinatura ativa" faria a tela de planos parecer
 * funcionar sem Stripe configurado, e o defeito só apareceria no primeiro
 * cliente real. Falhar alto em desenvolvimento é o comportamento correto: a
 * mensagem diz exatamente qual variável falta.
 *
 * As leituras — `getSubscription`, `listPrices` — devolvem vazio em vez de
 * lançar. Sem isso a aplicação não sobe, e o resto do produto não tem culpa
 * de a cobrança não estar configurada.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly configurado = false;

  private recusar(operacao: string): never {
    throw new Error(
      `Cobrança não configurada: ${operacao} exige STRIPE_SECRET_KEY. ` +
        'Defina a chave no .env ou use um plano sem cobrança.',
    );
  }

  async createCheckout(_input: CheckoutInput): Promise<CheckoutSession> {
    this.recusar('abrir checkout');
  }

  async createPortalSession(_input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    this.recusar('abrir o portal de cobrança');
  }

  async getSubscription(_externalId: string): Promise<RemoteSubscription | null> {
    return null;
  }

  async setCancelAtPeriodEnd(
    _externalId: string,
    _cancel: boolean,
  ): Promise<RemoteSubscription> {
    this.recusar('cancelar assinatura');
  }

  async listPrices(): Promise<RemotePrice[]> {
    return [];
  }

  verifyWebhook(_rawBody: Buffer, _signature: string): VerifiedWebhook {
    // Aceitar webhook sem verificar seria transformar o endpoint numa porta
    // aberta em qualquer ambiente onde o mock esteja ativo.
    this.recusar('verificar webhook');
  }
}
