import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { StripePaymentProvider } from './providers/stripe.provider';

/**
 * Cobrança.
 *
 * `StripePaymentProvider` é registrado mesmo quando inativo — a fábrica
 * precisa perguntar a ele se está configurado, e um provider que só existe
 * quando funciona não teria como responder que não funciona.
 *
 * `BillingService` é exportado porque o painel do provedor sincroniza preços.
 */
@Module({
  imports: [PrismaModule],
  controllers: [BillingController],
  providers: [BillingService, PaymentProviderFactory, StripePaymentProvider],
  exports: [BillingService],
})
export class BillingModule {}
