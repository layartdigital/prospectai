import { defineConfig } from 'vitest/config';

/**
 * Vitest do worker.
 *
 * Escolhido para alinhar com packages/types, que ja usa Vitest. A API usa Jest
 * por causa do ecossistema Nest — divergencia consciente, nao acidente.
 *
 * Exige `pnpm --filter @propectai/types build` antes: o worker importa
 * @propectai/types pelo `exports` do pacote, que aponta para dist.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],

    // Serial e com folga de tempo pelo mesmo motivo do Jest da API: as suites
    // falam com o banco real e o mock provider simula 1s de trabalho por job,
    // com polling de 3s. Paralelizar aqui produz contencao de engine do Prisma
    // e falso negativo com cara de falha de infraestrutura.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
