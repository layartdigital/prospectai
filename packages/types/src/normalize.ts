import { DEFAULT_POOR_WEBSITE_DOMAINS, type WebsiteStatus, type WhatsAppStatus } from './lead';

/**
 * Normalização compartilhada.
 *
 * Vive aqui, sem dependência de framework, para que worker, API e seed
 * produzam exatamente o mesmo fingerprint e a mesma classificação. Duas
 * implementações do mesmo fingerprint significam deduplicação que não
 * deduplica — e cobrança em cima de lead repetido.
 */

/**
 * O scraper devolve o estado por extenso ("São Paulo"), não a sigla.
 * Sem esta conversão, filtro por estado simplesmente não funciona.
 */
const STATE_BY_NAME: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

const VALID_UFS = new Set(Object.values(STATE_BY_NAME));

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

/** Aceita sigla ou nome por extenso. Devolve null quando não reconhece. */
export function toStateUf(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (trimmed.length === 2 && VALID_UFS.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }

  // "State of São Paulo" aparece quando o scraper roda com lang=en.
  const cleaned = stripAccents(trimmed)
    .toLowerCase()
    .replace(/^state of\s+/, '')
    .replace(/^estado de\s+/, '')
    .trim();

  return STATE_BY_NAME[cleaned] ?? null;
}

/** Normaliza para E.164 brasileiro. Devolve null quando não dá para confiar. */
export function toE164BR(phone: string | null | undefined): string | null {
  if (!phone) return null;

  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);

  // Fixo tem 10 dígitos (DDD + 8), celular tem 11 (DDD + 9).
  if (digits.length !== 10 && digits.length !== 11) return null;

  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;

  return `+55${digits}`;
}

/**
 * Celular brasileiro: 11 dígitos com 9 na primeira posição do número.
 * É o máximo que dá para afirmar sem verificação externa — daí o rótulo
 * "WhatsApp provável", nunca "com WhatsApp".
 */
export function whatsappStatusFromPhone(
  phone: string | null | undefined,
): WhatsAppStatus {
  const e164 = toE164BR(phone);
  if (!e164) return 'UNKNOWN';

  const national = e164.slice(3);
  return national.length === 11 && national[2] === '9' ? 'LIKELY' : 'UNKNOWN';
}

/** Remove sufixos societários e pontuação para comparar nomes de empresa. */
export function normalizeBusinessName(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/\b(ltda|me|epp|eireli|s\/a|sa|mei)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Impressão digital do lead: nome normalizado + telefone + CEP.
 *
 * Usada quando não há placeId. Precisa ser idêntica em worker e seed —
 * por isso mora aqui e não em cada um.
 *
 * Recebe o hasher por parâmetro para não acoplar este pacote ao node:crypto,
 * que não existe no browser.
 */
export function fingerprintInput(
  name: string,
  phoneE164: string | null,
  postalCode: string | null,
): string {
  return `${normalizeBusinessName(name)}|${phoneE164 ?? ''}|${(postalCode ?? '').replace(/\D/g, '')}`;
}

/**
 * Classifica o site em três estados.
 *
 * Domínio de construtor gratuito, encurtador ou rede social usada como site
 * é SITE_PRECARIO: oportunidade comercial quase tão boa quanto não ter site.
 * Tratá-lo como "já resolvido" descarta receita.
 */
export function classifyWebsite(
  website: string | null | undefined,
  poorDomains: readonly string[] = DEFAULT_POOR_WEBSITE_DOMAINS,
): { status: WebsiteStatus; hasHttps: boolean | null } {
  if (!website || website.trim() === '') {
    return { status: 'SEM_SITE', hasHttps: null };
  }

  const raw = website.trim();
  const hasHttps = raw.toLowerCase().startsWith('https://');

  let host: string;
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    // URL malformada não é prova de ausência de site.
    return { status: 'DESCONHECIDO', hasHttps: null };
  }

  const isPoor = poorDomains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );

  return {
    status: isPoor ? 'SITE_PRECARIO' : 'SITE_PROPRIO',
    hasHttps,
  };
}

/** Monta a consulta enviada ao scraper. */
export function buildSearchKeyword(input: {
  niche: string;
  city: string;
  stateUf: string;
  neighborhood?: string | null;
}): string {
  const place = input.neighborhood
    ? `${input.neighborhood}, ${input.city}, ${input.stateUf}`
    : `${input.city}, ${input.stateUf}`;

  return `${input.niche} em ${place}`;
}
