/**
 * Saida PUBLICAVEL dos resultados do E2E (P04-QA-04R).
 *
 * O `resultado.json` do Playwright e um relatorio interno bruto: carrega o
 * contexto completo de cada falha (trechos de codigo, mensagens com o que a
 * pagina mostrava, caminhos de anexos, saida padrao dos testes). A primeira
 * varredura do CI achou marcadores sensiveis nele e, corretamente, bloqueou a
 * publicacao. Em vez de tentar "limpar" o bruto por busca e troca, este script
 * monta uma saida nova por LISTA PERMITIDA: so os campos abaixo existem no
 * arquivo publicavel; qualquer campo desconhecido do bruto e ignorado por
 * construcao.
 *
 * Preservado: ID e titulo do cenario, arquivo, projeto, estado, duracao,
 * tentativas, categoria e resumo tratado do erro, contagens, commit e run.
 * Nunca copiado: stdout/stderr, anexos, passos, configuracao, trechos de
 * codigo, cabecalhos, cookies, corpos de requisicao.
 *
 * Alem disso:
 *  - o resumo do erro e cortado antes de "Call log" e limitado em tamanho;
 *  - valores conhecidos (as tres senhas descartaveis do job) e padroes de
 *    cookie/cabecalho sao substituidos por marcadores neutros;
 *  - se, depois de tudo, o arquivo gerado AINDA contiver um marcador, o script
 *    sai com erro e NAO deixa o arquivo no disco — a publicacao fica bloqueada.
 *
 * Diagnostico: imprime, para cada arquivo bruto, QUANTOS marcadores ha por
 * CATEGORIA DE CAMPO (caminho com indices normalizados) e por tipo de marcador.
 * Nunca imprime um valor.
 *
 * Uso:
 *   node sanitizar-resultados.mjs --saida <dir> etapa=<resultado.json> [etapa=<...>]
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- marcadores
const SENHAS = [
  ['senha-owner', process.env.SEED_OWNER_PASSWORD],
  ['senha-sdr', process.env.SEED_SDR_PASSWORD],
  ['senha-beta', process.env.E2E_BETA_PASSWORD],
]
  // Senha vazia casaria com tudo: so entra se existir e tiver tamanho de senha.
  .filter(([, v]) => typeof v === 'string' && v.length >= 8);

const PADROES = [
  ['cookie-pa_at', /pa_at=/i],
  ['cookie-pa_rt', /pa_rt=/i],
  ['cabecalho-set-cookie', /set-cookie/i],
  ['cabecalho-authorization', /authorization\s*:/i],
  ['bearer', /bearer\s+[a-z0-9._-]{12,}/i],
  ['jwt', /eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\./],
];

/** Tipos de marcador encontrados em `texto` (sem devolver nenhum valor). */
function marcadoresEm(texto) {
  const achados = [];
  for (const [nome, valor] of SENHAS) if (texto.includes(valor)) achados.push(nome);
  for (const [nome, re] of PADROES) if (re.test(texto)) achados.push(nome);
  return achados;
}

