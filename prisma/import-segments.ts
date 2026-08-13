/**
 * Importa a base de segmentos B2B.
 *
 * Uso:
 *   pnpm db:segments caminho/para/base_inteligencia_b2b_500_segmentos_v1.txt
 *
 * O arquivo é separado por tabulação e vem em **cp1252**, não UTF-8 — sem a
 * conversão, a taxonomia nasce com "Servi�os" em cada linha. É o tipo de
 * defeito que passa despercebido no import e reaparece na tela do cliente.
 *
 * Idempotente por `externalId`: rodar duas vezes atualiza, não duplica.
 *
 * O que este script **não** faz: julgar a qualidade das 500 linhas. A base é
 * ponto de partida, não verdade curada — o tenant escolhe o segmento, recebe
 * os valores preenchidos e ajusta. Curar 500 entradas antes de ter cliente
 * seria trabalho sem retorno conhecido.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

/** Colunas da base, na ordem em que aparecem. */
const COLUNAS = [
  'externalId',
  'macroSegment',
  'name',
  'specialty',
  'services',
  'searchTerms',
  'icp',
  'targetSectors',
  'painPoints',
  'opportunitySignals',
  'objective',
  'contractModel',
  'recurrence',
] as const;

/**
 * Campos multivalorados vêm entre aspas, separados por ponto e vírgula.
 * Vazio devolve lista vazia, não `['']` — que apareceria como opção em branco
 * na interface.
 */
function listaDe(valor: string | undefined): string[] {
  if (!valor) return [];

  return valor
    .replace(/^"|"$/g, '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function texto(valor: string | undefined): string | null {
  const limpo = valor?.replace(/^"|"$/g, '').trim();
  return limpo || null;
}

async function main(): Promise<void> {
  const arquivo = process.argv[2];

  if (!arquivo) {
    console.log('\n  Informe o caminho do arquivo.');
    console.log('  Exemplo: pnpm db:segments ./base_b2b.txt\n');
    process.exitCode = 1;
    return;
  }

  // latin1 é o rótulo do Node para cp1252 no que interessa aqui: os acentos
  // do português caem na mesma faixa.
  const conteudo = readFileSync(path.resolve(arquivo), 'latin1');

  const linhas = conteudo
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  // A primeira linha é o cabeçalho da planilha.
  const dados = linhas.slice(1);

  let criados = 0;
  let atualizados = 0;
  const ignorados: string[] = [];

  /**
   * Guarda de coluna trocada.
   *
   * O `externalId` da base tem o formato B2B-0000. Se a primeira coluna lida
   * não bater com isso, o parser está desalinhado — e insistir gravaria uma
   * taxonomia silenciosamente errada, que é pior que não importar nada.
   */
  const primeiro = dados[0]?.split('\t')[0]?.trim();
  if (!primeiro || !/^B2B-\d+$/.test(primeiro)) {
    console.log('\n  A primeira coluna não parece ser o ID da base.');
    console.log(`  Encontrado: "${primeiro ?? '(vazio)'}"  ·  Esperado: B2B-0001`);
    console.log('  O arquivo mudou de formato ou o separador não é tabulação.\n');
    process.exitCode = 1;
    return;
  }

  for (const linha of dados) {
    // O arquivo começa direto na coluna ID. A primeira versão deste script
    // descartava a primeira célula, por eu ter confundido os números de linha
    // que o editor exibe com uma coluna real — o que deslocava tudo: o
    // macro-segmento virava `externalId`, e os 500 registros colapsavam em 25,
    // sobrescritos vinte vezes cada.
    //
    // O sintoma foi "25 criados, 475 atualizados" numa tabela vazia. Import que
    // atualiza o que não existe está lendo a coluna errada.
    const campos = linha.split('\t');
    const registro = Object.fromEntries(
      COLUNAS.map((coluna, indice) => [coluna, campos[indice]]),
    ) as Record<(typeof COLUNAS)[number], string | undefined>;

    const externalId = texto(registro.externalId);
    const name = texto(registro.name);
    const macroSegment = texto(registro.macroSegment);

    if (!externalId || !name || !macroSegment) {
      ignorados.push(linha.slice(0, 60));
      continue;
    }

    const existente = await prisma.segment.findUnique({ where: { externalId } });

    const dadosSegmento = {
      macroSegment,
      name,
      specialty: texto(registro.specialty),
      services: listaDe(registro.services),
      targetSectors: listaDe(registro.targetSectors),
      opportunitySignals: listaDe(registro.opportunitySignals),
      painPoints: texto(registro.painPoints),
      contractModel: texto(registro.contractModel),
      recurrence: texto(registro.recurrence),
    };

    const segmento = await prisma.segment.upsert({
      where: { externalId },
      create: { externalId, ...dadosSegmento },
      update: dadosSegmento,
    });

    // O locale de origem é pt-BR, e nasce CURADO: veio de pessoa, não de
    // modelo. Os demais idiomas entram depois como GERADO até serem validados
    // contra resultado real do scraper.
    await prisma.segmentLocale.upsert({
      where: { segmentId_locale: { segmentId: segmento.id, locale: 'pt-BR' } },
      create: {
        segmentId: segmento.id,
        locale: 'pt-BR',
        country: 'BR',
        label: name,
        searchTerms: listaDe(registro.searchTerms),
        status: 'CURADO',
      },
      update: {
        label: name,
        searchTerms: listaDe(registro.searchTerms),
        status: 'CURADO',
      },
    });

    if (existente) atualizados += 1;
    else criados += 1;
  }

  const macros = await prisma.segment.groupBy({
    by: ['macroSegment'],
    _count: true,
    orderBy: { _count: { macroSegment: 'desc' } },
  });

  console.log('\n  Importação de segmentos');
  console.log('  ────────────────────────');
  console.log(`  Criados      ${criados}`);
  console.log(`  Atualizados  ${atualizados}`);
  if (ignorados.length > 0) {
    console.log(`  Ignorados    ${ignorados.length} (linha sem id, nome ou macro)`);
  }
  console.log('');
  console.log(`  ${macros.length} macro-segmentos:`);
  for (const macro of macros.slice(0, 15)) {
    console.log(`    ${String(macro._count).padStart(4)}  ${macro.macroSegment}`);
  }
  if (macros.length > 15) console.log(`    ... e mais ${macros.length - 15}`);
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error('Falha na importação:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
