import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class CreateSearchDto {
  @ApiProperty({ example: 'Dentistas' })
  @IsString()
  @MaxLength(80)
  niche!: string;

  @ApiProperty({ example: 'SP' })
  @IsString()
  @Length(2, 2, { message: 'Informe a sigla do estado, com duas letras' })
  stateUf!: string;

  @ApiPropertyOptional({
    description:
      'Preenchido quando o nicho veio de um termo sugerido pela taxonomia. ' +
      'É o que permite validar o termo sem custo extra: a contagem de ' +
      'resultados desta busca decide se ele funciona no país.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  segmentLocaleId?: string;

  @ApiProperty({ example: 'São Paulo' })
  @IsString()
  @MaxLength(120)
  city!: string;

  @ApiPropertyOptional({ example: 'Vila Mariana' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighborhood?: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  radiusKm?: number;

  @ApiPropertyOptional({
    default: 5,
    description: 'Limitado pelo saldo do plano — o servidor reduz se exceder',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  requestedCount?: number;
}
