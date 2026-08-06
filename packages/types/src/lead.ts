import type { SignalState } from './common';

/**
 * Classificacao de site em tres estados, nao dois.
 *
 * SITE_PRECARIO cobre dominio de construtor gratuito, encurtador ou rede
 * social usada como site. Um negocio nessa situacao e oportunidade comercial
 * quase tao boa quanto um sem site nenhum - trata-lo como "ja resolvido"
 * descarta receita real.
 */
export const WEBSITE_STATUSES = [
  'SEM_SITE',
  'SITE_PRECARIO',
  'SITE_PROPRIO',
  'DESCONHECIDO',
] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

/**
 * LIKELY = celular brasileiro. Nao houve verificacao externa.
 * O rotulo na interface e "WhatsApp provavel", nunca "Com WhatsApp".
 */
export const WHATSAPP_STATUSES = ['UNKNOWN', 'LIKELY', 'VERIFIED'] as const;
export type WhatsAppStatus = (typeof WHATSAPP_STATUSES)[number];

/** Dominios tratados como site precario. Sobrescrevivel por tenant em AppSetting. */
export const DEFAULT_POOR_WEBSITE_DOMAINS = [
  'base44.app',
  'wixsite.com',
  'negocio.site',
  'blogspot.com',
  'wordpress.com',
  'linktr.ee',
  'instagram.com',
  'facebook.com',
  'linkbio.co',
  'beacons.ai',
  'bio.link',
] as const;

export interface LeadDigitalPresence {
  hasWebsite: SignalState;
  hasEmail: SignalState;
  hasPhone: SignalState;
  hasInstagram: SignalState;
  hasFacebook: SignalState;
  hasReviews: SignalState;
  whatsappStatus: WhatsAppStatus;
  instagramUrl: string | null;
  facebookUrl: string | null;
  websiteHasHttps: boolean | null;
  lastCheckedAt: string | null;
}

export interface LeadAddress {
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  /** Sigla de duas letras. O scraper devolve o nome por extenso. */
  stateUf: string | null;
  postalCode: string | null;
  full: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface LeadSummary {
  id: string;
  name: string;
  category: string | null;
  address: LeadAddress;
  phoneE164: string | null;
  phoneMasked: string | null;
  email: string | null;
  website: string | null;
  websiteStatus: WebsiteStatus;
  reviewCount: number | null;
  reviewRating: number | null;
  score: number;
  scoreLevel: ScoreLevelName;
  presence: LeadDigitalPresence;
  isFavorite: boolean;
  isDisqualified: boolean;
  stageSlug: string | null;
  createdAt: string;
}

export type ScoreLevelName = 'BAIXA' | 'MEDIA' | 'ALTA' | 'MUITO_ALTA';

export interface LeadFilters {
  stateUf?: string;
  city?: string;
  niche?: string;
  noWebsite?: boolean;
  poorWebsite?: boolean;
  noInstagram?: boolean;
  likelyWhatsapp?: boolean;
  favoritesOnly?: boolean;
  minScore?: number;
  stageSlug?: string;
  search?: string;
}
