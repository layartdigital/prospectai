// QA-01 §9 — limites e desempenho em banco de teste de VOLUME (p04_volume, local, descartavel).
// Tempos incluem um `psql` por consulta (a bancada nao tem driver), portanto sao um TETO pessimista.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GRAPH_LIMITS } from '@propectai/types';
import { ProvaDeProfundidade } from '../../work/prospectai/apps/api/src/intelligence/depth-proof';
import { criarServico, SEGREDO_DA_BANCADA } from './run-service';
import { SQL_LOG } from './fake-prisma';

const ALFA = 'tnt_alfa_0000000001';
const prova = new ProvaDeProfundidade(SEGREDO_DA_BANCADA);
const log: string[] = [];
const medir = async <T>(rotulo: string, fn: (c: { total: number }) => Promise<T>) => {
  const contador = { total: 0 };
  const t0 = performance.now();
  const r = await fn(contador);
  const ms = Math.round(performance.now() - t0);
  log.push(`${rotulo}\tconsultas=${contador.total}\ttempo_bancada_ms=${ms}`);
  return { r, contador, ms };
};

describe('limites e desempenho (3.000 leads na mesma pesquisa; 1 lead com 5.000 notas)', () => {
  it('grafo inicial de um lead pesado: numero de consultas e constante e pequeno', async () => {
    const { r, contador } = await medir('graph lead com 5010 notas', (c) => criarServico(c).carregarGrafo(ALFA, 'free', 'lead_vol_00000001'));
    assert.equal(r.nodes.find((n) => n.kind === 'LEAD')!.expansions.find((x) => x.kind === 'NOTE')!.total, 5010);
    assert.ok(r.nodes.length <= GRAPH_LIMITS.maxNodesPerResponse);
    assert.ok(r.nodes.every((n) => n.kind !== 'NOTE')); // nenhuma nota vem de carona
    assert.ok(contador.total <= 20, `consultas=${contador.total}`);
  });

  it('o numero de consultas NAO cresce com a quantidade de leads de uma pagina', async () => {
    const svc = (c: { total: number }) => criarServico(c);
    const pedido = (pageSize: number, offset: number) => ({
      ref: 'SEARCH:srch_vol_0000000001', kind: 'LEAD' as const, offset, pageSize, parentDepth: 1,
      parentDepthProof: prova.assinar(ALFA, 'SEARCH:srch_vol_0000000001', 1),
    });
    const a = await medir('expand SEARCH->LEAD pageSize=1', (c) => svc(c).expandir(ALFA, 'free', pedido(1, 0)));
    const b = await medir('expand SEARCH->LEAD pageSize=25', (c) => svc(c).expandir(ALFA, 'free', pedido(25, 0)));
    assert.equal(b.r.nodes.length, 25);
    assert.equal(a.contador.total, b.contador.total, 'consultas devem ser iguais para 1 e 25 leads (agrupadas, sem N+1)');
  });

  it('pagina final de 3.000 leads e o teto de pagina', async () => {
    const { r } = await medir('expand SEARCH->LEAD offset=2990', (c) => criarServico(c).expandir(ALFA, 'free', {
      ref: 'SEARCH:srch_vol_0000000001', kind: 'LEAD', offset: 2990, pageSize: 25, parentDepth: 1,
      parentDepthProof: prova.assinar(ALFA, 'SEARCH:srch_vol_0000000001', 1),
    }));
    assert.equal(r.nodes.length, 10); // 3.000 leads na pesquisa de volume, offset 2.990
    assert.equal(r.expanded.nextOffset, null);
  });

  it('notas: pageSize pedido acima do teto e cortado em 25; offset alto responde sem erro', async () => {
    const ref = 'LEAD:lead_vol_00000001';
    const { r } = await medir('expand NOTE pageSize=500 offset=0', (c) => criarServico(c).expandir(ALFA, 'free', {
      ref, kind: 'NOTE', offset: 0, pageSize: 500, parentDepth: 0, parentDepthProof: prova.assinar(ALFA, ref, 0),
    }));
    assert.equal(r.nodes.length, GRAPH_LIMITS.maxPageSize);
    const fundo = await medir('expand NOTE offset=5000', (c) => criarServico(c).expandir(ALFA, 'free', {
      ref, kind: 'NOTE', offset: 5000, pageSize: 25, parentDepth: 0, parentDepthProof: prova.assinar(ALFA, ref, 0),
    }));
    assert.equal(fundo.r.nodes.length, 10);
    const alem = await criarServico().expandir(ALFA, 'free', {
      ref, kind: 'NOTE', offset: 10_000, pageSize: 25, parentDepth: 0, parentDepthProof: prova.assinar(ALFA, ref, 0),
    });
    assert.equal(alem.nodes.length, 0);
    assert.equal(alem.expanded.nextOffset, null);
  });

  it('teto de nos por resposta e respeitado e informado em omitted', async () => {
    const { r } = await medir('expand SEARCH->LEAD (25 leads, 5+ relacoes cada)', (c) => criarServico(c).expandir(ALFA, 'free', {
      ref: 'SEARCH:srch_vol_0000000001', kind: 'LEAD', offset: 0, pageSize: 25, parentDepth: 1,
      parentDepthProof: prova.assinar(ALFA, 'SEARCH:srch_vol_0000000001', 1),
    }));
    assert.ok(r.nodes.length <= GRAPH_LIMITS.maxNodesPerResponse);
  });

  it('registra o relatorio de consultas', async () => {
    const fs = await import('node:fs');
    fs.writeFileSync('volume-metricas.tsv', log.join('\n') + '\n');
    assert.ok(log.length >= 5);
  });
});
