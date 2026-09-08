/**
 * Montagem de CSV — as decisões de formato num lugar só.
 *
 * Extraído do `leads.service.ts` em 04/09/2026, quando o export de auditoria
 * passou a precisar das mesmas regras.
 *
 * **O motivo da extração não é reuso, é divergência.** Escape de CSV errado
 * falha em silêncio: a planilha abre, com as colunas deslocadas a partir da
 * linha ruim. Duas cópias da regra em dois arquivos concordam no dia em que são
 * escritas e param de concordar sem ninguém perceber — e o sintoma aparece num
 * arquivo que o cliente abriu, não num teste.
 */

/**
 * Escapa um campo.
 *
 * Aspas, ponto e vírgula e quebra de linha dentro do valor quebram o arquivo.
 * Nome de empresa com aspas não é caso raro.
 */
export function csvCampo(valor: string): string {
  if (!/[";\r\n]/.test(valor)) return valor;
  return `"${valor.replace(/"/g, '""')}"`;
}

/**
 * Monta o arquivo: BOM, separador ponto e vírgula, quebra CRLF.
 *
 * O Excel em português abre CSV assumindo `;` e latin-1. Sem o BOM, acento vira
 * caractere quebrado; com vírgula, tudo cai numa coluna só. Os dois detalhes
 * decidem se o arquivo é útil ou se a pessoa desiste na primeira tentativa — e
 * o público deste produto abre planilha no Excel, não no pandas.
 */
export function montarCsv(cabecalho: string[], linhas: string[][]): string {
  return (
    '﻿' +
    [cabecalho, ...linhas].map((linha) => linha.map(csvCampo).join(';')).join('\r\n')
  );
}
