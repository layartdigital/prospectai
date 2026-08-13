import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { SegmentDetail, SegmentSearchResult } from '@propectai/types';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentTenant } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { SegmentsService } from './segments.service';

export class SegmentQueryDto {
  @ApiPropertyOptional({ description: 'Texto livre: nome, especialidade ou macro' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  macroSegment?: string;
}

/**
 * Taxonomia de segmentos.
 *
 * Exige sessão, mas nenhum papel nem plano: é catálogo de referência, igual
 * para todos os tenants. O que varia por tenant é qual segmento foi escolhido,
 * e isso vive em `Tenant.segmentId`.
 */
@ApiTags('segments')
@Controller('segments')
@UseGuards(JwtAuthGuard, TenantGuard)
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Buscar segmentos',
    description:
      'Busca por texto e por macro-segmento, limitada a 40 resultados. São 500 ' +
      'segmentos em 50 macro-segmentos — lista suspensa com tudo é lista que ' +
      'ninguém usa. Devolve também a contagem por macro, para navegar por ' +
      'categoria em vez de digitar.',
  })
  async search(@Query() query: SegmentQueryDto): Promise<SegmentSearchResult> {
    return this.segments.search(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalhe do segmento',
    description:
      'Serviços, setores-alvo, sinais de oportunidade e termos de busca no ' +
      'idioma do tenant. **Locale sem tradução devolve termos vazios, nunca os ' +
      'termos em português** — buscar "agência de marketing digital em Milano" ' +
      'volta vazio, e o cliente conclui que o produto não serve para o país dele.',
  })
  async detail(
    @CurrentTenant() tenant: ActiveTenant,
    @Param('id') id: string,
  ): Promise<SegmentDetail> {
    // O locale sai do país do tenant. Quando houver preferência explícita de
    // idioma, é aqui que ela entra.
    return this.segments.detail(id, localeDoPais(tenant.country), tenant.country);
  }
}

/**
 * Mapa provisório de país para locale.
 *
 * Só existe enquanto a taxonomia tiver um idioma. Quando houver vários, o
 * locale passa a ser preferência do tenant, não dedução do país — porque uma
 * agência brasileira pode prospectar em Portugal, e um escritório suíço
 * escolhe entre três idiomas oficiais.
 */
function localeDoPais(country: string): string {
  const mapa: Record<string, string> = {
    BR: 'pt-BR',
    PT: 'pt-PT',
    IT: 'it-IT',
    ES: 'es-ES',
    US: 'en-US',
    GB: 'en-GB',
  };

  return mapa[country.toUpperCase()] ?? 'pt-BR';
}
