import { Prisma } from '@prisma/client';

/**
 * Trata erro de limpeza de `afterAll` — em voz alta.
 *
 * ---
 *
 * **O que havia aqui antes: `.catch(() => {})`, dezenove vezes, em oito
 * arquivos.**
 *
 * O motivo original era bom: limpeza que estoura nao pode mascarar o resultado
 * do teste, e `tenant.delete` de tenant que nunca chegou a existir estoura
 * mesmo — quando o `beforeAll` morreu antes de cria-lo, ou quando um cascade ja
 * o levou.
 *
 * **O preco apareceu em 08/09/2026.** Um `deleteMany` travou em deadlock, a
 * limpeza morreu, o tenant ficou no banco — e a suite passou verde. Quem
 * reprovou foi o `business-invariants`, tres suites depois, com "lead sem
 * score": mensagem correta, causa a quilometros. Foram duas execucoes
 * vermelhas, uma investigacao e um `pnpm db:reset` para descobrir que o
 * problema era limpeza de outro arquivo.
 *
 * **Limpeza que falha em silencio nao protege o teste, adia a conta.** E ela
 * chega em nome de outro.
 *
 * ---
 *
 * **A regra, e por que ela nao e nenhum dos dois extremos:**
 *
 * - `P2025` (registro inexistente) → silencio. **E exatamente o caso que o
 *   `.catch(() => {})` existia para cobrir**, e continua coberto: nao ha o que
 *   apagar, nao ha sujeira, nao ha o que dizer.
 * - Qualquer outro erro → grita e relanca. Deadlock, violacao de chave
 *   estrangeira, conexao caida: os tres deixam lixo no banco, e lixo no banco
 *   torna nao confiavel **toda suite seguinte**. Falhar aqui e falhar na causa.
 *
 * O `deleteMany` nao entra na primeira categoria por acidente: ele nao lanca
 * quando nao encontra nada, entao so chega aqui por erro de verdade.
 *
 * ---
 *
 * **Uso — substituicao direta, mesma forma da linha antiga:**
 *
 * ```ts
 * await admin.tenant.delete({ where: { id: tenantA } }).catch(aoLimpar('tenant A'));
 * ```
 *
 * O rotulo aparece na mensagem. Vale a pena ser especifico: quem le o log
 * quer saber *qual* limpeza morreu, nao que "uma" morreu.
 */
export function aoLimpar(rotulo: string): (erro: unknown) => void {
  return (erro: unknown) => {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') {
      return;
    }

    console.error(
      `[limpeza] FALHOU: ${rotulo}. O banco fica sujo, e a proxima suite a ` +
        'reprovar provavelmente sera outra, por um motivo que nao parece ter ' +
        'relacao com esta. Se o erro abaixo for "deadlock detected", veja ' +
        'apps/api/test/fila.ts.',
      erro,
    );

    throw erro;
  };
}
