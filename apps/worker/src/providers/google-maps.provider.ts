import type {
  CreateSourceSearchInput,
  LeadSourceProvider,
  RawLead,
  ScrapeJobStatus,
  SourceJob,
  SourceJobStatus,
} from '@propectai/types';

import { config } from '../config';
import { logger } from '../logger';

/**
 * Adapter do gosom/google-maps-scraper.
 *
 * O produto não fala com o scraper em lugar nenhum além daqui. Trocar o motor
 * significa escrever outro arquivo como este, sem tocar em worker, API ou front.
 */

interface ScrapeResponse {
  job_id: string;
  status: string;
}

interface JobStatusResponse {
  job_id: string;
  status: string;
  result_count?: number;
  error?: string;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  results?: unknown;
}

/** Entrada bruta do scraper. Campos opcionais porque nem sempre vêm. */
interface ScraperEntry {
  title?: string;
  name?: string;
  category?: string;
  categories?: string[];
  phone?: string;
  emails?: string[] | string;
  website?: string;
  address?: string;
  complete_address?: {
    street?: string;
    borough?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  latitude?: number;
  longitude?: number;
  review_count?: number;
  review_rating?: number;
  open_hours?: Record<string, string[]>;
  timezone?: string;
  place_id?: string;
  cid?: string | number;
  link?: string;
  status?: string;
}

function mapStatus(raw: string): ScrapeJobStatus {
  const value = raw.toLowerCase();
  if (['pending', 'available', 'queued', 'new'].includes(value)) return 'QUEUED';
  if (['running', 'working', 'in_progress'].includes(value)) return 'RUNNING';
  if (['completed', 'done', 'ok', 'success', 'finished'].includes(value)) {
    return 'COMPLETED';
  }
  if (['failed', 'error', 'discarded'].includes(value)) return 'FAILED';
  if (['cancelled', 'canceled'].includes(value)) return 'CANCELLED';

  logger.warn({ status: raw }, 'Status desconhecido do scraper, tratando como RUNNING');
  return 'RUNNING';
}

export class GoogleMapsScraperProvider implements LeadSourceProvider {
  readonly name = 'google-maps';

  private readonly baseUrl: string;

