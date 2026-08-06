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
    const proposals = await this.prisma.proposal.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        lead: true,
        items: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { contracts: true } },
      },
    });

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

  async createProposal(
    tenantId: string,
    userId: string,
    input: CreateProposalInput,
  ): Promise<ProposalView> {
    if (input.items.length === 0) {
      throw new BadRequestException('Inclua ao menos um item na proposta');
    }

    if (input.leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: input.leadId, tenantId, deletedAt: null },
        select: { id: true },
      });
      // Vincular proposta a lead de outro tenant seria vazamento silencioso.
      if (!lead) throw new NotFoundException('Lead não encontrado');
    }

    const totalCents = input.items.reduce(
      (sum, item) => sum + item.quantity * item.unitCents,
      0,
    );

    const proposal = await this.prisma.proposal.create({
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

    await this.prisma.auditLog.create({
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
      await this.prisma.leadActivity.create({
        data: {
          tenantId,
          leadId: input.leadId,
          actorId: userId,
          type: 'CONTACT_REGISTERED',
          metadata: { proposalId: proposal.id, kind: 'proposal' },
        },
      });
    }

    return this.toProposalView(proposal);
  }

  async changeProposalStatus(
    tenantId: string,
    id: string,
    userId: string,
    status: ProposalStatus,
  ): Promise<ProposalView> {
    const existing = await this.prisma.proposal.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Proposta não encontrada');

    const proposal = await this.prisma.proposal.update({
      where: { id },
      data: { status },
      include: {
        lead: true,
        items: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { contracts: true } },
      },
    });

    await this.prisma.auditLog.create({
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
      const wonStage = await this.prisma.pipelineStage.findFirst({
        where: { tenantId, isWon: true },
      });

      if (wonStage) {
        const card = await this.prisma.pipelineCard.findUnique({
          where: { leadId: proposal.leadId },
        });

        if (card && card.stageId !== wonStage.id) {
          await this.prisma.pipelineCard.update({
            where: { leadId: proposal.leadId },
            data: {
              stageId: wonStage.id,
              enteredStageAt: new Date(),
              estimatedValue: proposal.totalCents,
            },
          });

          await this.prisma.pipelineTransition.create({
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

    return this.toProposalView(proposal);
  }

  async deleteProposal(tenantId: string, id: string, userId: string): Promise<void> {
    const existing = await this.prisma.proposal.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Proposta não encontrada');

    // Exclusão lógica: o histórico comercial não some porque alguém
    // apagou a proposta.
    await this.prisma.proposal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'proposal.deleted',
        entityType: 'Proposal',
        entityId: id,
        before: { title: existing.title, status: existing.status },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Contratos
  // ---------------------------------------------------------------------------

  async listContracts(tenantId: string): Promise<ContractListResponse> {
    const contracts = await this.prisma.contract.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { proposal: { include: { lead: true } } },
    });

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
    if (input.proposalId) {
      const proposal = await this.prisma.proposal.findFirst({
        where: { id: input.proposalId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!proposal) throw new NotFoundException('Proposta não encontrada');
    }

    const contract = await this.prisma.contract.create({
      data: {
        tenantId,
        proposalId: input.proposalId ?? null,
        title: input.title,
        content: input.content ?? null,
      },
      include: { proposal: { include: { lead: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'contract.created',
        entityType: 'Contract',
        entityId: contract.id,
        after: { title: contract.title },
      },
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
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');

    const contract = await this.prisma.contract.update({
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

    await this.prisma.auditLog.create({
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
