import type { ScoreLevelName, WebsiteStatus, WhatsAppStatus } from './lead';
import {
  DEFAULT_SCORE_WEIGHTS,
  SCORE_ALGORITHM_VERSION,
  resolveScoreLevel,
  type ScoreReason,
  type ScoreReasonCode,
  type ScoreResult,
} from './score';

/**
 * Motor de score determinístico - fonte única de verdade.
 *
 * Vive aqui, sem dependência de framework, para que API, worker e seed usem
 * exatamente o mesmo cálculo. Duplicar essa lógica seria a forma mais rápida
 * de o score da tela discordar do score do banco.
 *
 * Referência dos pesos e da justificativa: docs/technical/scoring.md
 *
 * Regra fundadora: o score só pontua o que foi efetivamente observado.
 * Sinal não verificado não pontua - nem a favor, nem contra.
 */

const FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'yahoo.com.br',
  'bol.com.br',
  'uol.com.br',
  'terra.com.br',
  'live.com',
  'icloud.com',
];

const STALE_DATA_DAYS = 90;
const RECENT_CONTACT_DAYS = 30;

export interface ScoreInput {
  websiteStatus: WebsiteStatus;
  websiteHasHttps: boolean | null;
  hasPhone: boolean;
  whatsappStatus: WhatsAppStatus;
  email: string | null;
  reviewCount: number | null;
  reviewRating: number | null;
  hasOpenHours: boolean;
  hasCompleteAddress: boolean;
  /** Categoria do lead está nos nichos prioritários do tenant. */
  isPriorityNiche: boolean;
  /** Cidade do lead está nas regiões atendidas pelo tenant. */
  isServedRegion: boolean;
  lastContactedAt: Date | null;
  lastEnrichedAt: Date | null;
  isSuppressed: boolean;
  isPermanentlyClosed: boolean;
}

