import { Queue } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Guarda contra o worker ligado durante os testes de HTTP.
 *
 * ---
 *
 * **Por que existe: um deadlock real, em 08/09/2026.**
 *
 * A suite de auditoria travou o banco no `afterAll`, e o Postgres registrou as
 * duas consultas:
 *
 * - `DELETE FROM tenants WHERE id IN ($1,$2)` — a limpeza da suite, bloqueada
 *   *"while deleting tuple in relation digital_presence_audits"*.
 * - `INSERT INTO audit_logs` sem `actorId` — que so um caminho do projeto faz
 *   dentro de uma transacao que antes escreveu em `digital_presence_audits`:
 *   o `process-audit-job.ts` do **worker**.
 *
 * O abraco: o worker precisava de trava compartilhada na linha do tenant, que
 * o `DELETE` segurava em modo exclusivo; e o `DELETE`, ao cascatear, precisava
 * da linha de auditoria que o worker acabara de atualizar.
 *
 * **O comentario do `afterAll` da suite ja previa metade disso** — "um worker
 * ligado depois os processaria contra tenants ja apagados". A metade que
 * faltava e que a colisao tambem trava o banco, e que o custo nao para na
 * suite: a limpeza morre, o tenant fica, e tres suites depois o
 * `business-invariants` reprova por lead sem score, com uma mensagem que nao
 * menciona worker nenhum. Custou duas execucoes e um `pnpm db:reset`.
 *
 * ---
 *
 * **Isto nao conserta a corrida, e nao tenta.** Os testes publicam job de
 * verdade, no mesmo Redis e no mesmo prefixo que o worker escuta — e mudar o
 * prefixo so em teste quebraria o invariante que `audits.service.ts` e
 * `prospecting.service.ts` declaram em comentario: nome e prefixo tem que bater
 * com os do worker, senao a API publica numa fila e o worker escuta outra, sem
 * erro em lugar nenhum.
 *
 * O que isto faz e **trocar uma corrida silenciosa por uma recusa explicada**,
 * antes de a suite subir. Nao rode os testes com o worker ligado; e se rodar,
 * a mensagem diz isso em vez de o banco travar.
 *
 * ---
 *
 * **Se a checagem em si falhar, ela avisa e deixa passar.** Guarda que derruba
 * a suite por defeito proprio e pior do que guarda nenhuma — e nao conseguir
 * perguntar ao Redis nao e evidencia de que ha worker.
 *
 * ---
 *
 * **A frase acima era falsa quando foi escrita, e 09/09/2026 mostrou.**
 *
 * Uma execucao acidental com o Docker desligado revelou que a guarda **nao
 * avisava: ela pendurava.** Os tres testes do `fila.spec.ts` morreram por
 * timeout de 30 s cada um, e o `catch` nunca foi alcancado.
 *
 * A causa era `maxRetriesPerRequest: null` na conexao — copiado do resto do
 * projeto, onde ele esta certo: a **aplicacao** quer reconectar para sempre,
 * porque desistir de um job seria pior. Uma checagem de meio segundo no comeco
 * de uma suite quer o oposto. **Copiar a opcao junto com o formato foi o erro**:
 * a mesma linha, com a mesma sintaxe, significa coisas contrarias nos dois
 * lugares.
 *
 * Tres travas agora, e as tres precisam existir:
 *
 * 1. **`retryStrategy: () => null` e `enableOfflineQueue: false`.** A conexao
 *    desiste na primeira falha em vez de tentar eternamente, e o comando
 *    rejeita em vez de ficar na fila de espera.
 * 2. **Um teto de `LIMITE_MS` sobre a checagem inteira.** As opcoes do ioredis
 *    dependem de eu ter entendido a biblioteca; o teto nao depende de nada. Foi
 *    exatamente confiar no comportamento da biblioteca que produziu o defeito.
 * 3. **Ouvinte de `error` na conexao.** Sem ele, um erro de conexao vira
 *    excecao nao tratada — e no Node isso **derruba o processo**, que foi o que
 *    aconteceu: o Jest morreu inteiro e levou junto as suites que ainda nem
 *    tinham comecado.
 *
 * O teste `com o Redis fora, avisa e deixa passar` cobre os tres de uma vez, e
 * ele reprova contra a versao anterior deste arquivo.
 *
 * ---
 *
 * **Residuo conhecido, medido em 09/09/2026 e deixado de proposito.**
 *
 * Rodando **so este arquivo** (`jest test/fila.spec.ts`), o Jest ainda imprime
 * "did not exit one second after the test run has completed". Na **suite
 * completa** — que e como o CI roda — nao imprime, e as 18 suites encerram
 * limpas.
 *
 * O que foi consertado esta medido: o caso patologico levava 94 s e agora leva
 * 10 s. O que sobra e uma alca pequena, que atrasa a saida do processo isolado
 * alem do segundo de tolerancia e nao aparece no unico cenario que decide o
 * verde do CI.
 *
 * **Fica anotado em vez de fingir que fechou.** Se um dia a suite completa
 * comecar a imprimir o mesmo aviso, comece por aqui — e comece pela biseccao
 * por nome de teste, que foi o que funcionou: os tres primeiros falam com o
 * Redis de verdade, o quarto nao.
 */

const PREFIXO = 'propectai';

/**
 * As duas filas em que a API publica.
 *
 * Hoje so `audits-http.spec.ts` chama esta guarda, e so com `audit`: e a unica
 * suite que chega a enfileirar. As outras duas que tocam
 * `POST /prospecting/searches` — `admin-panel` e `suspension-rules` — afirmam
 * **403**, e a recusa acontece antes da fila. `scrape` fica listada porque a
 * proxima suite que exercitar o caminho feliz da coleta vai precisar dela.
 */
