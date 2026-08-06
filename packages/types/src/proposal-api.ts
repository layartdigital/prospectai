export const PROPOSAL_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Recusada',
  EXPIRED: 'Expirada',
};

export const CONTRACT_STATUSES = ['DRAFT', 'SENT', 'SIGNED', 'CANCELLED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  SIGNED: 'Assinado',
  CANCELLED: 'Cancelado',
};

export interface ProposalItemView {
  id: string;
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export interface ProposalView {
  id: string;
  title: string;
  status: ProposalStatus;
  totalCents: number;
  currency: string;
  validUntil: string | null;
  notes: string | null;
  leadId: string | null;
  leadName: string | null;
  items: ProposalItemView[];
  contractCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalListResponse {
  items: ProposalView[];
  summary: {
    total: number;
    draft: number;
    sent: number;
    accepted: number;
    /** Soma das propostas aceitas, em centavos. */
    wonCents: number;
    /** Aceitas sobre enviadas, em pontos percentuais. */
    conversionRate: number;
  };
}

export interface CreateProposalInput {
  title: string;
  leadId?: string;
  validUntil?: string;
  notes?: string;
  items: {
    description: string;
    quantity: number;
    unitCents: number;
  }[];
}

export interface ContractView {
  id: string;
  title: string;
  status: ContractStatus;
  proposalId: string | null;
  proposalTitle: string | null;
  leadName: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface ContractListResponse {
  items: ContractView[];
  summary: {
    total: number;
    draft: number;
    sent: number;
    signed: number;
  };
}

export interface CreateContractInput {
  title: string;
  proposalId?: string;
  content?: string;
}
