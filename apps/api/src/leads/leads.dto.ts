import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

export class LeadQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: 'Busca por nome da empresa' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  stateUf?: string;

  @ApiPropertyOptional({ example: 'São Paulo' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'Dentista' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @ApiPropertyOptional({ example: 'novo' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  stageSlug?: string;

  @ApiPropertyOptional({
    description: 'SEM_SITE ou SITE_PRECARIO — o recorte comercialmente relevante',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  withoutOwnWebsite?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  likelyWhatsapp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  favoritesOnly?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ enum: ['score', 'name', 'createdAt'], default: 'score' })
  @IsOptional()
  @IsIn(['score', 'name', 'createdAt'])
  sortBy?: 'score' | 'name' | 'createdAt' = 'score';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'desc';
}

export class CreateNoteDto {
  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class ChangeStageDto {
  @IsString()
  @MaxLength(60)
  stageSlug!: string;

  @ApiPropertyOptional({ description: 'Obrigatório em algumas configurações de "Perdido"' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  reason?: string;
}

export class CreateContactRecordDto {
  @IsIn(['WHATSAPP', 'EMAIL', 'INSTAGRAM', 'PHONE', 'IN_PERSON', 'OTHER'])
  channel!: string;

  @IsIn(['SENT', 'RECEIVED'])
  direction!: 'SENT' | 'RECEIVED';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  outcome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreateFollowUpDto {
  @IsString()
  dueAt!: string;

  @IsOptional()
  @IsIn(['WHATSAPP', 'EMAIL', 'INSTAGRAM', 'PHONE', 'IN_PERSON', 'OTHER'])
  channel?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * Concluir, cancelar ou reagendar.
 *
 * Um endpoint só, e não três, porque as três operações mudam os mesmos dois
 * campos e competem entre si: reagendar um follow-up já cancelado precisaria
 * de ordem definida entre chamadas separadas. Aqui a transição é atômica.
 */
export class UpdateFollowUpDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['PENDING', 'COMPLETED', 'CANCELLED'])
  status?: 'PENDING' | 'COMPLETED' | 'CANCELLED';

  @ApiPropertyOptional({ description: 'Nova data. Reagendar reabre o follow-up.' })
  @IsOptional()
  @IsString()
  dueAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RegisterActivityDto {
  @IsIn(['PHONE_COPIED', 'MAP_OPENED', 'WHATSAPP_OPENED', 'WEBSITE_OPENED'])
  type!: string;
}
