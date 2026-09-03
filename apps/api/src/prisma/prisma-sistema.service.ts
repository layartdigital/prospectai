import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * O papel que atravessa tenants — e o único jeito de chegar até ele.
 *
 * =============================================================================
 * Por que existe
 * =============================================================================
 *
 * Seis caminhos do produto leem ou escrevem **sem um tenant a declarar**, e em
 * todos saber qual é o tenant é o *resultado* da consulta, não a entrada dela:
 *
 *   1. `TenantGuard`                  — escolhe o membership padrão da pessoa
 *   2. `AuthService.getSession`       — lista os workspaces de uma pessoa
 *   3. `TeamService.conviteValido`    — acha o convite pelo token
 *   4. `BillingService.acharTenant`   — acha o tenant pelo webhook do Stripe
 *   5. `AdminService`                 — painel do provedor
 *   6. `PrivacyService.anonimizarAtor` — varre as linhas da pessoa em todos
 *
 * `comTenant` não resolve nenhum: declarar o contexto exigiria saber a resposta
 * que a consulta existe para descobrir. A circularidade é real.
 *
 * A credencial e o alcance estão na migration `20260903120000_rls_papel_sistema`,
 * com o raciocínio completo — inclusive os dois desenhos recusados.
 *
 * =============================================================================
 * O client é privado, e essa é a parte que importa
 * =============================================================================
 *
 * Este serviço **não expõe o `PrismaClient`**. A única forma de usá-lo é passar
 * pelo `atravessandoTenants`, que exige um motivo escrito.
 *
 * Se o client fosse público, "usar o papel do sistema" seria tão fácil quanto
 * injetar outra dependência — e a diferença entre uma consulta comum e uma
 * escalada de privilégio viraria uma escolha de import, invisível na revisão.
 * Privado, a escalada tem uma porta só, e ela é greppável:
 *
 *     grep -rn "atravessandoTenants" apps/api/src
 *
 * O `motivo` não vai para log nenhum. O `TenantGuard` roda em toda requisição;
 * logar ali seria ruído que ninguém lê e que esconde o resto. **Ele é
 * documentação obrigatória**, cobrada pelo compilador — nada além disso, e
 * dizer que é auditoria seria vender o que ele não faz.
 *
 * =============================================================================
 * Ausência da variável
 * =============================================================================
 *
 * Sem `DATABASE_URL_SISTEMA` o serviço cai no `DATABASE_URL`, **em voz alta**,
 * exatamente como o `urlDaAplicacao` do `PrismaService`. Em desenvolvimento
 * isso funciona porque o dono do banco ignora política; em produção seria a
 * aplicação inteira rodando com privilégio de dono, que é o oposto do que este
 * arquivo existe para fazer. Silenciar seria o pior dos casos: tudo continuaria
 * funcionando, e a proteção não estaria no caminho.
 */
function urlDoSistema(): string | undefined {
  const url = process.env.DATABASE_URL_SISTEMA;
  if (url === undefined || url.trim() === '') {
    console.warn(
      '[db] DATABASE_URL_SISTEMA ausente — os caminhos que atravessam tenants ' +
        'vao conectar como dono das tabelas. Funciona, e NAO e o desenho: ' +
        'ver a migration 20260903120000_rls_papel_sistema.',
    );
    return undefined;
  }
  return url;
}

@Injectable()
export class PrismaSistemaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaSistemaService.name);

  /** Privado de propósito. Ver a nota acima — é o ponto do arquivo. */
  private readonly client: PrismaClient;

  constructor() {
    const datasourceUrl = urlDoSistema();
    this.client = new PrismaClient({
      ...(datasourceUrl === undefined ? {} : { datasourceUrl }),
      log: [{ emit: 'stdout', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log('Conectado com o papel que atravessa tenants');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /**
   * Roda `fn` com o papel que ignora a política de RLS.
   *
   * **Não abre transação, e não deve.** O `comTenant` precisa de uma porque o
   * `set_config` com `is_local` morre fora dela. Aqui não há contexto a
   * declarar — é justamente a ausência dele que define este caminho —, então
   * uma transação só acrescentaria o custo dela (~5 ms medidos) sem trocar nada
   * em correção. Quem precisar de atomicidade abre a sua dentro de `fn`.
   *
   * @param motivo por que este caminho não tem tenant a declarar. Frase curta,
   *               em português, que sobreviva a quem ler isto daqui a um ano.
   */
  async atravessandoTenants<T>(
    motivo: string,
    fn: (db: PrismaClient) => Promise<T>,
  ): Promise<T> {
    if (motivo.trim() === '') {
      // Recusa em vez de aceitar vazio: um motivo em branco é pior que nenhum,
      // porque parece que alguém pensou no assunto.
      throw new Error('atravessandoTenants exige um motivo escrito');
    }

    return fn(this.client);
  }
}
