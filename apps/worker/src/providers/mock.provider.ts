import type {
  CreateSourceSearchInput,
  LeadSourceProvider,
  RawLead,
  SourceJob,
  SourceJobStatus,
} from '@propectai/types';

/**
 * Provider de teste.
 *
 * Existe para que todo o ciclo — fila, normalização, deduplicação, score,
 * cota, notificação — possa ser validado sem depender do Google. É o provider
 * padrão até a Fase 4 estar comprovada; só então `LEAD_SOURCE_PROVIDER`
 * passa para `google-maps`.
 */

const CATEGORIES = [
  'Dentista',
  'Clínica de estética',
  'Salão de beleza',
  'Academia',
  'Restaurante',
];

const NEIGHBORHOODS = ['Centro', 'Jardins', 'Vila Nova', 'Santa Cruz', 'Bela Vista'];

interface MockJob {
  input: CreateSourceSearchInput;
  createdAt: Date;
}

export class MockLeadSourceProvider implements LeadSourceProvider {
  readonly name = 'mock';

  private readonly jobs = new Map<string, MockJob>();

  async createSearch(input: CreateSourceSearchInput): Promise<SourceJob> {
    const externalJobId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.jobs.set(externalJobId, { input, createdAt: new Date() });

    return { externalJobId, status: 'QUEUED' };
  }

  async getJob(externalJobId: string): Promise<SourceJobStatus> {
    const job = this.jobs.get(externalJobId);
    const elapsed = job ? Date.now() - job.createdAt.getTime() : 9999;

    // Simula um segundo de trabalho para que a interface exercite os
    // estados de progresso em vez de saltar direto para o resultado.
    const done = elapsed > 1000;

    return {
      externalJobId,
      status: done ? 'COMPLETED' : 'RUNNING',
      resultCount: done ? this.countFor(externalJobId) : 0,
      error: null,
      createdAt: job?.createdAt.toISOString() ?? null,
      startedAt: job?.createdAt.toISOString() ?? null,
      completedAt: done ? new Date().toISOString() : null,
    };
  }

  async getResults(externalJobId: string): Promise<RawLead[]> {
    const job = this.jobs.get(externalJobId);
    if (!job) return [];

    const total = this.countFor(externalJobId);
    const [niche = 'Negócios', place = 'São Paulo, SP'] =
      job.input.keyword.split(' em ');

    const [city = 'São Paulo', stateName = 'São Paulo'] = place.split(', ');

    return Array.from({ length: total }, (_, index) => {
      const seed = index + 1;
      const hasWebsite = seed % 3 !== 0;
      const isPoorSite = seed % 4 === 0;
      const isMobile = seed % 5 !== 0;

      return {
        title: `${niche.replace(/s$/, '')} Demonstração ${seed}`,
        category: CATEGORIES[index % CATEGORIES.length] ?? 'Serviço local',
        phone: isMobile ? `(11) 9${8000 + seed}-00${seed % 10}0` : `(11) 3${100 + seed}-0010`,
        email: seed % 2 === 0 ? `contato${seed}@exemplo-demo.com.br` : null,
        website: hasWebsite
          ? isPoorSite
            ? `https://negocio${seed}-demo.wixsite.com/inicio`
            : `https://negocio${seed}-demo.com.br`
          : null,
        addressFull: `Rua Exemplo, ${100 + seed} - ${NEIGHBORHOODS[index % NEIGHBORHOODS.length]}, ${city}`,
        street: `Rua Exemplo, ${100 + seed}`,
        neighborhood: NEIGHBORHOODS[index % NEIGHBORHOODS.length] ?? 'Centro',
        city,
        stateName,
        postalCode: seed % 6 === 0 ? null : `0${1000 + seed}-000`,
        latitude: -23.55 + seed / 1000,
        longitude: -46.63 - seed / 1000,
        reviewCount: [3, 8, 22, 47, 130][index % 5] ?? 5,
        reviewRating: [4.9, 4.5, 3.8, 4.2, 2.6][index % 5] ?? 4.4,
        openHours: seed % 7 === 0 ? null : { 'segunda-feira': ['09:00–18:00'] },
        timezone: 'America/Sao_Paulo',
        placeId: `mock-place-${externalJobId}-${seed}`,
        cid: null,
        sourceUrl: null,
        status: null,
      };
    });
  }

  async cancelJob(externalJobId: string): Promise<void> {
    this.jobs.delete(externalJobId);
  }

  private countFor(externalJobId: string): number {
    const job = this.jobs.get(externalJobId);
    return job?.input.maxDepth ? Math.min(job.input.maxDepth, 20) : 10;
  }
}