interface Weights {
  [code: string]: number;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export function computeScore(
  input: ScoreInput,
  options: { weights?: Weights; now?: Date } = {},
): ScoreResult {
  const now = options.now ?? new Date();
  const w: Weights = { ...DEFAULT_SCORE_WEIGHTS, ...options.weights };
  const reasons: ScoreReason[] = [];

  const add = (
    code: ScoreReasonCode,
    label: string,
    evidence: string | null,
  ): void => {
    const weight = w[code] ?? 0;
    if (weight === 0) return;
    reasons.push({
      code,
      label,
      weight,
      polarity: weight > 0 ? 'POSITIVE' : 'NEGATIVE',
      evidence,
    });
  };

  // -------------------------------------------------------------------------
  // Desqualificação - não passa pela soma
  // -------------------------------------------------------------------------
  if (input.isSuppressed || input.isPermanentlyClosed) {
    const disqualifying: ScoreReason = input.isSuppressed
      ? {
          code: 'SUPPRESSED',
          label: 'Lead está na lista de supressão',
          weight: 0,
          polarity: 'DISQUALIFYING',
          evidence: 'suppressedAt preenchido',
        }
      : {
          code: 'PERMANENTLY_CLOSED',
          label: 'Empresa permanentemente fechada',
          weight: 0,
          polarity: 'DISQUALIFYING',
          evidence: 'status: permanently_closed',
        };

    return {
      value: 0,
      level: 'BAIXA',
      algorithmVersion: SCORE_ALGORITHM_VERSION,
      disqualified: true,
      reasons: [disqualifying],
    };
  }

  // -------------------------------------------------------------------------
  // Presença de site - o sinal mais forte. Mutuamente exclusivos.
  // -------------------------------------------------------------------------
  if (input.websiteStatus === 'SEM_SITE') {
    add('NO_WEBSITE', 'Não possui site próprio', 'website: (vazio)');
  } else if (input.websiteStatus === 'SITE_PRECARIO') {
    add(
      'POOR_WEBSITE',
      'Site em construtor gratuito ou rede social',
      'domínio na lista de construtores gratuitos',
    );
  } else if (input.websiteStatus === 'SITE_PROPRIO' && input.websiteHasHttps === false) {
    add('WEBSITE_NO_HTTPS', 'Site sem HTTPS', 'website inicia com http://');
  }

  // -------------------------------------------------------------------------
  // Contatabilidade
  // -------------------------------------------------------------------------
  if (input.hasPhone) {
    add('PHONE_AVAILABLE', 'Telefone disponível', 'telefone presente');
  }

  if (input.whatsappStatus === 'LIKELY' || input.whatsappStatus === 'VERIFIED') {
    add(
      'WHATSAPP_LIKELY',
      input.whatsappStatus === 'VERIFIED' ? 'WhatsApp confirmado' : 'WhatsApp provável',
      'telefone com formato de celular brasileiro',
    );
  }

  if (input.email) {
    add('EMAIL_AVAILABLE', 'E-mail disponível', input.email);

    const domain = input.email.split('@')[1]?.toLowerCase() ?? '';
    if (domain && !FREE_EMAIL_DOMAINS.includes(domain)) {
      add('EMAIL_OWN_DOMAIN', 'E-mail em domínio próprio', domain);
    }
  }

  // -------------------------------------------------------------------------
  // Sinais de negócio ativo
  //
  // A faixa de avaliações é invertida de propósito: poucas avaliações indica
  // presença digital imatura, que é justamente quem precisa do serviço.
  // Um negócio com 500 avaliações provavelmente já tem agência.
  // -------------------------------------------------------------------------
  const reviews = input.reviewCount ?? 0;
  if (reviews >= 1 && reviews <= 9) {
    add('FEW_REVIEWS', 'Poucas avaliações — presença digital imatura', `${reviews} avaliações`);
  } else if (reviews >= 10 && reviews <= 49) {
    add('SOME_REVIEWS', 'Volume moderado de avaliações', `${reviews} avaliações`);
  } else if (reviews >= 50) {
    add('MANY_REVIEWS', 'Volume relevante de avaliações', `${reviews} avaliações`);
  }

  if (input.reviewRating !== null && input.reviewRating >= 4) {
    add('GOOD_RATING', 'Boa reputação no Google', `nota ${input.reviewRating}`);
  }

  if (input.hasOpenHours) {
    add('HAS_OPEN_HOURS', 'Horário de funcionamento cadastrado', 'open_hours presente');
  }

  if (input.hasCompleteAddress) {
    add('COMPLETE_ADDRESS', 'Endereço completo com CEP', 'CEP presente');
  }

  // -------------------------------------------------------------------------
  // Alinhamento com o tenant - o que torna o score específico de cada cliente
  // -------------------------------------------------------------------------
  if (input.isPriorityNiche) {
    add('PRIORITY_NICHE', 'Nicho prioritário do seu perfil', 'categoria nas preferências');
  }

  if (input.isServedRegion) {
    add('SERVED_REGION', 'Cidade dentro da sua área de atuação', 'cidade nas preferências');
  }

  // -------------------------------------------------------------------------
  // Penalidades
  // -------------------------------------------------------------------------
  if (input.reviewRating !== null && input.reviewRating < 3 && reviews >= 10) {
    add('LOW_RATING', 'Reputação baixa no Google', `nota ${input.reviewRating}`);
  }

  if (input.lastEnrichedAt && daysBetween(input.lastEnrichedAt, now) > STALE_DATA_DAYS) {
    add(
      'STALE_DATA',
      'Dados desatualizados',
      `última atualização há ${daysBetween(input.lastEnrichedAt, now)} dias`,
    );
  }

  if (input.lastContactedAt && daysBetween(input.lastContactedAt, now) <= RECENT_CONTACT_DAYS) {
    add(
      'RECENTLY_CONTACTED',
      'Contatado recentemente',
      `último contato há ${daysBetween(input.lastContactedAt, now)} dias`,
    );
  }

  const raw = reasons.reduce((sum, reason) => sum + reason.weight, 0);
  const value = Math.min(100, Math.max(0, raw));

  return {
    value,
    level: resolveScoreLevel(value) as ScoreLevelName,
    algorithmVersion: SCORE_ALGORITHM_VERSION,
    disqualified: false,
    reasons,
  };
}
