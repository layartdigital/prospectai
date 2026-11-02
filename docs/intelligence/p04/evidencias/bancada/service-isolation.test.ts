import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GRAPH_LIMITS, parseNodeRef, type GraphResponse } from '@propectai/types';

import { ProvaDeProfundidade } from '../../work/prospectai/apps/api/src/intelligence/depth-proof';
import { criarServico, SEGREDO_DA_BANCADA } from './run-service';

const ALFA = 'tnt_alfa_0000000001';
const BETA = 'tnt_beta_0000000001';
const LEAD = 'lead_alfa_0000001';
const FREE = 'free';

const svc = criarServico();
const grafo = (t: string, leadId: string) => svc.carregarGrafo(t, FREE, leadId);
// "Cliente honesto": devolve a prova que o servidor emitiria para o no declarado.
// Os testes de adulteracao passam `parentDepthProof` explicitamente.
const prova = new ProvaDeProfundidade(SEGREDO_DA_BANCADA);
const expandir = (
  t: string,
  ref: string,
  kind: any,
  extra: Partial<{ offset: number; pageSize: number; parentDepth: number; parentDepthProof: string }> = {},
) => {
  const parentDepth = extra.parentDepth ?? 0;
  return svc.expandir(t, FREE, {
    ref,
    kind,
    offset: 0,
    pageSize: 8,
    parentDepthProof: prova.assinar(t, ref, parentDepth),
    ...extra,
    parentDepth,
  });
};
const msg = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e: any) {
    return `${e.status}:${e.message}`;
  }
};
const status = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (e: any) {
    return e.status ?? 500;
  }
};

describe('o dono enxerga as proprias relacoes (servico real, RLS real)', () => {
  it('grafo inicial: lead, pesquisa, score, presenca e cartao, com 4 arestas verificadas', async () => {
    const g: GraphResponse = await grafo(ALFA, LEAD);
    assert.deepEqual(g.nodes.map((n) => n.kind).sort(), ['LEAD', 'PIPELINE_CARD', 'PRESENCE', 'SCORE', 'SEARCH']);
    assert.equal(g.edges.length, 4);
    for (const e of g.edges) {
      assert.equal(e.verification, 'VERIFICADA');
      assert.ok(e.provenance.source.length > 0);
    }
    assert.equal(g.rootRef, `LEAD:${LEAD}`);
  });

  it('contagens de filhos vem em expansions, sem enviar os filhos', async () => {
    const g = await grafo(ALFA, LEAD);
    const raiz = g.nodes.find((n) => n.kind === 'LEAD')!;
    const total = (k: string) => raiz.expansions.find((x) => x.kind === k)?.total;
    assert.equal(total('NOTE'), 30);
    assert.equal(total('ACTIVITY'), 3);
    assert.equal(total('CONTACT_RECORD'), 1);
    assert.equal(total('FOLLOW_UP'), 1);
    assert.equal(total('AUDIT'), 1);
    assert.equal(g.nodes.some((n) => n.kind === 'NOTE'), false);
  });

  it('telefone sai mascarado no plano que mascara', async () => {
    const g = await grafo(ALFA, LEAD);
    const tel = g.nodes[0]!.properties.find((p) => p.label.startsWith('Telefone'))!;
    assert.equal(tel.label, 'Telefone (mascarado pelo plano)');
    assert.ok(!tel.value!.includes('99999-1234'));
    assert.equal(tel.value, '(19) ••••••-1234');
  });

  it('plano que libera o numero mostra o numero', async () => {
    const livre = criarServico(undefined, ['agency']);
    const g = await livre.carregarGrafo(ALFA, 'agency', LEAD);
    const tel = g.nodes[0]!.properties.find((p) => p.label.startsWith('Telefone'))!;
    assert.equal(tel.label, 'Telefone');
    assert.equal(tel.value, '(19) 99999-1234');
  });

  it('notas: pagina de 25, recortadas, proxima posicao e resto', async () => {
    const p1 = await expandir(ALFA, `LEAD:${LEAD}`, 'NOTE', { pageSize: 25 });
    assert.equal(p1.nodes.length, 25);
    assert.equal(p1.expanded.nextOffset, 25);
    for (const n of p1.nodes) assert.ok((n.properties.find((p) => p.label === 'Texto (recorte)')?.value ?? '').length <= 140);
    const p2 = await expandir(ALFA, `LEAD:${LEAD}`, 'NOTE', { pageSize: 25, offset: 25 });
    assert.equal(p2.nodes.length, 5);
    assert.equal(p2.expanded.nextOffset, null);
  });

  it('nao devolve JSON livre nem URL do prospect', async () => {
    const atv = await expandir(ALFA, `LEAD:${LEAD}`, 'ACTIVITY');
    assert.equal(atv.nodes.length, 3);
    assert.ok(!JSON.stringify(atv).includes('nao-deve-sair'));
    const chk = await expandir(ALFA, 'AUDIT:aud_alfa_000000001', 'AUDIT_CHECK', { parentDepth: 1 });
    assert.equal(chk.nodes.length, 3);
    const txt = JSON.stringify(chk);
    assert.ok(!txt.includes('nao-deve-sair'));
    assert.ok(!txt.includes('privado.example'));
  });

  it('sinais sem verificacao chegam como DESCONHECIDO; AUSENTE e PRESENTE so quando o banco disse', async () => {
    const r = await expandir(ALFA, 'PRESENCE:prs_alfa_000000001', 'SIGNAL', { pageSize: 25, parentDepth: 1 });
    assert.equal(r.nodes.length, 7);
    const estado = Object.fromEntries(r.nodes.map((n) => [n.label, n.state]));
    assert.equal(estado['Instagram'], 'DESCONHECIDO');
    assert.equal(estado['Facebook'], 'DESCONHECIDO');
    assert.equal(estado['Site'], 'AUSENTE');
    assert.equal(estado['E-mail'], 'PRESENTE');
    assert.ok(r.edges.every((e) => e.provenance.kind === 'SAME_ROW_FIELD'));
  });

  it('motivos do score, etapa do cartao e checagens', async () => {
    const m = await expandir(ALFA, 'SCORE:scr_alfa_000000001', 'SCORE_REASON', { pageSize: 25, parentDepth: 1 });
    assert.equal(m.nodes.length, 5);
    assert.equal(m.nodes[0]!.label, 'Sem site próprio'); // maior peso primeiro
    const e = await expandir(ALFA, 'PIPELINE_CARD:crd_alfa_000000001', 'PIPELINE_STAGE', { parentDepth: 1 });
    assert.equal(e.nodes[0]!.label, 'Contato feito');
  });

  it('expandir a pesquisa lista so os leads do proprio tenant (4), sem o intruso do Beta', async () => {
    const r = await expandir(ALFA, 'SEARCH:srch_alfa_00000001', 'LEAD', { parentDepth: 1 });
    assert.equal(r.nodes.length, 4);
    assert.ok(!JSON.stringify(r).includes('lead_beta_intruso1'));
    assert.ok(!JSON.stringify(r).includes('Lead do Beta'));
    // todo lead filho traz sua propria contagem de relacoes
    for (const n of r.nodes) assert.ok(n.expansions.length >= 5);
  });
});

