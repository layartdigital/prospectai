import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { PrismaSistemaService } from './prisma-sistema.service';

/**
 * Dois clients, dois papéis, e a diferença é de segurança e não de organização.
 *
 * - `PrismaService` conecta como `propectai_app`, **sujeito à política**. É o
 *   caminho de tudo o que pertence a um tenant.
 * - `PrismaSistemaService` conecta como `propectai_sistema`, que ignora a
 *   política — e por isso não expõe o client, só o `atravessandoTenants`.
 *
 * O módulo é `@Global()` desde antes; os dois entram pela mesma porta, e é o
 * tipo que se injeta que diz qual papel está em jogo.
 */
@Global()
@Module({
  providers: [PrismaService, PrismaSistemaService],
  exports: [PrismaService, PrismaSistemaService],
})
export class PrismaModule {}
