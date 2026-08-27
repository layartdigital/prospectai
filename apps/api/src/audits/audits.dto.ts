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
