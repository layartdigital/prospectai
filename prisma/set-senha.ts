/**
 * Troca a senha de um usuario e derruba todas as sessoes dele.
 *
 * Existe como script, e nao como tela, pelo mesmo motivo do
 * `set-platform-admin.ts`: enquanto o produto nao tiver troca de senha, uma
 * rotacao exige acesso ao servidor, e nao apenas acesso a uma conta.
 *
 * Uso:
 *   pnpm db:senha pessoa@empresa.com "motivo da rotacao"
 *
 * A senha **nao vai na linha de comando**. Ela e lida do stdin, e isso e
 * seguranca, nao estilo: argumento de comando aparece no historico do shell, no
 * `ps` de qualquer processo da maquina e nos logs de auditoria do sistema.
 *
 *   - Terminal: pergunta duas vezes, sem eco, e compara.
 *   - Cano (`echo ... | pnpm db:senha ...`): le uma linha e segue.
 *
 * O que nunca sai daqui: a senha, o hash, ou qualquer pedaco dos dois.
 *
 * ---
 *
 * **Dois defeitos medidos em 26/09/2026, na validacao manual em TTY real.** Os
 * dois estavam no caminho do terminal, que nenhum teste automatizado exercita —
 * o teste usa stdin de cano, e cobrir o terminal exigiria pseudoterminal no CI.
 * E por isso que essa validacao e manual e obrigatoria.
 *
 * 1. **A confirmacao podia nao acontecer, em silencio.** O silencio do eco era
 *    um flag no `process.stdout`, compartilhado entre as duas leituras, e era
 *    ligado **depois** de `rl.question()`. Com a entrada ja no buffer — digitacao
 *    rapida, ou colar as duas linhas — o callback dispara dentro de `question()`
 *    e a linha seguinte religa o silencio, prendendo-o. O prompt `Repita a senha`
 *    nunca aparecia, e a segunda leitura consumia a linha que ja estava la. O
 *    operador acreditava ter conferido, e nao havia conferido. Numa operacao que
 *    troca a senha do OWNER, dupla digitacao que pode nao acontecer sem avisar e
 *    pior do que dupla digitacao que nao existe.
 * 2. **`Ctrl+C` no prompt travava o processo.** Sem ouvinte de `SIGINT`, o
 *    `readline` com `terminal: true` intercepta o sinal e apenas **pausa** a
 *    entrada. O processo nao morria e o terminal ficava em modo cru.
 *
 * A primeira tentativa de correcao manteve o `readline` e escreveu o rotulo por
 * fora dele. Isso resolveu os dois defeitos e **criou um terceiro**: o
 * `readline` calcula coluna de cursor a partir do proprio prompt, que passou a
 * ser vazio, enquanto o rotulo real ocupava 12 colunas que ele nao conhecia. O
 * sintoma medido foram linhas sobrescritas no terminal — pedaco do prompt do
 * shell escrito sobre a linha de erro, e comando aparecendo truncado na tela.
 *
 * **Entao o `readline` saiu do caminho do segredo.** Ler senha e um caso em que
 * quase nada do que o `readline` oferece serve: nao se quer eco, nem historico,
 * nem navegacao por setas, nem autocompletar. O que resta e ler bytes em modo
 * cru, e isso nao depende de metodo privado de biblioteca nem de flag em objeto
 * compartilhado. O `readline` continua fora daqui inteiro: nao ha import dele
 * neste arquivo.
 *
 * ---
 *
 * **Quarto ponto, este identificado como risco antes de acontecer** — pergunta do
 * dono do projeto, 26/09/2026: para onde vai a segunda linha de uma colagem?
 *
 * A primeira versao sem `readline` **descartava** o resto do pedaco depois do
 * Enter. Isso e seguro **se** a colagem chegar em um pedaco so. Chegando em dois,
 * o segundo chega depois de o ouvinte ter sido removido, fica no buffer do console
 * e o PowerShell o le como **comando** — na tela e no historico. Ou seja: uma
 * senha podia terminar no historico do shell, que e precisamente o que esta CLI
 * existe para evitar. E dependia de como o console fatia a entrada, o que nao e
 * uma variavel aceitavel no tratamento de um segredo.
 *
 * Agora o ouvinte e ligado uma vez e **fica ligado** ate o `finally` do programa,
 * e linhas que chegam adiantadas ficam numa fila **dentro do processo**. Nada
 * escapa. A consequencia visivel: colando as duas linhas, a segunda pergunta
 * aparece e e respondida na hora — visivel, e nao as escondidas. Dupla digitacao
 * colada nao confere typo nenhum, e por isso o runbook manda **digitar**.
 *
 * ---
 *
 * **Quinto e sexto, achados ao investigar por que uma colagem de teste nao colou**
 * (26/09/2026). A tentativa de `Ctrl+V` nao produziu colagem — em modo cru esse
 * byte chega a aplicacao e o console nao o traduz —, e a investigacao encontrou
 * dois defeitos que uma colagem de verdade teria disparado:
 *
 * 5. **`\r\n` era contado como duas quebras.** Colar duas linhas punha uma linha
 *    **vazia** na fila entre elas, e a confirmacao recebia o vazio em vez da
 *    segunda linha — recusando uma colagem correta por motivo inventado. Digitando
 *    nunca aparecia, porque o Enter manda so `\r`.
 * 6. **Sequencia ANSI contaminava a senha.** O `ESC` caia no filtro de controle,
 *    mas o resto — `[D` de uma seta, `[200~` de colagem entre parenteses — e texto
 *    imprimivel e **entrava na senha**. E havia um comentario afirmando o
 *    contrario: que setas eram ignoradas. Afirmacao sem mecanismo, o mesmo defeito
 *    de prosa que o `revokedAt` teve em `rotacionar-senha.ts`.
 *
 * Os dois eram invisiveis a digitacao e visiveis so a colagem, que e o caminho
 * que a rotacao real vai usar: a senha nova vem de gerenciador de senhas.
 *
 * ---
 *
 * **A interpretacao das teclas nao vive mais aqui.** Nas tentativas manuais
 * realizadas ate 28/09/2026, nenhuma chegou a exercitar o `Ctrl+C` dentro da
 * CLI: ficou claro que um passo que depende de um gesto humano irrepetivel nao
 * verifica nada. A logica foi para
 * `prisma/lib/teclas-de-segredo.ts`, que e pura e tem teste para cada um dos
 * casos acima: `Ctrl+C`, `\r\n`, sequencia ANSI, backspace (por ponto de codigo,
 * nao por unidade UTF-16), corte de pedaco.
 *
 * Deste arquivo sobrou o que e **dispositivo**: modo cru, ouvinte, fila e a ordem
 * das perguntas. E sobrou **uma** verificacao manual, que nenhum runner alcanca:
 * depois de uma interrupcao, o terminal volta a ecoar? Efeito em dispositivo nao
 * se prova com assercao — e, nas tentativas manuais realizadas ate 28/09/2026,
 * **essa verificacao nao foi executada**. O registro fica no runbook, §8.
 */

