/**
 * Interpretacao das teclas digitadas num prompt de senha em modo cru.
 *
 * **Por que isto vive aqui, e nao dentro de `prisma/set-senha.ts`.** Escrito em
 * 26/09/2026: nas tentativas manuais realizadas ate 28/09/2026, nenhuma chegou
 * a exercitar o `Ctrl+C` dentro da CLI. O passo dependia de um gesto humano
 * irrepetivel, e o que nao se consegue medir de forma repetivel nao esta
 * verificado — esta suposto. Separar a logica do dispositivo torna a logica
 * afirmavel; o teste vive em `apps/api/test/teclas-de-segredo.spec.ts`, do mesmo
 * jeito que o de `rotacionar-senha.ts`.
 *
 * **E por que em `prisma/lib/` e nao em `packages/types/`.** A primeira versao
 * foi para `packages/types` **porque la havia runner de teste** — escolher o dono
 * de um modulo pelo ferramental disponivel e inversao de ownership, corrigida na
 * revisao de 28/09/2026. Isto e logica operacional **exclusiva da CLI**, nao
 * contrato compartilhado entre api, web e worker, que e o que aquele pacote diz
 * de si mesmo na primeira linha. Nada de `apps/api/src` importa daqui; so o
 * teste, como ja acontece com `rotacionar-senha.ts`.
 *
 * A funcao e **pura**: recebe estado e um pedaco de texto, devolve eventos. Nao
 * conhece `process.stdin`, nao liga modo cru, nao escreve na tela. Isso deixa
 * automatizavel tudo o que e logica — `Ctrl+C`, `\r\n`, setas, backspace — e
 * reduz o teste manual ao unico ponto que **nenhum runner alcanca**: o terminal
 * voltar a ecoar depois de uma interrupcao, que e efeito no dispositivo e nao
 * valor devolvido.
 *
 * **Teste que passou aqui nao e CI.** Ate existir commit, push e run remoto
 * verde no SHA correspondente, o que ha e `LOCAL_AUTOMATED_TEST = PASS`.
 *
 * Os tres defeitos que a versao anterior teve, todos aqui dentro agora:
 *
 * 1. `\r\n` contado como duas quebras — colar duas linhas punha uma linha vazia
 *    entre elas, e a confirmacao recebia o vazio;
 * 2. sequencia ANSI contaminando o texto — o `ESC` era descartado e o resto
 *    (`[D` de uma seta, `[200~` de colagem entre parenteses) entrava como texto;
 * 3. `Ctrl+C` tratado por ouvinte de sinal — em modo cru ele nao chega como
 *    sinal, chega como o byte `0x03`.
 */

/** O que uma sequencia de teclas produziu. Ordem preservada. */
export type EventoDeTecla =
  | { readonly tipo: 'linha'; readonly linha: string }
  | { readonly tipo: 'interrompido' };

export interface EstadoDasTeclas {
  /** Digitado desde a ultima quebra. */
  parcial: string;
  /** Dentro de uma sequencia ANSI: `inicio` viu o ESC, `csi` viu o `[` ou `O`. */
  escape: 'nao' | 'inicio' | 'csi';
  /** O caractere anterior foi `\r`, entao um `\n` agora e a mesma quebra. */
  aposCR: boolean;
}

export function criarEstadoDasTeclas(): EstadoDasTeclas {
  return { parcial: '', escape: 'nao', aposCR: false };
}

/** `0x03` (Ctrl+C) e `0x04` (Ctrl+D). Recusa, nao caractere. */
const INTERRUPCOES = new Set(['\u0003', '\u0004']);
/** DEL e BS. Os dois aparecem como "backspace" conforme o terminal. */
const APAGAR = new Set(['\u007f', '\b']);

/**
 * Consome um pedaco de entrada e devolve os eventos que ele gerou.
 *
 * **Depois de `interrompido` a funcao para**: o resto do pedaco e descartado, e
 * `parcial` e zerado. Nao ha "continuar digitando depois de cancelar".
 *
 * O estado e mutado de proposito — uma sequencia ANSI ou um `\r\n` pode chegar
 * cortado entre dois pedacos de `data`, e o corte nao pode mudar o resultado.
 */
export function processarTeclas(estado: EstadoDasTeclas, pedaco: string): EventoDeTecla[] {
  const eventos: EventoDeTecla[] = [];

  for (const tecla of pedaco) {
    // Sequencia ANSI primeiro: o ESC sozinho seria descartado pelo filtro de
    // controle, e o resto da sequencia e texto imprimivel.
    if (estado.escape === 'csi') {
      const codigo = tecla.codePointAt(0) ?? 0;
      // Byte final de CSI: 0x40..0x7E. Antes dele vem parametro e intermediario.
      if (codigo >= 0x40 && codigo <= 0x7e) estado.escape = 'nao';
      continue;
    }
    if (estado.escape === 'inicio') {
      estado.escape = tecla === '[' || tecla === 'O' ? 'csi' : 'nao';
      continue;
    }
    if (tecla === '\u001b') {
      estado.escape = 'inicio';
      continue;
    }

    if (tecla === '\r' || tecla === '\n') {
      // `\r\n` e UMA quebra. Digitando nunca aparece — o Enter manda so `\r` —,
      // entao este caso so existe em colagem, e era invisivel ao teste manual.
      if (tecla === '\n' && estado.aposCR) {
        estado.aposCR = false;
        continue;
      }
      estado.aposCR = tecla === '\r';
      eventos.push({ tipo: 'linha', linha: estado.parcial });
      estado.parcial = '';
      continue;
    }

    estado.aposCR = false;

    if (INTERRUPCOES.has(tecla)) {
      estado.parcial = '';
      estado.escape = 'nao';
      eventos.push({ tipo: 'interrompido' });
      return eventos;
    }

    if (APAGAR.has(tecla)) {
      /**
       * **Por ponto de codigo, nao por unidade UTF-16.** `slice(0, -1)` remove
       * uma unidade, e um emoji ocupa duas: apagar um `🔑` deixaria metade de um
       * par substituto no texto. Meia senha com meio caractere e comparada com a
       * segunda digitacao como se fosse texto, e nao e.
       *
       * Deliberadamente **nao** vai ate cluster de grafema: `é` composto por
       * `e` + acento combinante ainda precisaria de dois backspaces. Isso e
       * conhecido e aceito — o caso comum e emoji, e ampliar exigiria
       * `Intl.Segmenter` e uma discussao que este modulo nao precisa ter hoje.
       */
      const pontos = Array.from(estado.parcial);
      pontos.pop();
      estado.parcial = pontos.join('');
      continue;
    }

    // Sobrou controle solto: Tab, Ctrl+L, e o `0x16` do Ctrl+V — que **nao cola**
    // em modo cru, porque o console nao o traduz. Colagem chega como dados.
    if (tecla < ' ') continue;

    estado.parcial += tecla;
  }

  return eventos;
}