describe('isolamento entre tenants', () => {
  it('Beta com o id do lead do Alfa recebe 404 no grafo', async () => {
    assert.equal(await status(grafo(BETA, LEAD)), 404);
  });

  it('id de outro tenant e id inexistente respondem igual', async () => {
    const a = await grafo(BETA, LEAD).catch((e: any) => `${e.status}:${e.message}`);
    const b = await grafo(BETA, 'cm0naoexiste00000001').catch((e: any) => `${e.status}:${e.message}`);
    assert.equal(a, b);
  });

  it('Beta nao expande nenhum tipo de no do Alfa (12 combinacoes)', async () => {
    const casos: [string, string][] = [
      [`LEAD:${LEAD}`, 'NOTE'], [`LEAD:${LEAD}`, 'ACTIVITY'], [`LEAD:${LEAD}`, 'AUDIT'], [`LEAD:${LEAD}`, 'SCORE'],
      [`LEAD:${LEAD}`, 'PRESENCE'], [`LEAD:${LEAD}`, 'PIPELINE_CARD'], [`LEAD:${LEAD}`, 'SEARCH'],
      ['SEARCH:srch_alfa_00000001', 'LEAD'], ['SCORE:scr_alfa_000000001', 'SCORE_REASON'],
      ['PRESENCE:prs_alfa_000000001', 'SIGNAL'], ['AUDIT:aud_alfa_000000001', 'AUDIT_CHECK'],
      ['PIPELINE_CARD:crd_alfa_000000001', 'PIPELINE_STAGE'],
    ];
    for (const [ref, kind] of casos) assert.equal(await status(expandir(BETA, ref, kind)), 404, `${ref} ${kind}`);
  });

  it('Beta so enxerga o proprio grafo, sem nenhum id do Alfa', async () => {
    const g = await grafo(BETA, 'lead_beta_00000001');
    // o lead do Beta tem a propria pesquisa (srch_beta): lead + pesquisa, ambos do Beta
    assert.deepEqual(g.nodes.map((n) => n.kind).sort(), ['LEAD', 'SEARCH']);
    const txt = JSON.stringify(g);
    for (const proibido of [ALFA, 'srch_alfa', 'scr_alfa', 'prs_alfa', 'crd_alfa', 'aud_alfa', 'lead_alfa', 'Sorriso']) {
      assert.ok(!txt.includes(proibido), proibido);
    }
  });

  it('lead do Beta com searchId do Alfa nao ganha no de pesquisa', async () => {
    const g = await grafo(BETA, 'lead_beta_intruso1');
    assert.equal(g.nodes.some((n) => n.kind === 'SEARCH'), false);
    const raiz = g.nodes[0]!;
    assert.equal(raiz.expansions.find((x) => x.kind === 'SEARCH')?.total, 0);
  });

  it('e o Alfa nao enxerga o lead do Beta pelo mesmo caminho', async () => {
    assert.equal(await status(grafo(ALFA, 'lead_beta_intruso1')), 404);
    assert.equal(await status(grafo(ALFA, 'lead_beta_00000001')), 404);
  });

  it('sem contexto de tenant a RLS nega tudo (a bancada consulta cru, fora do servico)', async () => {
    const { criarPrismaFalso } = await import('./fake-prisma');
    const tx: any = criarPrismaFalso().semContexto();
    assert.equal(await tx.lead.count({ where: {} }), 0);
    assert.equal(await tx.leadNote.count({ where: {} }), 0);
  });
});

