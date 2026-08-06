import type { ScrapeJobStatus } from './lead-source';

export interface CreateSearchInput {
  niche: string;
  stateUf: string;
  city: string;
  neighborhood?: string;
  radiusKm?: number;
  requestedCount?: number;
}

export interface SearchStatusResponse {
  searchId: string;
  jobId: string;
  status: ScrapeJobStatus;
  /** 0 a 100. Derivado do estado do job, não de contagem parcial. */
  progress: number;
  message: string;
  resultCount: number;
  newLeadCount: number;
  duplicateCount: number;
  errorMessage: string | null;
  finishedAt: string | null;
}

export interface SearchQuotaResponse {
  planCode: string;
  leadsIncluded: number;
  leadsUsed: number;
  available: number;
}

/** Rótulo e peso de progresso por estado do job. */
export const JOB_PROGRESS: Record<ScrapeJobStatus, { progress: number; message: string }> = {
  PENDING: { progress: 5, message: 'Preparando a busca' },
  QUEUED: { progress: 15, message: 'Na fila de processamento' },
  RUNNING: { progress: 45, message: 'Consultando o Google Maps' },
  NORMALIZING: { progress: 70, message: 'Normalizando e deduplicando' },
  SCORING: { progress: 88, message: 'Calculando score de oportunidade' },
  COMPLETED: { progress: 100, message: 'Busca concluída' },
  FAILED: { progress: 100, message: 'A busca falhou' },
  CANCELLED: { progress: 100, message: 'Busca cancelada' },
};

/** Nichos sugeridos. O usuário pode digitar qualquer termo. */
export const SUGGESTED_NICHES = [
  'Dentistas',
  'Clínicas de Estética',
  'Salões de Beleza',
  'Barbearias',
  'Academias',
  'Restaurantes',
  'Advogados',
  'Imobiliárias',
  'Pet Shops',
  'Contadores',
  'Oficinas Mecânicas',
  'Lojas de Roupas',
  'Clínicas Veterinárias',
  'Escolas de Idiomas',
  'Fisioterapeutas',
] as const;

export const BRAZIL_STATES: { uf: string; name: string }[] = [
  { uf: 'AC', name: 'Acre' },
  { uf: 'AL', name: 'Alagoas' },
  { uf: 'AM', name: 'Amazonas' },
  { uf: 'AP', name: 'Amapá' },
  { uf: 'BA', name: 'Bahia' },
  { uf: 'CE', name: 'Ceará' },
  { uf: 'DF', name: 'Distrito Federal' },
  { uf: 'ES', name: 'Espírito Santo' },
  { uf: 'GO', name: 'Goiás' },
  { uf: 'MA', name: 'Maranhão' },
  { uf: 'MG', name: 'Minas Gerais' },
  { uf: 'MS', name: 'Mato Grosso do Sul' },
  { uf: 'MT', name: 'Mato Grosso' },
  { uf: 'PA', name: 'Pará' },
  { uf: 'PB', name: 'Paraíba' },
  { uf: 'PE', name: 'Pernambuco' },
  { uf: 'PI', name: 'Piauí' },
  { uf: 'PR', name: 'Paraná' },
  { uf: 'RJ', name: 'Rio de Janeiro' },
  { uf: 'RN', name: 'Rio Grande do Norte' },
  { uf: 'RO', name: 'Rondônia' },
  { uf: 'RR', name: 'Roraima' },
  { uf: 'RS', name: 'Rio Grande do Sul' },
  { uf: 'SC', name: 'Santa Catarina' },
  { uf: 'SE', name: 'Sergipe' },
  { uf: 'SP', name: 'São Paulo' },
  { uf: 'TO', name: 'Tocantins' },
];