import path from 'node:path';

import dotenv from 'dotenv';

import { criarPrismaScript } from './cliente';
import { rotacionarSenha } from './lib/rotacionar-senha';
import { criarEstadoDasTeclas, processarTeclas } from './lib/teclas-de-segredo';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = criarPrismaScript();

/**
 * Estado do terminal, **um por processo**.
 *
 * O ouvinte de `data` e ligado na primeira leitura e **fica ligado** ate o fim do
 * programa. Nao e detalhe de estilo: se o ouvinte fosse removido entre a primeira
 * e a segunda pergunta, bytes que chegassem nessa fresta ficariam no buffer do
 * console — e no Windows o PowerShell os leria como **comando**, imprimindo na
 * tela e gravando no historico o que acabou de ser digitado como senha.
 *
 * Medido como risco em 26/09/2026, antes de qualquer execucao: colar duas linhas
 * pode chegar em um pedaco ou em dois, e isso depende do console, nao de nos.
 * Tratamento de segredo que depende de como o console fatia a entrada nao e
 * tratamento de segredo.
 *
 * Por isso as linhas que chegam adiantadas ficam **na fila, dentro do processo**,
 * e a leitura seguinte as consome. Nada e descartado para fora.
 */
interface EstadoDoTerminal {
  /** Linhas completas que chegaram antes de alguem pedir. */
  readonly fila: string[];
  /** Quem esta esperando uma linha agora, se alguem estiver. */
  esperando: { readonly resolver: (linha: string) => void; readonly recusar: (erro: Error) => void } | null;
  ligado: boolean;
  /** Modo cru como estava antes de nos: restaurado, nao chutado para `false`. */
  eraCru: boolean;
  /** `Ctrl+C` ou `Ctrl+D` chegou. Recusa tambem a leitura seguinte. */
  interrompido: boolean;
}

const terminal: EstadoDoTerminal = {
  fila: [],
  esperando: null,
  ligado: false,
  eraCru: false,
  interrompido: false,
};

/**
 * Estado da interpretacao das teclas. A logica vive em `./lib/teclas-de-segredo`,
 * que e pura e tem teste proprio. Aqui sobra apenas o que e dispositivo: modo
 * cru, fila e ordem das perguntas.
 */
let teclas = criarEstadoDasTeclas();

const INTERROMPIDO = 'Interrompido no prompt. Nada foi alterado.';

