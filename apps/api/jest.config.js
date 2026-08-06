/**
 * Config do Jest da API.
 *
 * Vive aqui, e nao no package.json, porque as duas decisoes abaixo precisam de
 * justificativa e JSON nao aceita comentario. Config sem o porque e config que
 * alguem "otimiza" seis meses depois, reintroduzindo o defeito.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],

  // Timeout generoso: a primeira conexao do Prisma inicializa o engine nativo,
  // o que passa de 5 segundos no Windows. O padrao do Jest derrubaria o hook
  // antes de o banco sequer responder.
  testTimeout: 30_000,

  // Serial de proposito.
  //
  // As suites tocam o banco real e cada worker sobe seu proprio engine nativo
  // do Prisma. Em paralelo os engines competem e o $connect() estoura o
  // timeout - e o Prisma reporta isso como "Can't reach database server", que
  // parece falha de infraestrutura e nao de concorrencia.
  //
  // Aconteceu em 31/07/2026: 5 falsos negativos no teste de isolamento entre
  // tenants, com o Postgres comprovadamente no ar. Lido as pressas, viraria
  // alerta de vazamento entre clientes.
  //
  // Serial levou a suite de 122s para 32s. O custo era contencao, nao trabalho.
  maxWorkers: 1,

  // A API consome @propectai/types compilado, mas o teste aponta para o fonte:
  // evita exigir build do pacote antes de cada rodada.
  moduleNameMapper: {
    '^@propectai/types$': '<rootDir>/../../packages/types/src/index.ts',
  },

  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
};
