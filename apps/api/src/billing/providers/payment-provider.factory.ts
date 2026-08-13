import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaymentProvider } from '@propectai/types';

import { MockPaymentProvider } from './mock-payment.provider';
import { StripePaymentProvider } from './stripe.provider';

/**
 * Escolhe o provedor de cobrança ativo.
 *
 * Mesmo desenho da `AIProviderFactory`, com uma diferença de gravidade: cair
 * no mock de IA produz texto genérico, cair no mock de cobrança produz
 * **cliente que não consegue pagar**. Por isso o aviso aqui é `error` e não
 * `warn` quando a intenção era usar o Stripe.
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly ativo: PaymentProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly stripe: StripePaymentProvider,
  ) {
    const escolhido = (
      this.config.get<string>('PAYMENT_PROVIDER') ?? 'mock'
    ).toLowerCase();

    if (escolhido === 'stripe') {
      if (this.stripe.configurado) {
        this.logger.log('Provider de cobrança: stripe');
        this.ativo = this.stripe;
        return;
      }

      this.logger.error(
        'PAYMENT_PROVIDER=stripe, mas STRIPE_SECRET_KEY está ausente. ' +
          'Nenhuma cobrança será possível — checkout e portal vão falhar.',
      );
    } else {
      this.logger.log('Provider de cobrança: mock (nenhuma cobrança será processada)');
    }

    this.ativo = new MockPaymentProvider();
  }

  get(): PaymentProvider {
    return this.ativo;
  }
}
