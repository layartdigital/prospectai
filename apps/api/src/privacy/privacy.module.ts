import { Module } from '@nestjs/common';

import { PrivacyService } from './privacy.service';

/**
 * Sem controller, de propósito.
 *
 * A decisão D4 fechou **a forma** da eliminação, não o gatilho: quem pode
 * pedir, como o pedido se confirma, e se ele apaga a conta ou só a desliga
 * continuam em aberto. Expor uma rota agora seria inventar esse fluxo.
 *
 * O serviço fica pronto e sem chamador — o que é honesto e visível — até a
 * decisão existir.
 */
@Module({
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
