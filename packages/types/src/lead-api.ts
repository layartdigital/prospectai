import type { SignalState } from './common';
import type { ScoreLevelName, WebsiteStatus, WhatsAppStatus } from './lead';
import type { ScoreReasonPolarity } from './score';

/** Item da listagem. Só o necessário para a tabela — o detalhe vem em /leads/:id. */
export interface LeadListItem {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  stateUf: string | null;
  /** Já mascarado pelo servidor quando o plano exige. Nunca mascarar no cliente. */
  phone: string | null;
  phoneIsMasked: boolean;
  website: string | null;
  websiteStatus: WebsiteStatus;
  whatsappStatus: WhatsAppStatus;
  hasInstagram: SignalState;
  reviewCount: number | null;
  reviewRating: number | null;
  score: number;
  scoreLevel: ScoreLevelName;
  isFavorite: boolean;
  isDisqualified: boolean;
  stageSlug: string | null;
  stageName: string | null;
  createdAt: string;
}

export interface LeadListResponse {
  items: LeadListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Contagens do conjunto filtrado, para os chips de resumo. */
  summary: {
    withoutOwnWebsite: number;
    likelyWhatsapp: number;
    highOpportunity: number;
  };
}

export interface LeadScoreReasonView {
  code: string;
  label: string;
  weight: number;
  polarity: ScoreReasonPolarity;
  evidence: string | null;
}

export interface LeadNoteView {
  id: string;
  content: string;
  authorName: string | null;
  createdAt: string;
}

export interface LeadContactRecordView {
  id: string;
  channel: string;
  direction: 'SENT' | 'RECEIVED';
  outcome: string | null;
  notes: string | null;
  authorName: string | null;
  occurredAt: string;
}

export interface LeadFollowUpView {
  id: string;
  channel: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'PENDING' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED';
  dueAt: string;
  notes: string | null;
  ownerName: string | null;
}

export interface LeadActivityView {
  id: string;
  type: string;
  actorName: string | null;
  createdAt: string;
}

export interface PipelineStageView {
  id: string;
  slug: string;
  name: string;
  color: string;
  order: number;
  isTerminal: boolean;
}

export interface LeadDetail {
  id: string;
  name: string;
  category: string | null;

  phone: string | null;
  phoneIsMasked: boolean;
  /** Link wa.me pronto, ou null quando o número não é compatível. */
  whatsappUrl: string | null;
  email: string | null;

  website: string | null;
  websiteStatus: WebsiteStatus;

  address: {
    street: string | null;
    neighborhood: string | null;
    city: string | null;
    stateUf: string | null;
    postalCode: string | null;
    full: string | null;
    mapsUrl: string | null;
  };

  openHours: Record<string, string[]> | null;
  reviewCount: number | null;
  reviewRating: number | null;

  presence: {
    hasWebsite: SignalState;
    hasEmail: SignalState;
    hasPhone: SignalState;
    hasInstagram: SignalState;
    hasFacebook: SignalState;
    hasReviews: SignalState;
    whatsappStatus: WhatsAppStatus;
    instagramUrl: string | null;
    facebookUrl: string | null;
  };

  score: {
    value: number;
    level: ScoreLevelName;
    algorithmVersion: string;
    calculatedAt: string;
    positives: LeadScoreReasonView[];
    attentions: LeadScoreReasonView[];
    disqualified: boolean;
  };

  pipeline: {
    stages: PipelineStageView[];
    currentStageId: string | null;
    currentStageSlug: string | null;
    ownerName: string | null;
    enteredStageAt: string | null;
  };

  tracking: {
    lastActivityAt: string | null;
    nextFollowUpAt: string | null;
    lastContactedAt: string | null;
    lastEnrichedAt: string | null;
  };

  notes: LeadNoteView[];
  contactRecords: LeadContactRecordView[];
  followUps: LeadFollowUpView[];
  activities: LeadActivityView[];

  isFavorite: boolean;
  isDisqualified: boolean;
  isDemo: boolean;
  createdAt: string;
}

export interface LeadQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  stateUf?: string;
  city?: string;
  category?: string;
  stageSlug?: string;
  /** SEM_SITE + SITE_PRECARIO — o recorte que importa comercialmente. */
  withoutOwnWebsite?: boolean;
  likelyWhatsapp?: boolean;
  favoritesOnly?: boolean;
  minScore?: number;
  sortBy?: 'score' | 'name' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

/** Opções de filtro derivadas do próprio acervo do tenant. */
export interface LeadFacets {
  states: string[];
  cities: string[];
  categories: string[];
  stages: PipelineStageView[];
}
