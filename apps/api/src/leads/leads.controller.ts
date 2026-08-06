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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { LeadDetail, LeadFacets, LeadListResponse } from '@propectai/types';

import { CurrentTenant, CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant, AuthenticatedUser } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import {
  ChangeStageDto,
  CreateContactRecordDto,
  CreateFollowUpDto,
  CreateNoteDto,
  LeadQueryDto,
  RegisterActivityDto,
  UpdateFollowUpDto,
} from './leads.dto';
import { LeadsService } from './leads.service';

@ApiTags('leads')
@Controller('leads')
@UseGuards(JwtAuthGuard, TenantGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar leads',
    description:
      'Paginação no servidor com filtros combináveis. Telefones já vêm ' +
      'mascarados quando o plano exige — a máscara nunca é aplicada no ' +
      'cliente sobre um dado completo. Não exige plano pago.',
  })
  @ApiResponse({ status: 200, description: 'Página de leads e resumo do filtro' })
  async list(
    @CurrentTenant() tenant: ActiveTenant,
    @Query() query: LeadQueryDto,
  ): Promise<LeadListResponse> {
    return this.leads.list(tenant.id, tenant.planCode, query);
  }

  @Get('facets')
  @ApiOperation({
    summary: 'Opções de filtro',
    description:
      'Estados, cidades, categorias e etapas presentes no acervo do tenant. ' +
      'Derivado dos dados reais, não de lista fixa — filtro que não devolve ' +
      'nada é pior do que filtro ausente.',
  })
  async facets(@CurrentTenant() tenant: ActiveTenant): Promise<LeadFacets> {
    return this.leads.facets(tenant.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalhe do lead',
    description:
      'Contato, presença digital em três estados, score com motivos ' +
      'positivos e de atenção, pipeline, notas, contatos, follow-ups e ' +
      'atividades. Lead de outro tenant responde 404, nunca 403.',
  })
  @ApiResponse({ status: 200, description: 'Lead completo' })
  @ApiResponse({ status: 404, description: 'Lead não encontrado neste workspace' })
  async findOne(
    @CurrentTenant() tenant: ActiveTenant,
    @Param('id') id: string,
  ): Promise<LeadDetail> {
    return this.leads.findOne(tenant.id, id, tenant.planCode);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: 'Favoritar lead', description: 'Gera LeadActivity.' })
  async favorite(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.leads.toggleFavorite(tenant.id, id, user.id, true);
  }

  @Delete(':id/favorite')
  @ApiOperation({ summary: 'Remover favorito', description: 'Gera LeadActivity.' })
  async unfavorite(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.leads.toggleFavorite(tenant.id, id, user.id, false);
  }

  @Patch(':id/pipeline-stage')
  @ApiOperation({
    summary: 'Mudar etapa do pipeline',
    description:
      'Registra a transição com usuário, etapa anterior, etapa nova e origem. ' +
      'Cria o card caso o lead ainda não esteja no pipeline.',
  })
  async changeStage(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeStageDto,
  ) {
    return this.leads.changeStage(tenant.id, id, user.id, dto.stageSlug, dto.reason);
  }

  @Post(':id/notes')
  @ApiOperation({
    summary: 'Adicionar observação',
    description:
      'Notas nunca são sobrescritas: correção gera registro novo, preservando ' +
      'autoria e histórico.',
  })
  async addNote(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.leads.addNote(tenant.id, id, user.id, dto.content);
  }

  @Post(':id/contact-records')
  @ApiOperation({
    summary: 'Registrar contato',
    description: 'Atualiza a timeline e a data do último contato do lead.',
  })
  async addContact(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateContactRecordDto,
  ) {
    return this.leads.addContactRecord(tenant.id, id, user.id, dto);
  }

  @Post(':id/follow-ups')
  @ApiOperation({
    summary: 'Agendar follow-up',
    description:
      'Data no passado entra direto como OVERDUE, para não criar pendência ' +
      'que nasce silenciosamente atrasada.',
  })
  async addFollowUp(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateFollowUpDto,
  ) {
    return this.leads.addFollowUp(tenant.id, id, user.id, dto);
  }

  @Patch(':id/follow-ups/:followUpId')
  @ApiOperation({
    summary: 'Concluir, cancelar ou reagendar follow-up',
    description:
      'Uma transição atômica para as três operações. Enviar apenas `dueAt` ' +
      'reabre o follow-up: volta a PENDING (ou OVERDUE, se a data já passou) ' +
      'e limpa as marcas de conclusão e cancelamento. Concluir grava ' +
      'LeadActivity FOLLOWUP_COMPLETED.',
  })
  @ApiResponse({ status: 404, description: 'Follow-up inexistente neste lead' })
  async updateFollowUp(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @Body() dto: UpdateFollowUpDto,
  ) {
    return this.leads.updateFollowUp(tenant.id, id, followUpId, user.id, dto);
  }

  @Post(':id/recalculate-score')
  @ApiOperation({
    summary: 'Recalcular score',
    description:
      'Usa o mesmo motor determinístico do worker e do seed. Regrava os ' +
      'motivos e registra a versão do algoritmo.',
  })
  async recalculate(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.leads.recalculateScore(tenant.id, id, user.id);
  }

  @Post(':id/activities')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Registrar interação',
    description:
      'Copiar telefone, abrir mapa, abrir WhatsApp e abrir site geram trilha. ' +
      'É o que diferencia um CRM que registra de um que apenas armazena.',
  })
  async registerActivity(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RegisterActivityDto,
  ): Promise<void> {
    await this.leads.registerActivity(tenant.id, id, user.id, dto.type);
  }
}
