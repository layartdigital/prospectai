import { Prisma, type PrismaClient } from '@prisma/client';

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

/**
 * Confere que a suite nao deixou nada para tras.
 *
 * ---
 *
 * **O `aoLimpar` acima cobre metade do problema, e 09/09/2026 mostrou a outra.**
 *
 * Ele grita quando a limpeza **erra**. Nao grita quando a limpeza **nao acha** —
 * e `deleteMany` que casa zero linhas e sucesso para o Prisma.
 *
 * Foi assim que a execucao #7 do CI reprovou, em 08/09: a suite de auditoria
 * passou, deixou dois leads para tras (`Negocio com-site`, `Negocio sem-site`),
 * e quem acusou foi o `business-invariants`, treze suites depois, com uma
 * mensagem sobre a regra 5.4 que nao menciona limpeza nenhuma. A limpeza nao
 * estourou — se tivesse, a suite teria falhado. Ela rodou, nao errou, e nao
 * casou com aquelas linhas.
 *
 * **Contar quantas linhas foram apagadas nao resolve**, porque o numero
 * esperado varia com o que cada suite criou e com o que ja caiu por cascade.
 * A pergunta que tem uma resposta so e outra: **"sobrou algo meu?"** — e a
 * resposta certa e sempre nao.
 *
 * O sufixo de tempo que toda suite gera (`Date.now().toString(36)`) e o que
 * torna isso possivel: ele aparece no nome ou no slug de todo tenant, no e-mail
 * dos usuarios e no nome dos leads. E a assinatura da execucao.
 *
 * ---
 *
 * **Devolve o relato em vez de lancar, e isso e de proposito.**
 *
 * Lancar aqui pularia o `$disconnect()` e o `app.close()` que vem depois na
 * maioria dos `afterAll`, e conexao viva no fim da suite e o "Jest did not exit"
 * que custou meia sessao em 09/09. O chamador fecha o que tem que fechar e
 * lanca por ultimo:
 *
 * ```ts
 * const sobras = await conferirLimpeza(admin, sufixo);
 * await admin.$disconnect();
 * await app.close();
 * if (sobras !== null) throw new Error(sobras);
 * ```
 *
 * **Quem reprova passa a ser a suite dona da sujeira**, e nao um invariante
 * global tres arquivos adiante.
 */
export async function conferirLimpeza(
  cliente: PrismaClient,
  sufixo: string,
): Promise<string | null> {
  const [tenants, leads, usuarios] = await Promise.all([
    cliente.tenant.findMany({
      where: { OR: [{ name: { contains: sufixo } }, { slug: { contains: sufixo } }] },
      select: { slug: true },
      take: 10,
    }),
    cliente.lead.findMany({
      where: { name: { contains: sufixo } },
      select: { name: true },
      take: 10,
    }),
    cliente.user.findMany({
      where: { email: { contains: sufixo } },
      select: { email: true },
      take: 10,
    }),
  ]);

  const sobras: string[] = [];
  if (tenants.length > 0) sobras.push(`tenants: ${tenants.map((t) => t.slug).join(', ')}`);
  if (leads.length > 0) sobras.push(`leads: ${leads.map((l) => l.name).join(', ')}`);
  if (usuarios.length > 0) sobras.push(`usuarios: ${usuarios.map((u) => u.email).join(', ')}`);

  if (sobras.length === 0) return null;

  return (
    `[limpeza] A suite terminou e deixou linhas com o sufixo ${sufixo}:\n` +
    sobras.map((s) => `  - ${s}`).join('\n') +
    '\n\nA limpeza do afterAll rodou sem erro e nao alcancou estas linhas. ' +
    'Sujeira no banco torna nao confiavel toda suite seguinte, e quem costuma ' +
    'acusar e o business-invariants, longe daqui. Ver apps/api/test/limpeza.ts.'
  );
}
