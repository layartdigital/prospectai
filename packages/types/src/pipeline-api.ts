import type { ScoreLevelName, WebsiteStatus, WhatsAppStatus } from './lead';

export interface PipelineCardView {
  id: string;
  leadId: string;
  name: string;
  category: string | null;
  city: string | null;
  stateUf: string | null;
  score: number;
  scoreLevel: ScoreLevelName;
  websiteStatus: WebsiteStatus;
  whatsappStatus: WhatsAppStatus;
  ownerName: string | null;
  position: number;
  enteredStageAt: string;
}

export interface PipelineColumn {
  id: string;
  slug: string;
  name: string;
  color: string;
  order: number;
  isTerminal: boolean;
  cards: PipelineCardView[];
}

export interface PipelineBoard {
  columns: PipelineColumn[];
  total: number;
}

export interface HistoryItem {
  id: string;
  niche: string;
  city: string;
  stateUf: string;
  neighborhood: string | null;
  requestedCount: number;
  leadsFound: number;
  duplicatesFound: number;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface HistoryResponse {
  items: HistoryItem[];
  kpis: {
    totalSearches: number;
    totalLeads: number;
    averagePerSearch: number;
    /** Percentual de duplicados sobre o total retornado pela fonte. */
    duplicateRate: number;
  };
}