function entregar(linha: string): void {
  const espera = terminal.esperando;

  if (espera) {
    terminal.esperando = null;
    process.stdout.write('\n');
    espera.resolver(linha);
    return;
  }

  terminal.fila.push(linha);
}

function interromper(): void {
  terminal.interrompido = true;
  desligarTerminal();
  process.stdout.write('\n');

  const espera = terminal.esperando;
  terminal.esperando = null;
  espera?.recusar(new Error(INTERROMPIDO));
}

/** Adaptador fino: o que interpreta tecla e a funcao pura; aqui so se despacha. */
function aoReceber(pedaco: string): void {
  for (const evento of processarTeclas(teclas, pedaco)) {
    if (evento.tipo === 'linha') {
      entregar(evento.linha);
      continue;
    }

    interromper();
    return;
  }
}

function ligarTerminal(): void {
  if (terminal.ligado) return;

  terminal.ligado = true;
  terminal.eraCru = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', aoReceber);
}

/**
 * Devolve o terminal ao estado anterior e **esvazia a fila**. Chamada no `finally`
 * do programa: sem ela o stdin fica cru e o processo nao termina, porque o
 * ouvinte mantem o laco de eventos vivo.
 *
 * **E o unico ponto do modulo que o teste automatizado nao alcanca**, porque o
 * efeito e no dispositivo e nao no valor devolvido. E por isso que a validacao
 * manual em TTY continua obrigatoria, reduzida a uma pergunta: depois de um
 * `Ctrl+C`, o terminal volta a ecoar?
 */
function desligarTerminal(): void {
  if (!terminal.ligado) return;

  terminal.ligado = false;
  process.stdin.removeListener('data', aoReceber);
  process.stdin.setRawMode(terminal.eraCru);
  process.stdin.pause();
  terminal.fila.length = 0;
  teclas = criarEstadoDasTeclas();
}

/** Le uma linha do stdin sem eco quando ha terminal; do cano quando nao ha. */
function lerSegredo(rotulo: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (pedaco: string) => {
        buffer += pedaco;
      });
      process.stdin.on('end', () => resolve(buffer.split('\n')[0] ?? ''));
      process.stdin.on('error', reject);
    });
  }

  if (terminal.interrompido) return Promise.reject(new Error(INTERROMPIDO));

  ligarTerminal();

  // O rotulo sai por nossa conta, uma vez. Nenhuma biblioteca gerencia esta
  // linha, entao nenhuma biblioteca tem opiniao sobre a coluna do cursor.
  process.stdout.write(`${rotulo}: `);

  const adiantada = terminal.fila.shift();
  if (adiantada !== undefined) {
    // Ja estava na fila: uma colagem de duas linhas cai aqui. A pergunta aparece
    // na tela e e respondida na hora. Visivel, e nao as escondidas — e a linha
    // nao escapa para o shell, que era o risco real.
    process.stdout.write('\n');
    return Promise.resolve(adiantada);
  }

  return new Promise<string>((resolver, recusar) => {
    terminal.esperando = { resolver, recusar };
  });
}

async function main(): Promise<void> {
  const [email, motivo] = process.argv.slice(2);

  if (!email || !motivo) {
    console.log('\n  Uso:');
    console.log('    pnpm db:senha pessoa@empresa.com "motivo da rotacao"');
    console.log('\n  A senha e lida do stdin, nunca por argumento.\n');
    process.exitCode = 1;
    return;
  }

  const senha = await lerSegredo('Senha nova');

  if (process.stdin.isTTY) {
    const confirmacao = await lerSegredo('Repita a senha');
    if (senha !== confirmacao) {
      console.error('  As duas digitacoes nao conferem. Nada foi alterado.');
      process.exitCode = 1;
      return;
    }
  }

  const resultado = await rotacionarSenha(prisma, {
    email,
    senhaNova: senha,
    motivo,
    origem: 'cli',
  });

  console.log(`\n  Senha trocada: ${resultado.email}`);
  // "Refresh tokens validos revogados", e nao "Sessoes revogadas": linha de
  // refresh nao e sessao — uma cadeia de rotacao produz varias para o mesmo
  // navegador — e expirada nao e revogada. Ver `prisma/lib/rotacionar-senha.ts`.
  console.log(`  Refresh tokens validos revogados: ${resultado.tokensValidosRevogados}`);
  console.log('  Trilha: SECURITY.PASSWORD_ROTATED (evento global, tenantId nulo)\n');
}

main()
  .catch((erro: unknown) => {
    console.error(`  ${erro instanceof Error ? erro.message : String(erro)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    // Antes do banco: sem isto o stdin fica cru e o ouvinte segura o laco de
    // eventos, entao o processo nao termina nem com tudo pronto.
    desligarTerminal();
    void prisma.$disconnect();
  });
