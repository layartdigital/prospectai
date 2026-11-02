/**
 * BANCADA DE TESTE (nao faz parte do produto).
 *
 * O sandbox nao consegue instalar o Prisma, entao este arquivo imita o pedaco do
 * client que o IntelligenceService usa (findFirst / findMany / count / groupBy,
 * com where de igualdade / in / null, select, orderBy, skip, take) e executa
 * cada consulta no Postgres local **como o papel propectai_app, com RLS forcado**
 * e o tenant declarado por set_config na mesma transacao.
 *
 * Importante: `select` e respeitado. Se o servico nao pede uma coluna, ela nao
 * volta — por isso os testes de "nao vaza JSON livre" nao sao vazios.
 */
import { spawnSync } from 'node:child_process';

const PSQL = ['-h', '/tmp', '-p', '55432', '-U', 'propectai_app', '-d', process.env.P04_DB ?? 'p04_explorer', '-X', '-q', '-A', '-t'];

const TABELAS: Record<string, string> = {
  lead: 'leads',
  prospectingSearch: 'prospecting_searches',
  leadScore: 'lead_scores',
  leadScoreReason: 'lead_score_reasons',
  leadDigitalPresence: 'lead_digital_presences',
  digitalPresenceAudit: 'digital_presence_audits',
  digitalPresenceCheck: 'digital_presence_checks',
  pipelineCard: 'pipeline_cards',
  pipelineStage: 'pipeline_stages',
  leadActivity: 'lead_activities',
  leadNote: 'lead_notes',
  leadContactRecord: 'lead_contact_records',
  leadFollowUp: 'lead_follow_ups',
};

const lit = (v: unknown): string => {
  if (v === null) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
const ident = (c: string): string => `"${c.replace(/"/g, '')}"`;

type Where = Record<string, unknown>;

function sqlWhere(where: Where | undefined, alias = 't', prefixo = 'WHERE'): string {
  const partes: string[] = [];
  const col = (k: string): string => `${alias}.${ident(k)}`;
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === null) partes.push(`${col(k)} IS NULL`);
    else if (typeof v === 'object' && v !== null && 'in' in v) {
      const lista = (v as { in: unknown[] }).in;
      partes.push(lista.length === 0 ? 'FALSE' : `${col(k)} IN (${lista.map(lit).join(',')})`);
    } else if (typeof v === 'object' && v !== null && !(v instanceof Date)) {
      // filtro de relacao to-one (so `lead` e usado): EXISTS na tabela de leads
      if (k !== 'lead') throw new Error(`bancada: relacao nao suportada: ${k}`);
      const interno = sqlWhere(v as Where, 'rl', '');
      partes.push(`EXISTS (SELECT 1 FROM leads rl WHERE rl.id = ${alias}."leadId"${interno ? ' AND ' + interno : ''})`);
    } else partes.push(`${col(k)} = ${lit(v)}`);
  }
  return partes.length ? `${prefixo} ${partes.join(' AND ')}`.trim() : '';
}

export const SQL_LOG: string[] = [];
function roda(tenantId: string | null, sql: string): string {
  if (process.env.P04_SQLLOG) SQL_LOG.push(sql);
  const ctx = tenantId ? `SELECT set_config('app.tenant_id', ${lit(tenantId)}, true);` : '';
  const script = `BEGIN READ ONLY; ${ctx} ${sql}; ROLLBACK;`;
  const r = spawnSync('psql', [...PSQL, '-v', 'ON_ERROR_STOP=1', '-f', '-'], { encoding: 'utf8', input: script });
  if (r.status !== 0) throw new Error(`psql falhou: ${r.stderr}`);
  // a saida de set_config e de BEGIN/ROLLBACK vem junto; a linha JSON e a que comeca com { ou [
  const linhas = r.stdout.split('\n').filter((l) => l.startsWith('{') || l.startsWith('['));
  return linhas[linhas.length - 1] ?? 'null';
}

// colunas timestamp por tabela, para devolver Date como o Prisma faz
const tipos = new Map<string, Set<string>>();
function colunasData(tabela: string): Set<string> {
  let s = tipos.get(tabela);
  if (!s) {
    const r = spawnSync(
      'psql',
      [...PSQL, '-c', `select column_name from information_schema.columns where table_schema='public' and table_name=${lit(tabela)} and data_type like 'timestamp%'`],
      { encoding: 'utf8' },
    );
    s = new Set(r.stdout.split('\n').filter(Boolean));
    tipos.set(tabela, s);
  }
  return s;
}

