import type { PlanCode } from './common';
import type { PlanLimits } from './auth';

export interface PlanCardView {
  code: PlanCode;
  name: string;
  priceCents: number;
  currency: string;
  limits: PlanLimits;
  isCurrent: boolean;
  sortOrder: number;
}

export interface SubscriptionUsageView {
  leadsUsed: number;
  leadsIncluded: number;
  aiGenerationsUsed: number;
  aiGenerationsIncluded: number;
  searchesCount: number;
  periodStart: string;
  periodEnd: string;
}

export interface SubscriptionResponse {
  currentPlan: PlanCode;
  status: string;
  usage: SubscriptionUsageView;
  plans: PlanCardView[];
}

export interface PreferencesView {
  servicesSold: string[];
  targetNiches: string[];
  targetRegions: string[];
  preferredChannel: string | null;
  monthlyGoal: string | null;
  completedAt: string | null;
}

export interface UpdatePreferencesInput {
  servicesSold?: string[];
  targetNiches?: string[];
  targetRegions?: string[];
  preferredChannel?: string;
  monthlyGoal?: string;
}

/** Opções sugeridas no onboarding e em Configurações. */
export const SERVICE_OPTIONS = [
  'Sites',
  'Tráfego pago',
  'Social media',
  'Design',
  'Consultoria',
] as const;

export const CHANNEL_OPTIONS = ['WhatsApp', 'Instagram', 'E-mail', 'Ligação'] as const;

export const GOAL_OPTIONS = ['1 a 3', '4 a 10', '11 a 20', 'Mais de 20'] as const;
