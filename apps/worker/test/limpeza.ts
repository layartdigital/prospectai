import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Limpeza de `afterAll` do worker — em voz alta, e conferida.
 *
 * ---
 *
 * **Por que este arquivo existe, se `apps/api/test/limpeza.ts` ja existe.**
 *
 * O `aoLimpar` abaixo e o mesmo, e a razao de ser dele esta escrita la, com as
 * duas datas que a produziram (08 e 09/09/2026). Nao repito aqui: uma copia da
 * prosa diverge da original no primeiro conserto que so um dos dois lados
 * receber, e ai passam a existir duas versoes do mesmo motivo.
 *
 * O `conferirLimpeza`, esse **nao** e copia — e a diferenca e o que justifica o
 * arquivo proprio. Alem de tenants, leads e usuarios, ele confere `segments` e
 * `segment_locales`, que **so as suites do worker criam** e que sao **globais,
 * nao por tenant**: um `SegmentLocale` tem escopo de pais. Sobra ali nao
 * contamina uma suite, contamina qualquer suite de qualquer app que leia
 * taxonomia — e o `scrape-pipeline` promove e rebaixa termos de verdade.
 *
 * A alternativa seria importar de `apps/api/test`, e ela foi recusada: um teste
 * do worker nao deve depender da arvore de testes de outro app para rodar. O
 * `prisma-admin.ts` ja vive duplicado nos dois diretorios pela mesma razao.
 *
 * ---
 *
 * **A regra, identica a da API:**
 *
 * - `P2025` (registro inexistente) → silencio. E o caso que o
 *   `.catch(() => {})` existia para cobrir, e continua coberto.
 * - Qualquer outro erro → grita e relanca. Deadlock, violacao de chave,
 *   conexao caida: os tres deixam lixo, e lixo torna nao confiavel **toda
 *   suite seguinte**.
 *
 * ```ts
 * await admin.tenant.delete({ where: { id: tenantA } }).catch(aoLimpar('tenant A'));
 * ```
 */
export function aoLimpar(rotulo: string): (erro: unknown) => void {
  return (erro: unknown) => {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') {
      return;
    }

    console.error(
      `[limpeza] FALHOU: ${rotulo}. O banco fica sujo, e a proxima suite a ` +
        'reprovar provavelmente sera outra, por um motivo que nao parece ter ' +
        'relacao com esta. Ver apps/api/test/limpeza.ts para as duas ocorrencias ' +
        'que produziram esta regra.',
      erro,
    );

    throw erro;
  };
}

/**
 * Confere que a suite nao deixou nada para tras.
 *
 * O `aoLimpar` grita quando a limpeza **erra**. Nao grita quando a limpeza
 * **nao acha** — e `deleteMany` que casa zero linhas e sucesso para o Prisma.
 * Foi assim que o `team-rules` da API passou meses deixando usuarios no banco:
 * a limpeza rodava, nao errava, e filtrava por um dominio de e-mail que so um
 * dos dois caminhos de criacao usava.
 *
 * A pergunta que tem uma resposta so e **"sobrou algo meu?"**, e a resposta
 * certa e sempre nao. O sufixo de execucao (`Date.now().toString(36)`) e o que
 * torna isso possivel: ele aparece no nome e no slug do tenant, no nome dos
 * leads, no nome do segmento e no codigo do locale.
 *
 * ---
 *
 * **Devolve o relato em vez de lancar.** Lancar aqui pularia os
 * `$disconnect()` que vem depois no `afterAll`, e conexao viva no fim da suite
 * e o "Jest did not exit" — no worker, o vitest trava igual. O chamador fecha
 * o que tem que fechar e lanca por ultimo:
 *
 * ```ts
 * const sobras = await conferirLimpeza(admin, sufixo);
 * await Promise.all([admin.$disconnect(), app.$disconnect()]);
 * if (sobras !== null) throw new Error(sobras);
 * ```
 */
export async function conferirLimpeza(
  cliente: PrismaClient,
  sufixo: string,
): Promise<string | null> {
  const [tenants, leads, usuarios, segmentos, locales] = await Promise.all([
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
    // Globais. Nao caem por cascade de tenant nenhum, porque nao pertencem a
    // tenant nenhum — e e exatamente por isso que sobra aqui e pior.
    cliente.segment.findMany({
      where: { name: { contains: sufixo } },
      select: { name: true },
      take: 10,
    }),
    cliente.segmentLocale.findMany({
      where: { locale: { contains: sufixo } },
      select: { locale: true, status: true },
      take: 10,
    }),
  ]);

  const sobras: string[] = [];
  if (tenants.length > 0) sobras.push(`tenants: ${tenants.map((t) => t.slug).join(', ')}`);
  if (leads.length > 0) sobras.push(`leads: ${leads.map((l) => l.name).join(', ')}`);
  if (usuarios.length > 0) sobras.push(`usuarios: ${usuarios.map((u) => u.email).join(', ')}`);
  if (segmentos.length > 0) {
    sobras.push(`segmentos (GLOBAIS): ${segmentos.map((s) => s.name).join(', ')}`);
  }
  if (locales.length > 0) {
    sobras.push(
      `locales (GLOBAIS): ${locales.map((l) => `${l.locale}=${l.status}`).join(', ')}`,
    );
  }

  if (sobras.length === 0) return null;

  return (
    `[limpeza] A suite terminou e deixou linhas com o sufixo ${sufixo}:\n` +
    sobras.map((s) => `  - ${s}`).join('\n') +
    '\n\nA limpeza do afterAll rodou sem erro e nao alcancou estas linhas. ' +
    'O que esta marcado como GLOBAL nao pertence a tenant nenhum: nao cai por ' +
    'cascade, e afeta qualquer suite que leia taxonomia. ' +
    'Ver apps/worker/test/limpeza.ts.'
  );
}