describe('soft delete', () => {
  it('nota apagada nao entra na contagem nem na pagina', async () => {
    const g = await grafo(ALFA, LEAD);
    assert.equal(g.nodes[0]!.expansions.find((x) => x.kind === 'NOTE')?.total, 30);
    const r = await expandir(ALFA, `LEAD:${LEAD}`, 'NOTE', { pageSize: 25, offset: 25 });
    assert.ok(!JSON.stringify(r).includes('NOTA APAGADA'));
  });

  it('lead apagado responde 404 no grafo e na expansao', async () => {
    assert.equal(await status(grafo(ALFA, 'lead_alfa_apagado1')), 404);
    assert.equal(await status(expandir(ALFA, 'LEAD:lead_alfa_apagado1', 'NOTE')), 404);
  });
});

describe('limites no servidor', () => {
  it('relacao nao permitida, referencia malformada e profundidade', async () => {
    assert.equal(await status(expandir(ALFA, `LEAD:${LEAD}`, 'SCORE_REASON')), 400);
    assert.equal(await status(expandir(ALFA, 'SIGNAL:prs_alfa_000000001:hasEmail', 'LEAD')), 400);
    for (const ref of ['', 'LEAD', 'LEAD:abc', "LEAD:cm0lead0000001';--", 'TENANT:cm0lead00000001', `LEAD:${LEAD}:extra`]) {
      assert.equal(await status(expandir(ALFA, ref, 'NOTE')), 400, ref);
    }
    assert.equal(await status(expandir(ALFA, `LEAD:${LEAD}`, 'NOTE', { parentDepth: GRAPH_LIMITS.maxDepth })), 400);
  });

  it('pageSize e limitado ao teto mesmo se o cliente pedir mais (o DTO barra antes; aqui, defesa em profundidade)', async () => {
    const r = await expandir(ALFA, `LEAD:${LEAD}`, 'NOTE', { pageSize: 500 });
    assert.equal(r.nodes.length, GRAPH_LIMITS.maxPageSize);
  });

  it('parseNodeRef recusa o que o servico nunca deve consultar', () => {
    assert.equal(parseNodeRef('LEAD:x'), null);
  });
});


