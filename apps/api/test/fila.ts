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

export async function exigirFilaSemWorker(
  nomes: readonly string[] = FILAS_DA_API,
): Promise<void> {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6381', {
    maxRetriesPerRequest: null,
  });

  const ocupadas: string[] = [];

  try {
    for (const nome of nomes) {
      const fila = new Queue(nome, { connection, prefix: PREFIXO });
      try {
        const workers = await fila.getWorkers();
        if (workers.length > 0) ocupadas.push(`${nome} (${workers.length})`);
      } finally {
        await fila.close();
      }
    }
  } catch (erro) {
    console.warn(
      '[fila] Nao foi possivel verificar se ha worker escutando — seguindo ' +
        'assim mesmo. Se a suite travar no afterAll com "deadlock detected", ' +
        'a causa provavel e um worker ligado. Ver apps/api/test/fila.ts.',
      erro,
    );
    return;
  } finally {
    await connection.quit();
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
