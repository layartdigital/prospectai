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

/**
 * Região administrativa, ciente do país.
 *
 * `toStateUf` devolve `null` para qualquer coisa fora da tabela de UF
 * brasileira. Enquanto o produto era só Brasil, isso era correto. Com alcance
 * global virou perda silenciosa de dado: uma busca em Milão produziria leads
 * sem região, sem erro e sem ninguém perceber — a pior forma de falhar num
 * produto de dados.
 *
 * Fora do Brasil, guarda o que a origem devolveu. Preferir o nome bruto a
 * `null` é decisão consciente: dado imperfeito com procedência é utilizável,
 * ausência não é.
 */
export function toRegion(
  value: string | null | undefined,
  country = 'BR',
): string | null {
  if (!value) return null;
  if (country.toUpperCase() === 'BR') return toStateUf(value);

  return value.trim() || null;
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
 * Telefone em E.164, ciente do país.
 *
 * No Brasil aplica a regra conhecida. Fora dele, aceita apenas o que já vem
 * em formato internacional — número que começa com `+` e tem entre 8 e 15
 * dígitos, que é o limite do padrão E.164.
 *
 * **Não tenta adivinhar código de país.** Inferir prefixo a partir de um
 * número local estrangeiro produz telefone plausível e errado, que é pior que
 * telefone ausente: alguém liga, e liga para a pessoa errada.
 *
 * Quando houver mercado internacional de verdade, a resposta certa é
 * `libphonenumber`, que conhece a regra de cada país. Até lá, ser honesto
 * sobre o que não se sabe custa menos que fingir.
 */
export function toE164(
  phone: string | null | undefined,
  country = 'BR',
): string | null {
  if (!phone) return null;
  if (country.toUpperCase() === 'BR') return toE164BR(phone);

  const trimmed = phone.trim();
  if (!trimmed.startsWith('+')) return null;

  const digits = trimmed.slice(1).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;

  return `+${digits}`;
}

/**
 * Celular brasileiro: 11 dígitos com 9 na primeira posição do número.
 * É o máximo que dá para afirmar sem verificação externa — daí o rótulo
 * "WhatsApp provável", nunca "com WhatsApp".
 *
 * Fora do Brasil devolve `UNKNOWN`, sempre. Cada país tem sua própria regra de
 * numeração móvel, e chutar violaria a regra 5.2 do escopo: sinal só vira
 * afirmação depois de verificação que aconteceu. `DESCONHECIDO` é resposta
 * legítima; palpite disfarçado de dado não é.
 */
export function whatsappStatusFromPhone(
  phone: string | null | undefined,
  country = 'BR',
): WhatsAppStatus {
  if (country.toUpperCase() !== 'BR') return 'UNKNOWN';

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
