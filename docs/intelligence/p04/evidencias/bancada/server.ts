/**
 * BANCADA DE INTERFACE (nao e o produto).
 *
 * - Serve o bundle da interface REAL (apps/web/src/components/intelligence).
 * - /intelligence/*: o IntelligenceService REAL, sobre o Prisma simulado que consulta
 *   o Postgres local com RLS. Mapeia HttpError -> status, como o Nest faria, e repete
 *   a validacao dos DTOs (o ValidationPipe nao roda aqui).
 * - /leads e /leads/facets: stubs minimos da listagem existente, so para a busca da
 *   tela ter o que listar. O LeadsService de verdade nao foi tocado nem executado.
 * - Sessao: cookie `as=alfa|beta` no lugar de JWT + TenantGuard.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';

import { criarServico } from './run-service';
import { consultaJson, aspas } from './fake-prisma';
import { HttpError } from './stubs-nest';

const TENANTS: Record<string, { id: string; plan: string }> = {
  alfa: { id: 'tnt_alfa_0000000001', plan: 'free' },
  beta: { id: 'tnt_beta_0000000001', plan: 'free' },
};
const svc = criarServico();

// Controles SO da bancada, para provar concorrencia: atraso por padrao e contagem de chamadas.
let atrasos: { padrao: RegExp; ms: number }[] = [];
const chamadas: string[] = [];
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function atrasar(chave: string): Promise<void> {
  chamadas.push(chave);
  const a = atrasos.find((x) => x.padrao.test(chave));
  if (a) await dormir(a.ms);
}
const ID = /^[A-Za-z0-9_-]{8,64}$/;

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Intelligence Explorer (bancada)</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;

function ator(req: IncomingMessage) {
  const c = /(?:^|;\s*)as=(\w+)/.exec(req.headers.cookie ?? '')?.[1] ?? 'alfa';
  return TENANTS[c] ?? TENANTS.alfa!;
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  try {
    if (p === '/app.js') return void res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(readFileSync('out/app.js'));
    if (p === '/app.css') return void res.writeHead(200, { 'Content-Type': 'text/css' }).end(readFileSync('out/app.css'));
    if (!p.startsWith('/api/v1/')) return void res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);

    if (p === '/api/v1/__bench/atrasos') {
      const corpo = JSON.parse(url.searchParams.get('v') ?? '[]') as { padrao: string; ms: number }[];
      atrasos = corpo.map((x) => ({ padrao: new RegExp(x.padrao), ms: x.ms }));
      chamadas.length = 0;
      return json(res, 200, { ok: true });
    }
    if (p === '/api/v1/__bench/chamadas') return json(res, 200, chamadas);
    if (p === '/api/v1/__bench/limpar') {
      atrasos = [];
      chamadas.length = 0;
      return json(res, 200, { ok: true });
    }
    const ck = req.headers.cookie ?? '';
    const sessaoCk = /(?:^|;\s*)as=(\w+)/.exec(ck)?.[1] ?? 'alfa';
    const usuarioCk = /(?:^|;\s*)usr=(\w+)/.exec(ck)?.[1] ?? 'u1';
    // Bancada: `as=fora` simula sessao encerrada (logout em outra aba / access token invalido).
    if (sessaoCk === 'fora') return json(res, 401, { message: 'Unauthorized' });
    const t = ator(req);
    const rota = p.slice('/api/v1'.length);
    if (rota === '/auth/me') {
      const nome = sessaoCk === 'beta' ? 'Beta' : 'Alfa';
      return json(res, 200, {
        user: { id: `usr_${usuarioCk}`, email: `${usuarioCk}@${sessaoCk}.test`, name: `Usuário ${usuarioCk}`, avatarUrl: null },
        tenant: { id: t.id, name: nome, slug: sessaoCk, role: 'OWNER', planCode: 'FREE' },
        tenants: [], onboardingCompleted: true,
      });
    }
    const q = url.searchParams;

    if (rota === '/leads') {
      await atrasar(`leads|${q.get('search') ?? ''}`);
      const where = [`l."deletedAt" IS NULL`, `l."tenantId" = ${aspas(t.id)}`];
      if (q.get('search')) where.push(`l.name ILIKE ${aspas('%' + q.get('search') + '%')}`);
      if (q.get('city')) where.push(`l."addressCity" = ${aspas(q.get('city'))}`);
      if (q.get('category')) where.push(`l.category = ${aspas(q.get('category'))}`);
      const linhas = consultaJson<any>(t.id, `SELECT l.id, l.name, l.category, l."addressCity" city, l."addressStateUf" "stateUf", coalesce(s.value,0) score FROM leads l LEFT JOIN lead_scores s ON s."leadId"=l.id WHERE ${where.join(' AND ')} ORDER BY coalesce(s.value,0) DESC, l.name LIMIT 8`);
      const [{ n }] = consultaJson<{ n: number }>(t.id, `SELECT count(*) n FROM leads l WHERE ${where.join(' AND ')}`) as [{ n: number }];
      return json(res, 200, { items: linhas, total: Number(n), page: 1, pageSize: 8, totalPages: 1, summary: {} });
    }
    if (rota === '/leads/facets') {
      const cities = consultaJson<{ v: string }>(t.id, `SELECT DISTINCT "addressCity" v FROM leads WHERE "deletedAt" IS NULL AND "addressCity" IS NOT NULL ORDER BY 1`).map((r) => r.v);
      const categories = consultaJson<{ v: string }>(t.id, `SELECT DISTINCT category v FROM leads WHERE "deletedAt" IS NULL AND category IS NOT NULL ORDER BY 1`).map((r) => r.v);
      return json(res, 200, { states: [], cities, categories, stages: [] });
    }
    if (rota === '/intelligence/graph') {
      const leadId = q.get('leadId') ?? '';
      const extra = [...q.keys()].filter((k) => k !== 'leadId');
      if (!ID.test(leadId) || extra.length) return json(res, 400, { message: 'leadId inválido' });
      await atrasar(`graph|${leadId}`);
      return json(res, 200, await svc.carregarGrafo(t.id, t.plan, leadId));
    }
    if (rota === '/intelligence/expand') {
      const ref = q.get('ref') ?? '';
      const kind = q.get('kind') ?? '';
      const offset = Number(q.get('offset') ?? 0);
      const pageSize = Number(q.get('pageSize') ?? 8);
      const parentDepth = Number(q.get('parentDepth') ?? 0);
      const parentDepthProof = q.get('parentDepthProof') ?? '';
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25 || !Number.isInteger(parentDepth) || parentDepth < 0 || parentDepth > 3) {
        return json(res, 400, { message: 'parâmetro inválido' });
      }
      await atrasar(`expand|${ref}|${kind}|${offset}`);
      return json(res, 200, await svc.expandir(t.id, t.plan, { ref, kind: kind as never, offset, pageSize, parentDepth, parentDepthProof }));
    }
    return json(res, 404, { message: 'rota inexistente na bancada' });
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { message: e.message });
    console.error(e);
    return json(res, 500, { message: 'erro interno da bancada' });
  }
}).listen(3199, '127.0.0.1', () => console.log('bancada em http://127.0.0.1:3199'));
