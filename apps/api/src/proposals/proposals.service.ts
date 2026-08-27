import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ContractListResponse,
  ContractStatus,
  ContractView,
  CreateContractInput,
  CreateProposalInput,
  ProposalListResponse,
  ProposalStatus,
  ProposalView,
} from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProposalsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Propostas
  // ---------------------------------------------------------------------------

  async listProposals(tenantId: string): Promise<ProposalListResponse> {
    const proposals = await this.prisma.comTenant(tenantId, (tx) =>
      tx.proposal.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          lead: true,
          items: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { contracts: true } },
        },
      }),
    );

    const draft = proposals.filter((p) => p.status === 'DRAFT').length;
    const sent = proposals.filter((p) => p.status === 'SENT').length;
    const accepted = proposals.filter((p) => p.status === 'ACCEPTED').length;
    const rejected = proposals.filter((p) => p.status === 'REJECTED').length;

    // Conversão sobre propostas que saíram da gaveta. Rascunho nunca foi
    // ao cliente, então incluí-lo no denominador só faria o número piorar
    // conforme você trabalha.
    const decided = accepted + rejected + sent;

    return {
      items: proposals.map((proposal) => this.toProposalView(proposal)),
      summary: {
        total: proposals.length,
        draft,
        sent,
        accepted,
        wonCents: proposals
          .filter((p) => p.status === 'ACCEPTED')
          .reduce((sum, p) => sum + p.totalCents, 0),
        conversionRate: decided > 0 ? Math.round((accepted / decided) * 100) : 0,
      },
    };
  }

  /**
   * A validação de entrada fica fora do bloco: ela não toca o banco, e abrir
   * transação para depois recusar o pedido é desperdício.
   *
   * Dentro: conferência do lead, proposta com itens, auditoria e atividade.
   * O `proposal.create` grava os `items` aninhados — e vale registrar que
   * `proposal_items` **não tem `tenantId`**. Quando as políticas entrarem, a
   * proposta fica protegida e o item não; a proteção do item vem da FK para
   * o pai. Está anotado no plano como pendência de schema.
   */
  async createProposal(
    tenantId: string,
    userId: string,
    input: CreateProposalInput,
  ): Promise<ProposalView> {
    if (input.items.length === 0) {
      throw new BadRequestException('Inclua ao menos um item na proposta');
    }

    const totalCents = input.items.reduce(
      (sum, item) => sum + item.quantity * item.unitCents,
      0,
    );

    const proposal = await this.prisma.comTenant(tenantId, async (tx) => {
      if (input.leadId) {
        const lead = await tx.lead.findFirst({
          where: { id: input.leadId, tenantId, deletedAt: null },
          select: { id: true },
        });
        // Vincular proposta a lead de outro tenant seria vazamento silencioso.
        if (!lead) throw new NotFoundException('Lead não encontrado');
      }

      const proposal = await tx.proposal.create({
        data: {
          tenantId,
          leadId: input.leadId ?? null,
          title: input.title,
          totalCents,
          notes: input.notes ?? null,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          items: {
            create: input.items.map((item, index) => ({
              description: item.description,
              quantity: item.quantity,
              unitCents: item.unitCents,
              sortOrder: index,
            })),
          },
        },
        include: {
          lead: true,
          items: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { contracts: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'proposal.created',
          entityType: 'Proposal',
          entityId: proposal.id,
          after: { title: proposal.title, totalCents },
        },
      });

      if (input.leadId) {
        await tx.leadActivity.create({
          data: {
            tenantId,
            leadId: input.leadId,
            actorId: userId,
            type: 'CONTACT_REGISTERED',
            metadata: { proposalId: proposal.id, kind: 'proposal' },
          },
        });
      }

      return proposal;
    });

    return this.toProposalView(proposal);
  }

  /**
   * **Este é um dos três módulos que escrevem nas tabelas do Pipeline.**
   *
   * Foi por não ter visto isso que a família Pipeline quebrou 45 testes quando
   * foi ligada em 27/08: `pipeline.service.ts` estava convertido, este arquivo
   * e o worker não. Aceitar uma proposta escreve em `pipeline_stages`,
   * `pipeline_cards` e `pipeline_transitions` — e sem `set_config` na conexão,
   * a política recusa as três.
   *
   * Agora as sete chamadas estão no mesmo bloco. A mudança de status e o
   * movimento do card passaram a ser atômicos: antes, uma falha ao mover o
   * card deixava a proposta aceita e o pipeline parado no estágio anterior.
   */
  async changeProposalStatus(
    tenantId: string,
    id: string,
    userId: string,
    status: ProposalStatus,
  ): Promise<ProposalView> {
    const proposal = await this.prisma.comTenant(tenantId, async (tx) => {
      const existing = await tx.proposal.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Proposta não encontrada');

      const proposal = await tx.proposal.update({
        where: { id },
        data: { status },
        include: {
          lead: true,
          items: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { contracts: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'proposal.status.changed',
          entityType: 'Proposal',
          entityId: id,
          before: { status: existing.status },
          after: { status },
        },
      });

      // Proposta aceita move o lead para Fechado. É a informação mais confiável
      // que temos sobre o desfecho, e deixar o pipeline defasado obrigaria o
      // usuário a lembrar de mover o card à mão.
      if (status === 'ACCEPTED' && proposal.leadId) {
        const wonStage = await tx.pipelineStage.findFirst({
          where: { tenantId, isWon: true },
        });

        if (wonStage) {
          const card = await tx.pipelineCard.findUnique({
            where: { leadId: proposal.leadId },
          });

          if (card && card.stageId !== wonStage.id) {
            await tx.pipelineCard.update({
              where: { leadId: proposal.leadId },
              data: {
                stageId: wonStage.id,
                enteredStageAt: new Date(),
                estimatedValue: proposal.totalCents,
              },
            });

            await tx.pipelineTransition.create({
              data: {
                tenantId,
                cardId: card.id,
                fromStageId: card.stageId,
                toStageId: wonStage.id,
                changedById: userId,
                origin: 'proposal-accepted',
              },
            });
          }
        }
      }

      return proposal;
    });

    return this.toProposalView(proposal);
  }

  async deleteProposal(tenantId: string, id: string, userId: string): Promise<void> {
    await this.prisma.comTenant(tenantId, async (tx) => {
      const existing = await tx.proposal.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Proposta não encontrada');

      // Exclusão lógica: o histórico comercial não some porque alguém
      // apagou a proposta.
      await tx.proposal.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'proposal.deleted',
          entityType: 'Proposal',
          entityId: id,
          before: { title: existing.title, status: existing.status },
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Contratos
  // ---------------------------------------------------------------------------

  async listContracts(tenantId: string): Promise<ContractListResponse> {
    const contracts = await this.prisma.comTenant(tenantId, (tx) =>
      tx.contract.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { proposal: { include: { lead: true } } },
      }),
    );

    return {
      items: contracts.map((contract) => ({
        id: contract.id,
        title: contract.title,
        status: contract.status as ContractStatus,
        proposalId: contract.proposalId,
        proposalTitle: contract.proposal?.title ?? null,
        leadName: contract.proposal?.lead?.name ?? null,
        signedAt: contract.signedAt?.toISOString() ?? null,
        createdAt: contract.createdAt.toISOString(),
      })),
      summary: {
        total: contracts.length,
        draft: contracts.filter((c) => c.status === 'DRAFT').length,
        sent: contracts.filter((c) => c.status === 'SENT').length,
        signed: contracts.filter((c) => c.status === 'SIGNED').length,
      },
    };
  }

  async createContract(
    tenantId: string,
    userId: string,
    input: CreateContractInput,
  ): Promise<ContractView> {
    const contract = await this.prisma.comTenant(tenantId, async (tx) => {
      if (input.proposalId) {
        const proposal = await tx.proposal.findFirst({
          where: { id: input.proposalId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!proposal) throw new NotFoundException('Proposta não encontrada');
      }

      const contract = await tx.contract.create({
        data: {
          tenantId,
          proposalId: input.proposalId ?? null,
          title: input.title,
          content: input.content ?? null,
        },
        include: { proposal: { include: { lead: true } } },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'contract.created',
          entityType: 'Contract',
          entityId: contract.id,
          after: { title: contract.title },
        },
      });

      return contract;
    });

    return {
      id: contract.id,
      title: contract.title,
      status: contract.status as ContractStatus,
      proposalId: contract.proposalId,
      proposalTitle: contract.proposal?.title ?? null,
      leadName: contract.proposal?.lead?.name ?? null,
      signedAt: null,
      createdAt: contract.createdAt.toISOString(),
    };
  }

  async changeContractStatus(
    tenantId: string,
    id: string,
    userId: string,
    status: ContractStatus,
  ): Promise<ContractView> {
    const contract = await this.prisma.comTenant(tenantId, async (tx) => {
      const existing = await tx.contract.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Contrato não encontrado');

      const contract = await tx.contract.update({
        where: { id },
        data: {
          status,
          // "Assinado" aqui registra que a assinatura aconteceu fora do
          // produto. Não há assinatura digital integrada nesta versão, e
          // fingir que há seria promessa falsa.
          signedAt: status === 'SIGNED' ? (existing.signedAt ?? new Date()) : null,
        },
        include: { proposal: { include: { lead: true } } },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'contract.status.changed',
          entityType: 'Contract',
          entityId: id,
          before: { status: existing.status },
          after: { status },
        },
      });

      return contract;
    });

    return {
      id: contract.id,
      title: contract.title,
      status: contract.status as ContractStatus,
      proposalId: contract.proposalId,
      proposalTitle: contract.proposal?.title ?? null,
      leadName: contract.proposal?.lead?.name ?? null,
      signedAt: contract.signedAt?.toISOString() ?? null,
      createdAt: contract.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------

  private toProposalView(proposal: {
    id: string;
    title: string;
    status: string;
    totalCents: number;
    currency: string;
    validUntil: Date | null;
    notes: string | null;
    leadId: string | null;
    lead?: { name: string } | null;
    items: {
      id: string;
      description: string;
      quantity: number;
      unitCents: number;
    }[];
    _count: { contracts: number };
    createdAt: Date;
    updatedAt: Date;
  }): ProposalView {
    return {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status as ProposalStatus,
      totalCents: proposal.totalCents,
      currency: proposal.currency,
      validUntil: proposal.validUntil?.toISOString() ?? null,
      notes: proposal.notes,
      leadId: proposal.leadId,
      leadName: proposal.lead?.name ?? null,
      items: proposal.items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitCents: item.unitCents,
        totalCents: item.quantity * item.unitCents,
      })),
      contractCount: proposal._count.contracts,
      createdAt: proposal.createdAt.toISOString(),
      updatedAt: proposal.updatedAt.toISOString(),
    };
  }
}
