/**
 * Abstracao da fonte de leads.
 *
 * O motor concreto e o gosom/google-maps-scraper, mas nenhuma camada do
 * produto fala com ele diretamente. Toda interacao passa por esta interface,
 * o que permite trocar por mock nos testes e por CSV na importacao.
 */

export const SCRAPE_JOB_STATUSES = [
  'PENDING',
  'QUEUED',
  'RUNNING',
  'NORMALIZING',
  'SCORING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type ScrapeJobStatus = (typeof SCRAPE_JOB_STATUSES)[number];

export interface CreateSourceSearchInput {
  /** Consulta final, ex.: "dentistas em Sao Paulo, SP" */
  keyword: string;
  lang: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  zoom?: number;
  /** Paginacao do scraper. Teto de 100. */
  maxDepth?: number;
  /**
   * Teto de 300 segundos imposto pelo scraper. Buscas grandes precisam ser
   * fatiadas em varios jobs pelo worker, nao enviadas como job unico.
   */
  timeoutSeconds?: number;
  /** Extrai e-mails visitando o site do lead. Encarece a busca. */
  extractEmail?: boolean;
  fastMode?: boolean;
}

export interface SourceJob {
  externalJobId: string;
  status: ScrapeJobStatus;
}

export interface SourceJobStatus {
  externalJobId: string;
  status: ScrapeJobStatus;
  resultCount: number;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Lead bruto, ja higienizado.
 *
 * user_reviews, user_reviews_extended e o link de perfil em owner sao
 * DESCARTADOS antes de chegar aqui: sao dados pessoais de terceiros
 * (nome, foto, URL de perfil) sem finalidade comercial no produto.
 */
export interface RawLead {
  title: string;
  category: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressFull: string | null;
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  /** Como veio da fonte: nome por extenso. A normalizacao converte para sigla. */
  stateName: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  reviewCount: number | null;
  reviewRating: number | null;
  openHours: Record<string, string[]> | null;
  timezone: string | null;
  placeId: string | null;
  cid: string | null;
  sourceUrl: string | null;
  status: string | null;
}

export interface LeadSourceProvider {
  readonly name: string;
  createSearch(input: CreateSourceSearchInput): Promise<SourceJob>;
  getJob(externalJobId: string): Promise<SourceJobStatus>;
  getResults(externalJobId: string): Promise<RawLead[]>;
  cancelJob(externalJobId: string): Promise<void>;
}