  constructor(baseUrl: string = config.scraperBaseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async createSearch(input: CreateSourceSearchInput): Promise<SourceJob> {
    const body: Record<string, unknown> = {
      keyword: input.keyword,
      lang: input.lang || 'pt',
      // Teto de 300 segundos imposto pelo scraper. Buscas maiores precisam
      // ser fatiadas em vários jobs, não enviadas como um só.
      timeout: Math.min(input.timeoutSeconds ?? config.scraperTimeoutSeconds, 300),
      max_depth: Math.min(input.maxDepth ?? 1, 100),
      // Extração de e-mail visita o site de cada lead. Vale o custo: e-mail
      // em domínio próprio é um dos sinais mais fortes do score.
      email: input.extractEmail ?? true,
      fast_mode: input.fastMode ?? false,
    };

    if (input.radiusKm) body.radius = input.radiusKm;
    if (input.zoom) body.zoom = input.zoom;
    if (input.latitude !== undefined && input.longitude !== undefined) {
      body.geo_coordinates = `${input.latitude},${input.longitude}`;
    }

    const data = await this.request<ScrapeResponse>('/api/v1/scrape', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return { externalJobId: data.job_id, status: mapStatus(data.status) };
  }

  async getJob(externalJobId: string): Promise<SourceJobStatus> {
    const data = await this.request<JobStatusResponse>(`/api/v1/jobs/${externalJobId}`);

    return {
      externalJobId: data.job_id ?? externalJobId,
      status: mapStatus(data.status),
      resultCount: data.result_count ?? 0,
      error: data.error && data.error !== '' ? data.error : null,
      createdAt: data.created_at ?? null,
      startedAt: data.started_at ?? null,
      completedAt: data.completed_at ?? null,
    };
  }

  async getResults(externalJobId: string): Promise<RawLead[]> {
    const data = await this.request<JobStatusResponse>(`/api/v1/jobs/${externalJobId}`);
    const results = Array.isArray(data.results) ? (data.results as ScraperEntry[]) : [];

    return results.map((entry) => this.toRawLead(entry));
  }

  async cancelJob(externalJobId: string): Promise<void> {
    await this.request(`/api/v1/jobs/${externalJobId}`, { method: 'DELETE' });
  }

  /**
   * Prova de alcance real do scraper.
   *
   * Nao basta responder 200: o servidor devolve a UI HTML com 200 para qualquer
   * caminho desconhecido. Só conta como alcancavel se responder JSON no endpoint
   * de jobs, que é o unico contrato que o produto de fato consome.
   *
   * Nao lanca — o chamador é healthcheck, e healthcheck que derruba a resposta
   * inteira deixa de informar exatamente quando é mais necessario.
   */
  async probe(): Promise<{ reachable: boolean; detail: string | null }> {
    try {
      await this.request<unknown>('/api/v1/jobs');
      return { reachable: true, detail: null };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn({ detail }, 'Scraper inalcancavel');
      return { reachable: false, detail };
    }
  }

  // ---------------------------------------------------------------------------

  /**
   * Converte a entrada bruta, descartando dados pessoais de terceiros.
   *
   * O scraper devolve `user_reviews` e `owner` com nome, foto e URL de perfil
   * de pessoas físicas identificáveis. O produto precisa de quantas avaliações
   * e da média — não de quem escreveu. Esses campos nunca saem daqui.
   */
  private toRawLead(entry: ScraperEntry): RawLead {
    const emails = Array.isArray(entry.emails)
      ? entry.emails
      : entry.emails
        ? [entry.emails]
        : [];

    return {
      title: entry.title ?? entry.name ?? 'Sem nome',
      category: entry.category ?? entry.categories?.[0] ?? null,
      phone: entry.phone ?? null,
      email: emails[0] ?? null,
      website: entry.website ?? null,
      addressFull: entry.address ?? null,
      street: entry.complete_address?.street ?? null,
      neighborhood: entry.complete_address?.borough ?? null,
      city: entry.complete_address?.city ?? null,
      // Nome por extenso. A normalização converte para sigla.
      stateName: entry.complete_address?.state ?? null,
      postalCode: entry.complete_address?.postal_code ?? null,
      latitude: entry.latitude ?? null,
      longitude: entry.longitude ?? null,
      reviewCount: entry.review_count ?? null,
      reviewRating: entry.review_rating ?? null,
      openHours: entry.open_hours ?? null,
      timezone: entry.timezone ?? null,
      placeId: entry.place_id ?? null,
      cid: entry.cid !== undefined ? String(entry.cid) : null,
      sourceUrl: entry.link ?? null,
      status: entry.status ?? null,
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Scraper respondeu ${response.status} em ${path}${text ? `: ${text.slice(0, 200)}` : ''}`,
      );
    }

    if (response.status === 204) return undefined as T;

    // Guarda de content-type.
    //
    // O scraper tem rota catch-all: caminho inexistente devolve a UI HTML com
    // 200, nao 404. Sem esta checagem o erro que chega ao operador é
    // "Unexpected token '<' is not valid JSON" — sintoma, nao causa. Falhar
    // aqui nomeia o problema real: a rota nao existe.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      const text = await response.text().catch(() => '');
      const preview = text.trim().slice(0, 120).replace(/\s+/g, ' ');
      throw new Error(
        `Scraper devolveu ${contentType || 'conteudo sem content-type'} em ${path}, ` +
          `nao JSON. A rota provavelmente nao existe — o servidor responde a UI ` +
          `com 200 para caminho desconhecido.${preview ? ` Inicio: ${preview}` : ''}`,
      );
    }

    return (await response.json()) as T;
  }
}
