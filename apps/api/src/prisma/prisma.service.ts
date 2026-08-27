import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TENANT_SETTING, validarTenantId } from '@propectai/types';

/**
 * Teto da transacao com contexto de tenant.
 *
 * O padrao do Prisma e 5s, e 5s e apertado para a suite deste projeto sob
 * carga. Mas o numero nao existe para acomodar consulta lenta: existe para que
 * a **regra abaixo**, se violada, apareca como erro em vez de conexao presa.
 */
const TX_TIMEOUT_MS = 10_000;
const TX_MAX_WAIT_MS = 5_000;

/**
 * Passo 4: a API conecta com o papel que **esta** sujeito a politica.
 *
 * **Por que uma variavel nova, e nao trocar o `DATABASE_URL`.** O Prisma CLI le
 * o `DATABASE_URL`: `migrate`, `db:seed`, `db:studio` e os scripts de `prisma/`
 * passariam todos a conectar como um papel sem DDL, e a proxima migration
 * falharia. `directUrl` resolveria o `migrate` e deixaria o seed e os scripts
 * no mesmo problema. Entao e **opt-in por processo** — e reverter o passo 4
 * vira apagar uma linha do `.env`.
 *
 * O aviso e alto de proposito. Silenciar seria o pior dos casos: a API voltaria
 * a conectar como dono, o `FORCE` sairia do caminho, e **tudo continuaria
 * funcionando** — com os testes de isolamento passando sem a politica no meio.
 */
function urlDaAplicacao(): string | undefined {
  const url = process.env.DATABASE_URL_APP;
  if (url === undefined || url.trim() === '') {
    console.warn(
      '[db] DATABASE_URL_APP ausente — conectando como dono das tabelas. ' +
        'A politica de RLS NAO esta no caminho. Ver passo 4 do PLANO-RLS-v1.md.',
    );
    return undefined;
  }
  return url;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const datasourceUrl = urlDaAplicacao();
    super({
      ...(datasourceUrl === undefined ? {} : { datasourceUrl }),
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
          : [{ emit: 'stdout', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado ao PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Roda `fn` numa transacao com o tenant declarado ao Postgres.
   *
   * ---
   *
   * **Por que precisa ser transacao.** O terceiro argumento do `set_config` e
   * `is_local`, e com ele o valor vale ate o fim da transacao corrente. Sem
   * `BEGIN` explicito, cada statement e a sua propria transacao: o valor morre
   * no mesmo statement que o definiu, e o proximo ja nao o enxerga. Medido no
   * Postgres 16:
   *
   *     set_config('app.tenant_id','x',true);  -> devolve 'x'
   *     current_setting('app.tenant_id',true); -> vazio
   *
   * Ou seja, `set_config` solto **nao falha: ele nao faz nada.** Com RLS ligado
   * isso vira negacao total, silenciosa. Por isso o contexto so existe aqui
   * dentro, e nao ha versao "define o tenant nesta conexao".
   *
   * O outro lado da mesma moeda e o que torna o `is_local` obrigatorio: sem
   * ele, o valor ficaria colado na **conexao**, e o pool entregaria essa
   * conexao ao proximo tenant. Um vazamento entre clientes, nao um bug de
   * consulta.
   *
   * ---
   *
   * **Regra ao usar: nada de I/O externo aqui dentro.** Nem HTTP, nem Redis,
   * nem fila. O que entra aqui segura uma conexao do pool e, com RLS ligado, um
   * snapshot. Uma chamada de rede de 30s dentro desta funcao transforma uma
   * auditoria numa transacao de 30s.
   *
   * **Segunda regra: nao engula erro aqui dentro.** Depois de um erro o
   * Postgres poe a transacao em estado abortado — todo comando seguinte responde
   * `current transaction is aborted`, e o `COMMIT` vira `ROLLBACK` **sem
   * lancar**. Um `.catch(() => {})` que funciona fora daqui vira, aqui dentro,
   * perda silenciosa de tudo o que ja foi escrito. Onde havia `update` com
   * catch, use `updateMany`, que devolve zero em vez de estourar; onde a
   * recuperacao precisa ler o banco, faca-a **fora**, numa segunda chamada.
   *
   * @param tenantId tenant ativo, ja validado pelo `TenantGuard`
   */
  async comTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const id = validarTenantId(tenantId);

    return this.$transaction(
      async (tx) => {
        // Parametrizado, e nao interpolado. `set_config` e funcao, entao aceita
        // parametro no protocolo estendido; `SET LOCAL app.tenant_id = $1` nao
        // compila, o que obrigaria a concatenar o id na string. E dai viria a
        // injecao.
        await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${id}, true)`;
        return fn(tx);
      },
      { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
    );
  }

  /** Usado pelo healthcheck. Nao lanca: devolve false em caso de falha. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