function redigir(texto) {
  let t = texto;
  for (const [, valor] of SENHAS) t = t.split(valor).join('[senha-do-job]');
  // Troca o '=' por ':' de proposito: o marcador `pa_at=` nao pode sobrar no texto tratado.
  t = t.replace(/(pa_at|pa_rt)=[^\s;"']*/gi, '$1:[omitido]');
  t = t.replace(/set-cookie[^\n]*/gi, '[cabecalho-omitido]');
  t = t.replace(/authorization\s*:[^\n]*/gi, '[cabecalho-omitido]');
  t = t.replace(/bearer\s+[a-z0-9._-]{12,}/gi, 'Bearer [omitido]');
  t = t.replace(/eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]*/g, '[jwt-omitido]');
  return t;
}

// ---------------------------------------------------------------- diagnostico
/** Conta marcadores por categoria de campo. Nao devolve valores. */
function diagnosticar(raiz) {
  const porCategoria = new Map();
  const visitar = (valor, caminho) => {
    if (Array.isArray(valor)) {
      for (const item of valor) visitar(item, `${caminho}[]`);
    } else if (valor !== null && typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor)) visitar(v, `${caminho}.${k}`);
    } else if (typeof valor === 'string') {
      for (const tipo of marcadoresEm(valor)) {
        const chave = `${caminho}  <-  ${tipo}`;
        porCategoria.set(chave, (porCategoria.get(chave) ?? 0) + 1);
      }
    }
  };
  visitar(raiz, '$');
  return [...porCategoria.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------- projecao
const ANSI = /\u001b\[[0-9;]*m/g;

function resumirErro(erros) {
  if (!Array.isArray(erros) || erros.length === 0) return null;
  const bruto = String(erros[0]?.message ?? '').replace(ANSI, '');
  // O "Call log" e o trecho de codigo trazem contexto de execucao: ficam de fora.
  const semLog = bruto.split(/\n\s*Call log:/i)[0] ?? '';
  // Linhas de trecho de codigo ("> 280 | ...", "  281 | ...") carregam literais do teste: ficam de fora.
  const linhas = semLog
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '' && !/^\s*>?\s*\d+\s*\|/.test(l));
  let resumo = redigir(linhas.slice(0, 8).join('\n')).slice(0, 900);
  if (marcadoresEm(resumo).length > 0) resumo = '[mensagem omitida: ainda continha marcador sensivel apos o tratamento]';
  const primeira = (linhas[0] ?? '').toLowerCase();
  const categoria = /timeout|exceeded/.test(primeira)
    ? 'timeout'
    : /expect|expected|received|tohave|tobe|tocontain/.test(bruto.toLowerCase())
      ? 'asserção'
      : 'erro-de-execucao';
  return { categoria, resumo };
}

function idDoCenario(titulo) {
  const m = /^(E2E-\d+[a-z]?)\b/.exec(titulo);
  return m ? m[1] : null;
}

function* testes(suites, arquivoPai = '') {
  for (const suite of suites ?? []) {
    const arquivo = suite.file ?? arquivoPai;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) yield { arquivo: spec.file ?? arquivo, spec, teste: t };
    }
    yield* testes(suite.suites, arquivo);
  }
}

function projetar(bruto, etapa) {
  const itens = [];
  for (const { arquivo, spec, teste } of testes(bruto.suites)) {
    const resultados = teste.results ?? [];
    const ultimo = resultados[resultados.length - 1] ?? {};
    const titulo = redigir(String(spec.title ?? ''));
    itens.push({
      id: idDoCenario(titulo),
      arquivo: path.basename(String(arquivo)),
      titulo,
      projeto: String(teste.projectName ?? ''),
      // expected | unexpected | flaky | skipped (campo `status` do teste no JSON do Playwright)
      estado: String(teste.status ?? 'desconhecido'),
      estadoDoUltimoResultado: String(ultimo.status ?? 'desconhecido'),
      duracaoMs: Number(ultimo.duration ?? 0),
      tentativas: resultados.length,
      erro: resumirErro(ultimo.errors),
    });
  }
  const estados = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  for (const i of itens) if (i.estado in estados) estados[i.estado] += 1;
  return {
    etapa,
    commit: process.env.GITHUB_SHA ?? null,
    repositorio: process.env.GITHUB_REPOSITORY ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    run: process.env.GITHUB_RUN_ID ?? null,
    tentativaDoRun: process.env.GITHUB_RUN_ATTEMPT ?? null,
    total: itens.length,
    aprovados: estados.expected,
    reprovados: estados.unexpected,
    instaveis: estados.flaky,
    naoExecutados: estados.skipped,
    duracaoTotalMs: Math.round(Number(bruto.stats?.duration ?? 0)),
    testes: itens,
  };
}

