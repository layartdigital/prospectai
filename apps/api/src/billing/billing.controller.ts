import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';

import { CurrentTenant, MinRole, Public } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { BillingService } from './billing.service';

export class CheckoutDto {
  @IsString()
  @MaxLength(40)
  planCode!: string;
}

/** Requisição com o corpo cru preservado — ver `main.ts`. */
type RequestComCorpoCru = Request & { rawBody?: Buffer };

@ApiTags('Cobrança')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * Abre o checkout.
   *
   * `MinRole('OWNER')` e não ADMIN: assinar é obrigação contratual, e quem
   * assume dívida em nome da empresa é o dono da conta. Deixar um admin
   * convidado contratar plano anual seria criar obrigação para outra pessoa.
   */
  @Post('checkout')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @MinRole('OWNER')
  @ApiOperation({ summary: 'Cria a sessão de checkout de um plano' })
  @ApiResponse({ status: 201, description: 'URL de checkout do provedor' })
  @ApiResponse({ status: 400, description: 'Plano sem preço ou moeda indisponível' })
  async checkout(
    @CurrentTenant() tenant: ActiveTenant,
    @Body() dto: CheckoutDto,
  ): Promise<{ url: string }> {
    return this.billing.criarCheckout(tenant.id, dto.planCode);
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @MinRole('OWNER')
  @ApiOperation({ summary: 'Abre o portal de cobrança do provedor' })
  async portal(@CurrentTenant() tenant: ActiveTenant): Promise<{ url: string }> {
    return this.billing.abrirPortal(tenant.id);
  }

  /**
   * Webhook do provedor.
   *
   * `@Public` porque a autenticação aqui é a assinatura criptográfica do
   * corpo, não um cookie de sessão — o Stripe não tem como fazer login. Isso
   * torna a verificação em `verifyWebhook` a única barreira, e é por isso que
   * ela lança em vez de devolver `false`.
   *
   * Fora do Swagger: não é API para cliente nenhum, e documentá-la só
   * convidaria alguém a chamá-la à mão.
   */
  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: RequestComCorpoCru,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: true }> {
    if (!signature) {
      throw new BadRequestException('Requisição sem assinatura');
    }

    // Corpo cru ausente significa que o `rawBody` do Nest não foi habilitado.
    // Falhar aqui com mensagem explícita é melhor que verificar a assinatura
    // contra um JSON reserializado e culpar o Stripe pela rejeição.
    if (!req.rawBody) {
      throw new BadRequestException(
        'Corpo cru indisponível: habilite `rawBody` na criação da aplicação',
      );
    }

    await this.billing.receberWebhook(req.rawBody, signature);

    return { received: true };
  }
}
