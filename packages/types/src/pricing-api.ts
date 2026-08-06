/**
 * Precificador.
 *
 * O cálculo vive aqui, puro, para que a interface mostre o resultado
 * instantaneamente enquanto o usuário move os controles, e o servidor possa
 * usar a mesma função quando a proposta for gerada. Duas implementações do
 * mesmo cálculo produziriam proposta com valor diferente do simulado.
 */

export const SERVICE_TYPES = [
  'Site institucional',
  'Landing page',
  'Loja virtual',
  'Gestão de tráfego',
  'Social media',
  'SEO',
  'Google Meu Negócio',
  'Automação',
  'CRM',
  'Consultoria',
  'Outro',
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const COMPLEXITY_LEVELS = ['BAIXA', 'MEDIA', 'ALTA'] as const;
export type ComplexityLevel = (typeof COMPLEXITY_LEVELS)[number];

export const URGENCY_LEVELS = ['NORMAL', 'PRIORIDADE', 'URGENTE'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const COMPLEXITY_MULTIPLIER: Record<ComplexityLevel, number> = {
  BAIXA: 1,
  MEDIA: 1.3,
  ALTA: 1.6,
};

export const URGENCY_MULTIPLIER: Record<UrgencyLevel, number> = {
  NORMAL: 1,
  PRIORIDADE: 1.2,
  URGENTE: 1.4,
};

export const COMPLEXITY_LABELS: Record<ComplexityLevel, string> = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
};

export const COMPLEXITY_HINTS: Record<ComplexityLevel, string> = {
  BAIXA: 'Projeto simples, sem integrações',
  MEDIA: 'Customizações moderadas, alguma integração',
  ALTA: 'Muitas páginas ou várias integrações',
};

export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  NORMAL: 'Normal',
  PRIORIDADE: 'Prioridade',
  URGENTE: 'Urgente',
};

export const URGENCY_HINTS: Record<UrgencyLevel, string> = {
  NORMAL: 'Prazo padrão de mercado',
  PRIORIDADE: 'Entrega em até duas semanas',
  URGENTE: 'Entra na frente do que já está na fila',
};

export interface PricingExtra {
  key: string;
  label: string;
  priceCents: number;
}

export const DEFAULT_EXTRAS: PricingExtra[] = [
  { key: 'whatsapp', label: 'Integração WhatsApp', priceCents: 20000 },
  { key: 'form', label: 'Formulário avançado', priceCents: 15000 },
  { key: 'seo-basic', label: 'SEO básico', priceCents: 30000 },
  { key: 'seo-advanced', label: 'SEO avançado', priceCents: 60000 },
  { key: 'blog', label: 'Blog', priceCents: 40000 },
  { key: 'admin', label: 'Área administrativa', priceCents: 80000 },
  { key: 'api', label: 'Integração com API', priceCents: 50000 },
  { key: 'hosting', label: 'Hospedagem (primeiro ano)', priceCents: 10000 },
  { key: 'domain', label: 'Domínio', priceCents: 5000 },
];

export interface PricingInput {
  hourlyRateCents: number;
  estimatedHours: number;
  complexity: ComplexityLevel;
  urgency: UrgencyLevel;
  extrasCents: number;
  /** Margem em pontos percentuais sobre o subtotal. */
  marginPercent: number;
}

export interface PricingResult {
  baseCents: number;
  complexityCents: number;
  urgencyCents: number;
  extrasCents: number;
  marginCents: number;
  finalCents: number;
  /** Faixa de negociação. */
  minimumCents: number;
  idealCents: number;
  premiumCents: number;
  /** Quanto a hora realmente vale ao final. */
  effectiveHourlyCents: number;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const base = input.hourlyRateCents * input.estimatedHours;

  const afterComplexity = base * COMPLEXITY_MULTIPLIER[input.complexity];
  const complexityCents = Math.round(afterComplexity - base);

  const afterUrgency = afterComplexity * URGENCY_MULTIPLIER[input.urgency];
  const urgencyCents = Math.round(afterUrgency - afterComplexity);

  const subtotal = afterUrgency + input.extrasCents;
  const marginCents = Math.round(subtotal * (input.marginPercent / 100));
  const finalCents = Math.round(subtotal + marginCents);

  return {
    baseCents: Math.round(base),
    complexityCents,
    urgencyCents,
    extrasCents: input.extrasCents,
    marginCents,
    finalCents,
    // A faixa mínima não é desconto arbitrário: é o ponto abaixo do qual
    // a margem some e o projeto passa a custar mais do que rende.
    minimumCents: Math.round(subtotal),
    idealCents: finalCents,
    premiumCents: Math.round(finalCents * 1.25),
    effectiveHourlyCents:
      input.estimatedHours > 0 ? Math.round(finalCents / input.estimatedHours) : 0,
  };
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
