import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateAuditDto {
  @ApiProperty({
    description:
      'Lead a auditar. O `website` sai do proprio lead — nao do corpo da ' +
      'requisicao. Aceitar URL do cliente seria deixa-lo escolher o destino ' +
      'da conexao que o worker abre, e a egress policy inteira existe para ' +
      'que esse destino seja decidido por nos.',
  })
  @IsString()
  @MaxLength(40)
  leadId!: string;
}

export class ListAuditsQueryDto {
  @ApiProperty({
    description:
      'Lead cujas auditorias listar. Obrigatorio: listar as auditorias do ' +
      'workspace inteiro nao e caso de uso de nenhuma tela, e uma rota que ' +
      'devolve tudo por omissao do filtro e a que alguem chama sem querer.',
  })
  @IsString()
  @MaxLength(40)
  leadId!: string;
}