describe('QA-01 · profundidade imposta pelo servidor', () => {
  it('todo no devolvido traz prova; a raiz e os filhos diretos partem de 0 e 1', async () => {
    const g = await grafo(ALFA, LEAD);
    for (const n of g.nodes) assert.match(n.depthProof ?? '', /^[A-Za-z0-9_-]{22}$/, n.ref);
    assert.equal(g.nodes.find((n) => n.kind === 'LEAD')!.depth, 0);
    assert.ok(g.nodes.filter((n) => n.kind !== 'LEAD').every((n) => n.depth === 1));
  });

  it('profundidade valida: cliente usa a prova recebida da raiz e recebe filhos em depth 1', async () => {
    const g = await grafo(ALFA, LEAD);
    const raiz = g.nodes.find((n) => n.kind === 'LEAD')!;
    const r = await svc.expandir(ALFA, FREE, {
      ref: raiz.ref, kind: 'NOTE', offset: 0, pageSize: 8, parentDepth: raiz.depth, parentDepthProof: raiz.depthProof!,
    });
    assert.equal(r.nodes.length, 8);
    assert.ok(r.nodes.every((n) => n.depth === 1 && !!n.depthProof));
  });

  it('cadeia real ate o teto: lead -> pesquisa -> lead -> presenca passa; o proximo passo (sinais, depth 4) e recusado', async () => {
    // usa SO as provas devolvidas pelo servidor, como o navegador faria
    const g = await grafo(ALFA, LEAD);
    const pesquisa = g.nodes.find((n) => n.kind === 'SEARCH')!; // depth 1
    const leads = await svc.expandir(ALFA, FREE, {
      ref: pesquisa.ref, kind: 'LEAD', offset: 0, pageSize: 8, parentDepth: pesquisa.depth, parentDepthProof: pesquisa.depthProof!,
    });
    const filho = leads.nodes.find((n) => n.ref === `LEAD:${LEAD}`)!; // depth 2
    assert.equal(filho.depth, 2);
    const pres = await svc.expandir(ALFA, FREE, {
      ref: filho.ref, kind: 'PRESENCE', offset: 0, pageSize: 8, parentDepth: filho.depth, parentDepthProof: filho.depthProof!,
    });
    const presenca = pres.nodes[0]!; // depth 3 == maxDepth
    assert.equal(presenca.depth, GRAPH_LIMITS.maxDepth);
    const alem = await msg(
      svc.expandir(ALFA, FREE, {
        ref: presenca.ref, kind: 'SIGNAL', offset: 0, pageSize: 8, parentDepth: presenca.depth, parentDepthProof: presenca.depthProof!,
      }),
    );
    assert.match(alem, /^400:Profundidade máxima/);
  });

  it('parentDepth artificialmente reduzido (com a prova do depth real) e recusado', async () => {
    const g = await grafo(ALFA, LEAD);
    const pesquisa = g.nodes.find((n) => n.kind === 'SEARCH')!;
    const leads = await svc.expandir(ALFA, FREE, {
      ref: pesquisa.ref, kind: 'LEAD', offset: 0, pageSize: 8, parentDepth: 1, parentDepthProof: pesquisa.depthProof!,
    });
    const filho = leads.nodes.find((n) => n.ref === `LEAD:${LEAD}`)!;
    for (const mentira of [0, 1]) {
      const r = await msg(
        svc.expandir(ALFA, FREE, {
          ref: filho.ref, kind: 'PRESENCE', offset: 0, pageSize: 8, parentDepth: mentira, parentDepthProof: filho.depthProof!,
        }),
      );
      assert.match(r, /^400:Prova de profundidade inválida/, `depth declarado ${mentira}`);
    }
  });

  it('prova ausente, adulterada, de outro no, de outro tenant e depth malformado sao recusados', async () => {
    const g = await grafo(ALFA, LEAD);
    const raiz = g.nodes.find((n) => n.kind === 'LEAD')!;
    const outro = g.nodes.find((n) => n.kind === 'SCORE')!;
    const base = { ref: raiz.ref, kind: 'NOTE' as const, offset: 0, pageSize: 8 };
    const adulterada = raiz.depthProof!.slice(0, -1) + (raiz.depthProof!.endsWith('A') ? 'B' : 'A');
    const casos: [string, number, string][] = [
      ['ausente', 0, ''],
      ['adulterada', 0, adulterada],
      ['de outro no', 0, outro.depthProof!],
      ['de outro tenant', 0, prova.assinar(BETA, raiz.ref, 0)],
      ['depth negativo', -1, prova.assinar(ALFA, raiz.ref, -1)],
      ['depth fracionario', 0.5, prova.assinar(ALFA, raiz.ref, 0.5)],
      ['depth NaN', Number.NaN, prova.assinar(ALFA, raiz.ref, Number.NaN)],
      ['tamanho errado', 0, raiz.depthProof! + 'x'],
    ];
    for (const [rotulo, d, p] of casos) {
      const r = await msg(svc.expandir(ALFA, FREE, { ...base, parentDepth: d, parentDepthProof: p }));
      assert.match(r, /^400:Prova de profundidade inválida/, rotulo);
    }
  });

  it('segredo diferente invalida as provas (rotacao do segredo exige recarregar o grafo)', async () => {
    const outro = criarServico(undefined, [], 'outro-segredo-de-bancada');
    const g = await outro.carregarGrafo(ALFA, FREE, LEAD);
    const raiz = g.nodes[0]!;
    const r = await msg(svc.expandir(ALFA, FREE, {
      ref: raiz.ref, kind: 'NOTE', offset: 0, pageSize: 8, parentDepth: 0, parentDepthProof: raiz.depthProof!,
    }));
    assert.match(r, /^400:Prova/);
  });

  it('a recusa acontece antes do banco: nenhuma consulta e feita com prova invalida', async () => {
    const contador = { total: 0 };
    const s2 = criarServico(contador);
    await msg(s2.expandir(ALFA, FREE, {
      ref: `LEAD:${LEAD}`, kind: 'NOTE', offset: 0, pageSize: 8, parentDepth: 0, parentDepthProof: 'x'.repeat(22),
    }));
    assert.equal(contador.total, 0);
  });
});

