export const OUTREACH_CHANNELS = ['WHATSAPP', 'EMAIL', 'INSTAGRAM', 'PHONE'] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const OUTREACH_TONES = [
  'CONSULTIVO',
  'DIRETO',
  'INFORMAL',
  'EXECUTIVO',
] as const;
export type OutreachTone = (typeof OUTREACH_TONES)[number];

export const CHANNEL_LABELS: Record<OutreachChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  INSTAGRAM: 'Instagram',
  PHONE: 'Ligação',
};

export const TONE_LABELS: Record<OutreachTone, string> = {
  CONSULTIVO: 'Consultivo',
  DIRETO: 'Direto',
  INFORMAL: 'Informal',
  EXECUTIVO: 'Executivo',
};

export interface GenerateOutreachInput {
  channel: OutreachChannel;
  tone: OutreachTone;
  serviceOffered?: string;
  objective?: string;
  callToAction?: string;
  extraNotes?: string;
}

export interface OutreachMessageView {
  id: string;
  channel: OutreachChannel;
  tone: OutreachTone;
  content: string;
  provider: string;
  model: string | null;
  version: number;
  isSent: boolean;
  sentAt: string | null;
  authorName: string | null;
  createdAt: string;
}

export interface OutreachQuotaView {
  planCode: string;
  used: number;
  included: number;
  available: number;
  enabled: boolean;
}

/**
 * Contrato do provider de IA.
 *
 * Na v0.1.1 só existe o MockAIProvider, determinístico e sem chave externa.
 * OpenAI e Anthropic entram como adapters que implementam esta mesma
 * interface — nenhuma camada acima precisa saber qual está ativo.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string | null;
  generateOutreach(input: {
    prompt: string;
    channel: OutreachChannel;
    tone: OutreachTone;
  }): Promise<{ content: string; tokensEstimated: number }>;
}

/** Contexto do lead entregue ao provider. Só dados que o produto já possui. */
export interface OutreachLeadContext {
  name: string;
  category: string | null;
  city: string | null;
  stateUf: string | null;
  websiteStatus: string;
  website: string | null;
  reviewCount: number | null;
  reviewRating: number | null;
  hasWhatsapp: boolean;
  scoreValue: number;
  scoreReasons: string[];
}
