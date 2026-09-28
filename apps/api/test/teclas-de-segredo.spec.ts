import {
  criarEstadoDasTeclas,
  processarTeclas,
  type EventoDeTecla,
} from '../../../prisma/lib/teclas-de-segredo';

/**
 * Estes testes existem porque a validacao manual em TTY **nao conseguiu** medir
 * o `Ctrl+C`: nas tentativas realizadas ate 28/09/2026, nenhuma chegou a
 * exercita-lo dentro da CLI. Um passo que depende de um gesto humano
 * irrepetivel nao e verificacao, e sim esperanca.
 *
 * **Import de `prisma/lib` so em teste**, como em `rotacao-senha.spec.ts`. Nada
 * de `apps/api/src` importa daquele diretorio, e o `tsconfig.json` da app garante
 * isso pelo `rootDir`; quem permite o import aqui e o `tsconfig.tests.json`, que
 * so faz verificacao de tipos.
 *
 * O que continua manual, e nao cabe aqui: o terminal voltar a ecoar depois da
 * interrupcao. Isso e efeito no dispositivo — `setRawMode(false)` — e nao logica.
 */

function rodar(...pedacos: readonly string[]): EventoDeTecla[] {
  const estado = criarEstadoDasTeclas();
  return pedacos.flatMap((pedaco) => processarTeclas(estado, pedaco));
}

const linhas = (eventos: readonly EventoDeTecla[]): string[] =>
  eventos.filter((e): e is { tipo: 'linha'; linha: string } => e.tipo === 'linha').map((e) => e.linha);

describe('uma linha por Enter', () => {
  it('Enter no terminal manda so \\r', () => {
    expect(linhas(rodar('SenhaDeTeste12\r'))).toEqual(['SenhaDeTeste12']);
  });

  it('sem Enter nao ha linha: o texto fica esperando', () => {
    expect(rodar('SenhaDeTeste12')).toEqual([]);
  });

  it('o texto sobrevive ao corte entre dois pedacos de data', () => {
    expect(linhas(rodar('Senha', 'DeTeste12\r'))).toEqual(['SenhaDeTeste12']);
  });
});

describe('`\\r\\n` e UMA quebra — o defeito que a colagem disparava', () => {
  it('duas linhas coladas produzem duas linhas, sem vazio entre elas', () => {
    expect(linhas(rodar('aaaaaaaaaaaa\r\nbbbbbbbbbbbb\r\n'))).toEqual([
      'aaaaaaaaaaaa',
      'bbbbbbbbbbbb',
    ]);
  });

  it('o `\\n` separado do `\\r` por corte de pedaco ainda e a mesma quebra', () => {
    expect(linhas(rodar('aaaaaaaaaaaa\r', '\nbbbbbbbbbbbb\r'))).toEqual([
      'aaaaaaaaaaaa',
      'bbbbbbbbbbbb',
    ]);
  });

  it('`\\n` sozinho continua sendo quebra — nao se exige `\\r` antes', () => {
    expect(linhas(rodar('aaaaaaaaaaaa\nbbbbbbbbbbbb\n'))).toEqual([
      'aaaaaaaaaaaa',
      'bbbbbbbbbbbb',
    ]);
  });

  it('linha vazia de verdade — dois Enters seguidos — continua chegando', () => {
    expect(linhas(rodar('\r\r'))).toEqual(['', '']);
  });
});

describe('Ctrl+C e Ctrl+D: recusa, e o resto do pedaco morre com ela', () => {
  it.each([
    ['Ctrl+C', '\u0003'],
    ['Ctrl+D', '\u0004'],
  ])('%s no meio da digitacao interrompe', (_nome, byte) => {
    expect(rodar(`SenhaDeTeste12${byte}`)).toEqual([{ tipo: 'interrompido' }]);
  });

  it('nada digitado antes tambem interrompe', () => {
    expect(rodar('\u0003')).toEqual([{ tipo: 'interrompido' }]);
  });

  it('o que vier depois do Ctrl+C no mesmo pedaco e descartado', () => {
    expect(rodar('abc\u0003xyz\r')).toEqual([{ tipo: 'interrompido' }]);
  });

  it('uma linha concluida ANTES do Ctrl+C sobrevive, e a interrupcao vem depois', () => {
    expect(rodar('SenhaDeTeste12\r\u0003')).toEqual([
      { tipo: 'linha', linha: 'SenhaDeTeste12' },
      { tipo: 'interrompido' },
    ]);
  });
});

describe('sequencia ANSI nao entra no texto — o defeito do comentario falso', () => {
  it.each([
    ['seta esquerda', '\u001b[D'],
    ['seta cima', '\u001b[A'],
    ['Home', '\u001b[1~'],
    ['F5', '\u001b[15~'],
    ['seta em modo aplicacao', '\u001bOD'],
  ])('%s desaparece inteira', (_nome, sequencia) => {
    expect(linhas(rodar(`aaa${sequencia}bbb\r`))).toEqual(['aaabbb']);
  });

  it('marcador de colagem entre parenteses nao entra no texto', () => {
    expect(linhas(rodar('\u001b[200~SenhaColada12\u001b[201~\r'))).toEqual(['SenhaColada12']);
  });

  it('a sequencia sobrevive ao corte entre pedacos', () => {
    expect(linhas(rodar('aaa\u001b', '[D', 'bbb\r'))).toEqual(['aaabbb']);
  });

  it('ESC seguido de caractere comum consome so aquele caractere', () => {
    expect(linhas(rodar('aaa\u001bZbbb\r'))).toEqual(['aaabbb']);
  });
});

describe('backspace, e controle solto', () => {
  it.each([
    ['DEL', '\u007f'],
    ['BS', '\b'],
  ])('%s apaga o ultimo caractere', (_nome, byte) => {
    expect(linhas(rodar(`abcx${byte}\r`))).toEqual(['abc']);
  });

  it('backspace com nada digitado nao quebra nem inventa caractere', () => {
    expect(linhas(rodar('\u007f\u007fabc\r'))).toEqual(['abc']);
  });

  it('backspace apaga o emoji inteiro, e nao meia unidade UTF-16', () => {
    expect(linhas(rodar('abc🔑\u007f\r'))).toEqual(['abc']);
  });

  it('e o que sobra depois disso continua sendo texto valido', () => {
    const [linha] = linhas(rodar('abc🔑\u007fdef\r'));
    expect(linha).toBe('abcdef');
    expect(linha).not.toContain('\ud83d');
    expect(linha).not.toContain('\udd11');
  });

  it('Tab e Ctrl+V (`0x16`) sao descartados — Ctrl+V nao cola em modo cru', () => {
    expect(linhas(rodar('aaa\t\u0016bbb\r'))).toEqual(['aaabbb']);
  });

  it('acento e emoji continuam sendo um caractere cada', () => {
    expect(linhas(rodar('caça🔑ao\r'))).toEqual(['caça🔑ao']);
  });
});