describe('QA-01 · soft delete: entidades de lead excluido', () => {
  const casos: [string, string, string][] = [
    ['score', 'SCORE:scr_alfa_apagado01', 'SCORE_REASON'],
    ['presenca digital', 'PRESENCE:prs_alfa_apagado01', 'SIGNAL'],
    ['auditoria', 'AUDIT:aud_alfa_apagado01', 'AUDIT_CHECK'],
    ['cartao do pipeline', 'PIPELINE_CARD:crd_alfa_apagado01', 'PIPELINE_STAGE'],
  ];
  for (const [rotulo, ref, kind] of casos) {
    it(`${rotulo} de lead excluido nao abre por referencia conhecida`, async () => {
      assert.equal(await status(expandir(ALFA, ref, kind, { parentDepth: 1 })), 404);
    });
  }

  it('lead excluido: grafo e expansao direta respondem 404; nada de seus filhos aparece', async () => {
    assert.equal(await status(grafo(ALFA, 'lead_alfa_apagado1')), 404);
    for (const k of ['NOTE', 'SCORE', 'PRESENCE', 'AUDIT', 'PIPELINE_CARD', 'ACTIVITY']) {
      assert.equal(await status(expandir(ALFA, 'LEAD:lead_alfa_apagado1', k)), 404, k);
    }
  });

  it('as mesmas entidades de um lead ATIVO continuam abrindo (controle positivo)', async () => {
    assert.equal(await status(expandir(ALFA, 'SCORE:scr_alfa_000000001', 'SCORE_REASON', { parentDepth: 1 })), 200);
    assert.equal(await status(expandir(ALFA, 'PRESENCE:prs_alfa_000000001', 'SIGNAL', { parentDepth: 1 })), 200);
    assert.equal(await status(expandir(ALFA, 'AUDIT:aud_alfa_000000001', 'AUDIT_CHECK', { parentDepth: 1 })), 200);
    assert.equal(await status(expandir(ALFA, 'PIPELINE_CARD:crd_alfa_000000001', 'PIPELINE_STAGE', { parentDepth: 1 })), 200);
  });

  it('a pesquisa nao lista o lead excluido', async () => {
    const r = await expandir(ALFA, 'SEARCH:srch_alfa_00000001', 'LEAD', { parentDepth: 1 });
    assert.ok(!JSON.stringify(r).includes('Lead apagado do Alfa'));
  });

  it('cartao orfao (tenant Alfa apontando para lead do Beta) nao abre para ninguem', async () => {
    assert.equal(await status(expandir(ALFA, 'PIPELINE_CARD:crd_alfa_orfao00001', 'PIPELINE_STAGE', { parentDepth: 1 })), 404);
    assert.equal(await status(expandir(BETA, 'PIPELINE_CARD:crd_alfa_orfao00001', 'PIPELINE_STAGE', { parentDepth: 1 })), 404);
  });

  it('Beta com ids de entidades do Alfa (ativas ou de lead excluido) recebe sempre 404', async () => {
    for (const [, ref, kind] of casos) assert.equal(await status(expandir(BETA, ref, kind, { parentDepth: 1 })), 404, ref);
    assert.equal(await status(expandir(BETA, 'SCORE:scr_alfa_000000001', 'SCORE_REASON', { parentDepth: 1 })), 404);
  });
});
