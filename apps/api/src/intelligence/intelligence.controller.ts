import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { GraphExpandResponse, GraphResponse } from '@propectai/types';

import { CurrentTenant } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { ExpandQueryDto, GraphQueryDto } from './intelligence.dto';
import { IntelligenceService } from './intelligence.service';

/**
 * A busca de leads para escolher a raiz **nao** tem endpoint aqui: reutiliza
 * `GET /leads?search=`, que ja pagina, filtra e mascara por plano. Duplica-lo
 * criaria duas listagens com regras de mascara que poderiam divergir.
 */
@ApiTags('intelligence')
@Controller('intelligence')
@UseGuards(JwtAuthGuard, TenantGuard)
export class IntelligenceController {
  constructor(private readonly intelligence: IntelligenceService) {}

  @Get('graph')
  @ApiOperation({
    summary: 'Grafo de relações de um lead',
    description:
      'Devolve o lead raiz e as relações diretas que existem como chave estrangeira ' +
      '(pesquisa, score, presença digital, cartão do pipeline), cada aresta com sua ' +
      'proveniência. Relações com muitos itens (notas, atividades, auditorias, ' +
      'contatos, follow-ups) vêm só como contagem em `expansions` e são carregadas ' +
      'por `GET /intelligence/expand`. Respeita o workspace ativo: lead de outro ' +
      'workspace responde 404, nunca 403. Não exige plano pago; os tetos são técnicos.',
  })
  @ApiResponse({ status: 200, description: 'Nós, arestas e tetos aplicados' })
  @ApiResponse({ status: 400, description: 'Parâmetro inválido' })
  @ApiResponse({ status: 404, description: 'Lead não encontrado neste workspace' })
  async graph(
    @CurrentTenant() tenant: ActiveTenant,
    @Query() query: GraphQueryDto,
  ): Promise<GraphResponse> {
    return this.intelligence.carregarGrafo(tenant.id, tenant.planCode, query.leadId);
  }

  @Get('expand')
  @ApiOperation({
    summary: 'Expandir relações de um nó',
    description:
      'Carrega uma página de filhos de um tipo a partir de um nó (por exemplo, as notas ' +
      'de um lead ou os leads de uma pesquisa). Somente combinações permitidas por ' +
      '`EXPANDABLE_KINDS`; qualquer outra responde 400. O nó pai precisa pertencer ao ' +
      'workspace ativo, senão 404. Paginação por `offset` e `pageSize` (máximo 25); o ' +
      'campo `omitted` informa o que o teto de nós cortou. A profundidade do pai ' +
      'é conferida no servidor: `parentDepth` só vale com a `parentDepthProof` que o ' +
      'servidor devolveu junto do nó; valor adulterado responde 400.',
  })
  @ApiResponse({ status: 200, description: 'Nós e arestas novos, mais a próxima posição' })
  @ApiResponse({
    status: 400,
    description: 'Referência, relação, profundidade ou prova de profundidade inválida (ou profundidade máxima atingida)',
  })
  @ApiResponse({ status: 404, description: 'Nó não encontrado neste workspace' })
  async expand(
    @CurrentTenant() tenant: ActiveTenant,
    @Query() query: ExpandQueryDto,
  ): Promise<GraphExpandResponse> {
    return this.intelligence.expandir(tenant.id, tenant.planCode, {
      ref: query.ref,
      kind: query.kind,
      offset: query.offset ?? 0,
      pageSize: query.pageSize ?? 8,
      parentDepth: query.parentDepth,
      parentDepthProof: query.parentDepthProof,
    });
  }
}