function reidrata(tabela: string, obj: Record<string, unknown>): Record<string, unknown> {
  const datas = colunasData(tabela);
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    saida[k] = datas.has(k) && typeof v === 'string' ? new Date(/[zZ]|[+-]\d\d(:?\d\d)?$/.test(v) ? v : `${v}Z`) : v;
  }
  return saida;
}

function proj(select: Record<string, boolean> | undefined): string {
  if (!select) return 't.*';
  return Object.keys(select)
    .filter((k) => select[k])
    .map((k) => `t.${ident(k)}`)
    .join(', ');
}

function ordem(orderBy: unknown): string {
  const lista = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  const partes = lista.flatMap((o) => Object.entries(o as Record<string, string>).map(([c, d]) => `${ident(c)} ${d === 'desc' ? 'DESC' : 'ASC'}`));
  return partes.length ? `ORDER BY ${partes.join(', ')}` : '';
}

export interface ConsultasFeitas {
  total: number;
}

export function criarTx(tenantId: string | null, contador?: ConsultasFeitas): unknown {
  const conta = (): void => {
    if (contador) contador.total++;
  };
  const delegado = (modelo: string) => {
    const tabela = TABELAS[modelo];
    if (!tabela) throw new Error(`modelo sem mapeamento na bancada: ${modelo}`);
    return {
      async findFirst(a: { where?: Where; select?: Record<string, boolean>; orderBy?: unknown }) {
        conta();
        const out = roda(tenantId, `SELECT coalesce(to_jsonb(r), 'null'::jsonb) FROM (SELECT ${proj(a.select)} FROM ${ident(tabela)} t ${sqlWhere(a.where)} ${ordem(a.orderBy)} LIMIT 1) r`);
        const v = JSON.parse(out) as Record<string, unknown> | null;
        return v ? reidrata(tabela, v) : null;
      },
      async findMany(a: { where?: Where; select?: Record<string, boolean>; orderBy?: unknown; skip?: number; take?: number }) {
        conta();
        const lim = a.take !== undefined ? `LIMIT ${a.take}` : '';
        const off = a.skip ? `OFFSET ${a.skip}` : '';
        const out = roda(tenantId, `SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (SELECT ${proj(a.select)} FROM ${ident(tabela)} t ${sqlWhere(a.where)} ${ordem(a.orderBy)} ${lim} ${off}) r`);
        return (JSON.parse(out) as Record<string, unknown>[]).map((o) => reidrata(tabela, o));
      },
      async count(a: { where?: Where }) {
        conta();
        const out = roda(tenantId, `SELECT jsonb_build_object('n', count(*)) FROM ${ident(tabela)} t ${sqlWhere(a.where)}`);
        return Number((JSON.parse(out) as { n: number }).n);
      },
      async groupBy(a: { by: string[]; where?: Where; _count: { _all: true } }) {
        conta();
        const cols = a.by.map(ident).join(', ');
        const out = roda(tenantId, `SELECT coalesce(jsonb_agg(jsonb_build_object(${a.by.map((c) => `'${c}', ${ident(c)}`).join(', ')}, '_n', n)), '[]'::jsonb) FROM (SELECT ${cols}, count(*) n FROM ${ident(tabela)} t ${sqlWhere(a.where)} GROUP BY ${cols}) g`);
        return (JSON.parse(out) as Record<string, unknown>[]).map((o) => {
          const { _n, ...resto } = o;
          return { ...resto, _count: { _all: Number(_n) } };
        });
      },
    };
  };
  return new Proxy({}, { get: (_t, modelo: string) => delegado(modelo) });
}

export function criarPrismaFalso(contador?: ConsultasFeitas) {
  return {
    async comTenant<T>(tenantId: string, fn: (tx: never) => Promise<T>): Promise<T> {
      return fn(criarTx(tenantId, contador) as never);
    },
    /** Consulta SEM contexto de tenant: serve para provar a negacao total da RLS. */
    semContexto: () => criarTx(null, contador),
  };
}

/** SQL livre sob RLS (so para os stubs de listagem da bancada de interface). */
export function consultaJson<T = Record<string, unknown>>(tenantId: string | null, sql: string): T[] {
  return JSON.parse(roda(tenantId, `SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (${sql}) r`)) as T[];
}
export const aspas = lit;
