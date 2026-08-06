import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6381';

    this.client = new Redis(url, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis: ${error.message}`);
    });

    this.client.on('connect', () => {
      this.logger.log(`Conectado ao Redis em ${url}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  /** Usado pelo healthcheck. Nao lanca: devolve false em caso de falha. */
  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