export const FILAS_DA_API = ['audit', 'scrape'] as const;

/**
 * Teto da checagem inteira.
 *
 * Generoso para nao acusar por lentidao — subir o engine e perguntar ao Redis
 * leva centenas de milissegundos, nao segundos —, e muito abaixo do timeout de
 * 30 s do Jest, para que quem estoure seja este limite, com mensagem, e nao o
 * runner, sem nenhuma.
 */
const LIMITE_MS = 5_000;

/**
 * Impoe um teto a uma promessa.
 *
 * O `.catch` solto na promessa original nao e descuido: se o teto vencer a
 * corrida, a promessa perdedora ainda pode rejeitar depois, e rejeicao sem dono
 * derruba o processo — o mesmo defeito que este arquivo esta consertando.
 */
async function comTeto<T>(acao: () => Promise<T>): Promise<T> {
  const promessa = acao();
  promessa.catch(() => undefined);

  let temporizador: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        temporizador = setTimeout(
          () => rejeitar(new Error(`A checagem de fila passou de ${LIMITE_MS} ms`)),
          LIMITE_MS,
        );
      }),
    ]);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}

async function perguntarAoRedis(
  nomes: readonly string[],
  urlRedis: string,
): Promise<string[]> {
  const connection = new IORedis(urlRedis, {
    // Desistir rapido, ao contrario do resto do projeto. Ver o cabecalho.
    retryStrategy: () => null,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,

    // Nao conectar sozinho: quem manda conectar e o `connect()` logo abaixo,
    // que e o unico jeito de ter um ponto onde "pronto" e "fora" se separam.
    lazyConnect: true,
  });

  // Sem este ouvinte, erro de conexao vira excecao nao tratada e mata o
  // processo do Jest. O erro chega de qualquer forma, pela rejeicao do comando.
  connection.on('error', () => undefined);

  const ocupadas: string[] = [];

  try {
    /**
     * **Conectar explicitamente antes de qualquer coisa do BullMQ.**
     *
     * A primeira versao deste conserto ia direto ao `new Queue(...)`. Ela
     * curava o pendurado, mas deixava o processo do Jest sem encerrar — o
     * "Jest did not exit one second after the test run has completed", que
     * numa suite completa e um job esperando por um processo morto.
     *
     * A biseccao apontou o culpado sem margem: rodando so os tres testes que
     * falam com o Redis de verdade, limpo; rodando so o quarto, o do Redis
     * fora, o aviso aparece. **O que vaza e o BullMQ construido sobre uma
     * conexao que nunca conectou** — o `Queue` monta estrutura propria ao
     * nascer, e desmontar isso pela metade nao e caminho que a biblioteca
     * cuide. Entao: com o Redis fora, nao criar `Queue` nenhuma.
     *
     * Isto e menos codigo defensivo, e nao mais: em vez de tentar limpar
     * direito o que a biblioteca abriu, nao abrir.
     *
     * ---
     *
     * **A tentativa anterior foi um `ping`, e ela reprovou contra o Redis
     * ligado.** "Stream isn't writeable and enableOfflineQueue options is
     * false": com `enableOfflineQueue: false`, comando emitido **antes** de a
     * conexao ficar pronta e recusado na hora — e `new IORedis(...)` conecta em
     * segundo plano, entao o `ping` da linha seguinte chegava cedo demais.
     *
     * O `getWorkers()` nunca sofreu disso porque o BullMQ espera a conexao
     * ficar pronta antes de falar. **Eu tinha copiado a espera junto com a
     * biblioteca sem saber que ela existia** — e ao trocar a biblioteca pelo
     * comando cru, a espera foi junto.
     *
     * `lazyConnect` mais `connect()` poe a espera de volta, agora explicita:
     * resolve quando esta pronto, rejeita quando nao ha ninguem. E o unico
     * ponto do arquivo onde as duas coisas se separam.
     */
    await connection.connect();

    for (const nome of nomes) {
      const fila = new Queue(nome, { connection, prefix: PREFIXO });
      try {
        const workers = await fila.getWorkers();
        if (workers.length > 0) ocupadas.push(`${nome} (${workers.length})`);
      } finally {
        await fila.close();
      }
    }
    return ocupadas;
  } finally {
    // `disconnect` e nao `quit`: o segundo fala com o servidor, e com o
    // servidor fora ele espera por uma resposta que nao vem.
    connection.disconnect();
  }
}

export async function exigirFilaSemWorker(
  nomes: readonly string[] = FILAS_DA_API,
  urlRedis: string = process.env.REDIS_URL ?? 'redis://localhost:6381',
): Promise<void> {
  let ocupadas: string[];

  try {
    ocupadas = await comTeto(() => perguntarAoRedis(nomes, urlRedis));
  } catch (erro) {
    console.warn(
      '[fila] Nao foi possivel verificar se ha worker escutando — seguindo ' +
        'assim mesmo. Se a suite travar no afterAll com "deadlock detected", ' +
        'a causa provavel e um worker ligado. Ver apps/api/test/fila.ts.',
      erro,
    );
    return;
  }

  if (ocupadas.length > 0) {
    throw new Error(
      `Ha worker escutando a(s) fila(s): ${ocupadas.join(', ')}.\n\n` +
        'Esta suite publica job de verdade. Com o worker ligado ele processa ' +
        'esses jobs contra tenants que a suite esta apagando — e em 08/09/2026 ' +
        'isso travou o banco com "deadlock detected", deixou lixo e reprovou o ' +
        'business-invariants tres suites depois.\n\n' +
        'Pare o worker (o `pnpm dev`) e rode de novo. Ver apps/api/test/fila.ts.',
    );
  }
}
