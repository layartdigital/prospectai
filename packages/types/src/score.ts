import type { ScoreLevelName } from './lead';

/**
 * Motor de score - contratos.
 * Referencia completa dos pesos: docs/technical/scoring.md
 *
 * O score e uma PRIORIZACAO COMERCIAL: em que ordem vale a pena abordar.
 * Nao e previsao de conversao nem nota de qualidade da empresa.
 */

export const SCORE_ALGORITHM_VERSION = 'score-v1';

export type ScoreReasonPolarity = 'POSITIVE' | 'NEGATIVE' | 'DISQUALIFYING';

export const SCORE_REASON_CODES = [
  'NO_WEBSITE',
  'POOR_WEBSITE',
  'WEBSITE_NO_HTTPS',
  'PHONE_AVAILABLE',
  'WHATSAPP_LIKELY',
  'EMAIL_AVAILABLE',
  'EMAIL_OWN_DOMAIN',
  'FEW_REVIEWS',
  'SOME_REVIEWS',
  'MANY_REVIEWS',
  'GOOD_RATING',
  'HAS_OPEN_HOURS',
  'COMPLETE_ADDRESS',
  'PRIORITY_NICHE',
  'SERVED_REGION',
  'LOW_RATING',
  'STALE_DATA',
  'RECENTLY_CONTACTED',
  'SUPPRESSED',
  'PERMANENTLY_CLOSED',
] as const;
export type ScoreReasonCode = (typeof SCORE_REASON_CODES)[number];

export interface ScoreReason {
  code: ScoreReasonCode;
  label: string;
  weight: number;
  polarity: ScoreReasonPolarity;
  /** O dado que embasou a pontuacao, ex.: "website: (vazio)". */
  evidence: string | null;
}

export interface ScoreResult {
  value: number;
  level: ScoreLevelName;
  algorithmVersion: string;
  disqualified: boolean;
  reasons: ScoreReason[];
}

/** Pesos padrao de fabrica. Sobrescreviveis por tenant em AppSetting. */
export const DEFAULT_SCORE_WEIGHTS: Record<ScoreReasonCode, number> = {
  NO_WEBSITE: 30,
  POOR_WEBSITE: 22,
  WEBSITE_NO_HTTPS: 15,
  PHONE_AVAILABLE: 5,
  WHATSAPP_LIKELY: 5,
  EMAIL_AVAILABLE: 8,
  EMAIL_OWN_DOMAIN: 2,
  FEW_REVIEWS: 10,
  SOME_REVIEWS: 6,
  MANY_REVIEWS: 2,
  GOOD_RATING: 5,
  HAS_OPEN_HOURS: 3,
  COMPLETE_ADDRESS: 3,
  PRIORITY_NICHE: 15,
  SERVED_REGION: 5,
  LOW_RATING: -10,
  STALE_DATA: -5,
  RECENTLY_CONTACTED: -15,
  SUPPRESSED: 0,
  PERMANENTLY_CLOSED: 0,
};

export function resolveScoreLevel(value: number): ScoreLevelName {
  if (value >= 85) return 'MUITO_ALTA';
  if (value >= 70) return 'ALTA';
  if (value >= 40) return 'MEDIA';
  return 'BAIXA';
}

export const SCORE_LEVEL_LABELS: Record<ScoreLevelName, string> = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  MUITO_ALTA: 'Muito alta',
};
