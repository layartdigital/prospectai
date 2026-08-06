import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse, VersionResponse } from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

import { ScraperHealthService } from './scraper-health.service';

@ApiTags('system')
@Controller()
export class SystemController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly scraper: ScraperHealthService,
  ) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Health check',
    description:
      'Verifica conectividade com PostgreSQL, Redis e o motor de coleta. Nao ' +
      'exige autenticacao nem tenant. Usado pelo rodape da aplicacao. Responde ' +
      '200 mesmo em estado degradado - o campo status indica a situacao real. ' +
      'PostgreSQL e Redis sao essenciais; o scraper apenas degrada, porque a ' +
      'aplicacao inteira funciona sem ele exceto iniciar busca nova.',
  })
  @ApiResponse({ status: 200, description: 'Estado dos servicos de infraestrutura' })
  async health(): Promise<HealthResponse> {
    const [database, redis, scraper] = await Promise.all([
      this.prisma.isHealthy(),
      this.redis.isHealthy(),
      this.scraper.isHealthy(),
    ]);

    // 'down' continua reservado a perda dos dois servicos essenciais. Scraper
    // fora nunca leva o sistema a 'down': o usuario ainda le leads, move o
    // pipeline e registra contato — so nao dispara coleta nova.
    const allOk = database && redis && scraper;
    const noneOk = !database && !redis;

    return {
      status: allOk ? 'ok' : noneOk ? 'down' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: database ? 'ok' : 'down',
        redis: redis ? 'ok' : 'down',
        scraper: scraper ? 'ok' : 'down',
      },
    };
  }

  @Get('system/version')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Versao do sistema',
    description:
      'Devolve nome, versao semantica e ambiente. Consumido pelo rodape da ' +
      'aplicacao e pela tela de Configuracoes. Nao exige autenticacao.',
  })
  @ApiResponse({ status: 200, description: 'Versao e ambiente' })
  version(): VersionResponse {
    return {
      name: this.config.get<string>('APP_NAME') ?? 'PropectAI',
      version: this.config.get<string>('APP_VERSION') ?? '0.1.1',
      environment: this.config.get<string>('NODE_ENV') ?? 'development',
      commit: this.config.get<string>('GIT_COMMIT') ?? null,
      builtAt: this.config.get<string>('BUILT_AT') ?? null,
    };
  }
}
