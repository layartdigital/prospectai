import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GRAPH_LIMITS, GRAPH_NODE_KINDS, type GraphNodeKind } from '@propectai/types';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Mesmo formato aceito por `parseNodeRef`; o servico valida de novo. */
const ID = /^[A-Za-z0-9_-]{8,64}$/;

export class GraphQueryDto {
  @ApiProperty({ description: 'Id do lead que serve de raiz do grafo' })
  @IsString()
  @Matches(ID, { message: 'leadId inválido' })
  leadId!: string;
}

export class ExpandQueryDto {
  @ApiProperty({ example: 'LEAD:cm0abc123456', description: 'Referência do nó a expandir (KIND:id)' })
  @IsString()
  @MaxLength(120)
  ref!: string;

  @ApiProperty({ enum: GRAPH_NODE_KINDS, description: 'Tipo de filho a carregar' })
  @IsIn(GRAPH_NODE_KINDS as readonly string[])
  kind!: GraphNodeKind;

  @ApiPropertyOptional({ default: 0, description: 'Posição inicial (paginação por deslocamento)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number = 0;

  @ApiPropertyOptional({ default: GRAPH_LIMITS.defaultPageSize, maximum: GRAPH_LIMITS.maxPageSize })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(GRAPH_LIMITS.maxPageSize)
  pageSize?: number = GRAPH_LIMITS.defaultPageSize;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Profundidade do nó expandido na tela. Serve para o teto de custo e para numerar a ' +
      'profundidade dos filhos; NÃO é verificação de autorização.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(GRAPH_LIMITS.maxDepth)
  parentDepth?: number = 0;
}
