import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Verificacao de alcance do motor de coleta.
 *
 * Por que existe, dado que o worker ja tem GoogleMapsScraperProvider.probe():
 * a API nao depende do worker como workspace, e criar essa dependencia so para
 * um healthcheck acoplaria dois processos que hoje sao independentes. Sao ~30
 * linhas de fetch duplicadas contra um acoplamento permanente — a duplicacao
 * sai mais barata e esta declarada aqui.
 *
 * O contrato verificado e o mesmo dos dois lados: responder JSON em
 * /api/v1/jobs. Se um dia mudar, muda nos dois.
 */
@Injectable()
export class ScraperHealthService {
  private readonly logger = new Logger(ScraperHealthService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Nao lanca: devolve false em qualquer falha, igual a RedisService.isHealthy.
   * Healthcheck que derruba a propria resposta deixa de informar exatamente
   * quando e mais necessario.
   */
  async isHealthy(): Promise<boolean> {
    const baseUrl = (
      this.config.get<string>('SCRAPER_BASE_URL') ?? 'http://localhost:8081'
    ).replace(/\/+$/, '');

    // Timeout curto de proposito: o rodape da aplicacao consome este endpoint
    // a cada render. Scraper lento nao pode travar a renderizacao da pagina.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(`${baseUrl}/api/v1/jobs`, {
        signal: controller.signal,
      });

      if (!response.ok) return false;

      // 200 nao basta. O scraper tem rota catch-all que devolve a UI HTML com
      // 200 para caminho desconhecido — checar so o status aprovaria um
      // servidor que nao expoe a API que o produto consome.
      const contentType = response.headers.get('content-type') ?? '';
      return contentType.includes('json');
    } catch (error) {
      this.logger.warn(
        `Scraper inalcancavel em ${baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
