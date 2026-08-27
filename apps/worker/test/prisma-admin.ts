import { PrismaClient } from '@prisma/client';

/**
 * Client de fixtures, com o papel que ignora RLS.
 *
 * Passo 2 do `PLANO-RLS-v1.md`, e o passo que torna o passo 4 reversivel.
 *
 * **Todo teste com banco monta o cenario e confere o resultado com Prisma cru,
 * sem contexto de tenant.** Sob `FORCE ROW LEVEL SECURITY`, cada uma dessas
 * consultas passa a enxergar zero linhas — nao com erro, com vazio. Os testes
 * falhariam em cascata com assercoes sem sentido, e a causa nao apareceria em
 * mensagem nenhuma.
 *
 * O conserto nao e mudar os testes: e reconhecer que **montar cenario e
 * operacao administrativa**, e nao faz sentido submete-la a politica que se
 * quer testar. Quem prova isolamento e a assercao feita com o papel da
 * aplicacao — e ela vem no passo 4, quando o `DATABASE_URL` apontar para o
 * `propectai_app`.
 *
 * Sem essa separacao, um teste que monta e confere com o mesmo papel
 * privilegiado nao prova isolamento nenhum.
 */

let avisou = false;

export function criarPrismaAdmin(): PrismaClient {
  const url = process.env.DATABASE_URL_MIGRATOR;

  if (url === undefined || url.trim() === '') {
    /**
     * Cai no `DATABASE_URL`, mas **em voz alta**.
     *
     * Mesmo padrao do `entitlements.normalizar()`: completa com o que da para
     * completar e diz o que faltou. Silenciar aqui seria o pior dos dois
     * mundos — os testes passariam hoje e falhariam no passo 4 com a causa
     * escondida a tres arquivos de distancia.
     */
    if (!avisou) {
      console.warn(
        '[fixtures] DATABASE_URL_MIGRATOR ausente — usando DATABASE_URL. ' +
          'Funciona enquanto o RLS estiver desligado; quebra no passo 4 do PLANO-RLS-v1.md.',
      );
      avisou = true;
    }
    return new PrismaClient();
  }

  return new PrismaClient({ datasourceUrl: url });
}
