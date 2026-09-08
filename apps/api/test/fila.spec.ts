import path from 'node:path';

import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import IORedis from 'ioredis';

import { exigirFilaSemWorker } from './fila';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Prova que a guarda de fila discrimina — os dois lados.
 *
 * ---
 *
 * **Por que este arquivo existe: uma guarda nao falsificada e decoracao.**
 *
 * O `fila.ts` promete recusar a suite quando ha worker escutando. A promessa
 * depende inteira do `getWorkers()` do BullMQ enxergar o worker, e isso eu nao
 * podia afirmar sem medir. A primeira tentativa de medir por fora falhou de
 * dois jeitos diferentes, e os dois valem estar escritos:
 *
 * 1. **O turbo devolveu cache.** Rodar de novo "com o worker ligado" nao
 *    executou nada: nenhum arquivo mudou, entao o hash foi o mesmo e a saida
 *    veio guardada, com os carimbos de hora da execucao anterior. **"Ter um
 *    processo ligado" nao entra no hash do turbo** — experimento de ambiente
 *    nao se faz atraves dele.
 * 2. **O worker nao estava de pe.** O `redis-cli client list` mostrou uma
 *    unica conexao: o proprio `redis-cli`. A execucao que "passou" nao provava
 *    nada, porque o cenario nunca existiu.
 *
 * Deste lado nao ha nem cache nem suposicao: o teste **cria** o worker, mede,
 * derruba, e mede de novo.
 *
 * ---
 *
 * **A fila e propria, e isso e de proposito.** Se o worker fosse criado na fila
 * `audit` de verdade, ele ficaria elegivel a pegar job real e escrever no banco
 * — que e exatamente o acidente que a guarda existe para impedir. Numa fila que
 * ninguem publica, o worker nunca recebe nada, e o que se mede continua sendo o
 * unico ponto em duvida: **o `getWorkers()` enxerga um worker vivo?**
 */

const FILA = 'gate-fila-teste';
const PREFIXO = 'propectai';
const TIMEOUT_MS = 30_000;

let conexao: IORedis;
let worker: Worker | null = null;

beforeAll(() => {
  conexao = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6381', {
    maxRetriesPerRequest: null,
  });
}, TIMEOUT_MS);

afterAll(async () => {
  await worker?.close();
  await conexao.quit();
}, TIMEOUT_MS);

describe('guarda de fila', () => {
  it('sem worker, deixa passar', async () => {
    // Denominador do experimento. Sem ele, um `exigirFilaSemWorker` que
    // simplesmente nunca lanca passaria no teste de baixo por omissao.
    await expect(exigirFilaSemWorker([FILA])).resolves.toBeUndefined();
  });

  it('com worker escutando, recusa e diz qual fila', async () => {
    worker = new Worker(FILA, async () => undefined, {
      connection: conexao,
      prefix: PREFIXO,
    });

    // `waitUntilReady` e o que separa medir do worker de medir da corrida: sem
    // ele o teste as vezes perguntaria antes de a conexao existir, e o gate
    // apareceria intermitente sem ser.
    await worker.waitUntilReady();

    await expect(exigirFilaSemWorker([FILA])).rejects.toThrow(FILA);
  }, TIMEOUT_MS);

  it('e volta a deixar passar quando o worker sai', async () => {
    await worker?.close();
    worker = null;

    // O terceiro caso e o que impede a leitura preguicosa do segundo: uma
    // guarda que lance sempre tambem passaria naquele. Aqui ela precisa
    // **voltar** a liberar — so entao ela esta reagindo ao worker, e nao a
    // qualquer coisa.
    await expect(exigirFilaSemWorker([FILA])).resolves.toBeUndefined();
  }, TIMEOUT_MS);
});
