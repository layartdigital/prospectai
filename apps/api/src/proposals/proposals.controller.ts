import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CONTRACT_STATUSES,
  PROPOSAL_STATUSES,
  type ContractListResponse,
  type ContractStatus,
  type ProposalListResponse,
  type ProposalStatus,
} from '@propectai/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { CurrentTenant, CurrentUser, MinRole } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant, AuthenticatedUser } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { ProposalsService } from './proposals.service';

class ProposalItemDto {
  @IsString()
  @MaxLength(200)
  description!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsInt()
  @Min(0)
  unitCents!: number;
}

export class CreateProposalDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsISO8601()
  validUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProposalItemDto)
  items!: ProposalItemDto[];
}

export class ChangeProposalStatusDto {
  @IsIn([...PROPOSAL_STATUSES])
  status!: ProposalStatus;
}

export class CreateContractDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  proposalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  content?: string;
}

export class ChangeContractStatusDto {
  @IsIn([...CONTRACT_STATUSES])
  status!: ContractStatus;
}

@ApiTags('proposals')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get('proposals')
  @ApiOperation({
    summary: 'Listar propostas',
    description:
      'Propostas do tenant com itens, valor e vínculo com lead. A taxa de ' +
      'conversão considera apenas propostas que saíram da gaveta — rascunho ' +
      'não entra no denominador.',
  })
  @ApiResponse({ status: 200, description: 'Propostas e indicadores' })
  async listProposals(
    @CurrentTenant() tenant: ActiveTenant,
  ): Promise<ProposalListResponse> {
    return this.proposals.listProposals(tenant.id);
  }

  @Post('proposals')
  @MinRole('SDR')
  @ApiOperation({
    summary: 'Criar proposta',
    description:
      'Cria a proposta com itens e calcula o total no servidor. Lead de outro ' +
      'tenant responde 404. Gera AuditLog e LeadActivity quando há vínculo.',
  })
  @ApiResponse({ status: 201, description: 'Proposta criada' })
  @ApiResponse({ status: 400, description: 'Proposta sem itens' })
  async createProposal(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProposalDto,
  ) {
    return this.proposals.createProposal(tenant.id, user.id, dto);
  }

  @Patch('proposals/:id/status')
  @MinRole('SDR')
  @ApiOperation({
    summary: 'Mudar status da proposta',
    description:
      'Aceitar uma proposta move o lead para a etapa de fechamento e registra ' +
      'o valor estimado no card — evita que o pipeline fique defasado por ' +
      'esquecimento.',
  })
  async changeProposalStatus(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeProposalStatusDto,
  ) {
    return this.proposals.changeProposalStatus(tenant.id, id, user.id, dto.status);
  }

  @Delete('proposals/:id')
  @MinRole('MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Excluir proposta',
    description: 'Exclusão lógica. O histórico comercial e a auditoria permanecem.',
  })
  async deleteProposal(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.proposals.deleteProposal(tenant.id, id, user.id);
  }

  @Get('contracts')
  @ApiOperation({
    summary: 'Listar contratos',
    description: 'Contratos do tenant com vínculo à proposta e ao lead.',
  })
  async listContracts(
    @CurrentTenant() tenant: ActiveTenant,
  ): Promise<ContractListResponse> {
    return this.proposals.listContracts(tenant.id);
  }

  @Post('contracts')
  @MinRole('MANAGER')
  @ApiOperation({
    summary: 'Criar contrato',
    description:
      'Cria o contrato, opcionalmente ligado a uma proposta. Não há assinatura ' +
      'digital integrada nesta versão — marcar como assinado registra que a ' +
      'assinatura aconteceu fora do produto.',
  })
  async createContract(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateContractDto,
  ) {
    return this.proposals.createContract(tenant.id, user.id, dto);
  }

  @Patch('contracts/:id/status')
  @MinRole('MANAGER')
  @ApiOperation({ summary: 'Mudar status do contrato' })
  async changeContractStatus(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeContractStatusDto,
  ) {
    return this.proposals.changeContractStatus(tenant.id, id, user.id, dto.status);
  }
}