function resumoMarkdown(publicaveis) {
  const linhas = ['# Resultado E2E (saída publicável, sanitizada)', ''];
  for (const p of publicaveis) {
    linhas.push(`## ${p.etapa}`);
    if (p.semResultado) {
      linhas.push('', 'Sem `resultado.json`: a etapa não chegou a rodar.', '');
      continue;
    }
    linhas.push(
      '',
      `commit \`${p.commit ?? '?'}\` · run ${p.run ?? '?'} · total ${p.total} · aprovados ${p.aprovados} · reprovados ${p.reprovados} · instáveis ${p.instaveis} · não executados ${p.naoExecutados}`,
      '',
      '| ID | Arquivo | Teste | Estado | ms |',
      '|---|---|---|---|---:|',
    );
    for (const t of p.testes) {
      const titulo = t.titulo.replace(/\|/g, '\\|');
      linhas.push(`| ${t.id ?? '-'} | ${t.arquivo} | ${titulo} | ${t.estado} | ${t.duracaoMs} |`);
    }
    const falhas = p.testes.filter((t) => t.erro);
    if (falhas.length > 0) {
      linhas.push('', '### Erros (resumo tratado)', '');
      for (const t of falhas) {
        linhas.push(`- **${t.id ?? t.titulo}** (${t.erro.categoria}): ${t.erro.resumo.split('\n')[0].replace(/\|/g, '\\|')}`);
      }
    }
    linhas.push('');
  }
  return `${linhas.join('\n')}\n`;
}

// ---------------------------------------------------------------- main
function main() {
  const args = process.argv.slice(2);
  const iSaida = args.indexOf('--saida');
  if (iSaida < 0 || !args[iSaida + 1]) {
    console.error('uso: sanitizar-resultados.mjs --saida <dir> etapa=<resultado.json> ...');
    process.exit(2);
  }
  const saida = args[iSaida + 1];
  const etapas = args.filter((a, i) => i !== iSaida && i !== iSaida + 1 && a.includes('='));
  if (etapas.length === 0) {
    console.error('nenhuma etapa informada');
    process.exit(2);
  }

  fs.mkdirSync(saida, { recursive: true });
  const publicaveis = [];
  const escritos = [];

  for (const par of etapas) {
    const [etapa, arquivo] = [par.slice(0, par.indexOf('=')), par.slice(par.indexOf('=') + 1)];
    if (!fs.existsSync(arquivo)) {
      console.log(`[${etapa}] sem resultado bruto (a etapa nao chegou a rodar): nada a publicar`);
      publicaveis.push({ etapa, semResultado: true });
      continue;
    }
    const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

    const diag = diagnosticar(bruto);
    console.log(`[${etapa}] diagnostico do arquivo BRUTO (nao publicado) — marcadores por categoria de campo:`);
    if (diag.length === 0) console.log('  (nenhum marcador)');
    for (const [chave, n] of diag) console.log(`  ${String(n).padStart(4)}  ${chave}`);

    const publicavel = projetar(bruto, etapa);
    publicaveis.push(publicavel);
    const destino = path.join(saida, etapa, 'resultado-publicavel.json');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, `${JSON.stringify(publicavel, null, 2)}\n`, 'utf8');
    escritos.push(destino);
    console.log(`[${etapa}] publicavel: ${publicavel.total} testes (${publicavel.aprovados} aprovados, ${publicavel.reprovados} reprovados, ${publicavel.naoExecutados} nao executados)`);
  }

  const resumo = path.join(saida, 'RESUMO.md');
  fs.writeFileSync(resumo, resumoMarkdown(publicaveis), 'utf8');
  escritos.push(resumo);

  // Verificacao final do que sera PUBLICADO. Achou: apaga e reprova.
  let reprovou = false;
  for (const arquivo of escritos) {
    const achados = marcadoresEm(fs.readFileSync(arquivo, 'utf8'));
    if (achados.length > 0) {
      reprovou = true;
      console.error(`SANITIZACAO FALHOU em ${path.basename(arquivo)}: marcadores [${[...new Set(achados)].join(', ')}]`);
      fs.rmSync(arquivo, { force: true });
    }
  }
  if (reprovou) process.exit(1);
  console.log('sanitizacao ok: a saida publicavel nao contem marcadores');
}

main();
