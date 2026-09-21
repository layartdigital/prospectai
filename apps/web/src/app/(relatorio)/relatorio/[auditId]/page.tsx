import type {
  AuditDetailView,
  LeadDetail,
  LinhaDoRelatorio,
  RecusaDoRelatorio,
} from '@propectai/types';
import { montarRelatorio, recusaDoRelatorio } from '@propectai/types';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BotaoImprimir } from '@/components/relatorio/botao-imprimir';
import { ServerApiError, serverApi } from '@/lib/server-api';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Diagnóstico de presença digital' };

/**
 * O relatório entregável.
 *
 * Esta página é o primeiro artefato do sistema feito para ser lido por quem não
 * tem conta nele. Tudo aqui decorre disso.
 *
 * **O que ela não faz, e por quê:**
 *
 * - **Não mostra o score.** `NO_WEBSITE` vale 30 pontos porque, para nós, lead
 *   sem site é oportunidade. Num documento entregue ao dono do negócio o mesmo
 *   número vira uma nota dizendo que não ter site é o melhor caso. O score é
 *   vocabulário interno de priorização comercial e não sobrevive à tradução.
 * - **Não termina em proposta.** A decisão é do dono do projeto e está no
 *   `RELATORIO-DIAGNOSTICO-v1.md`: o documento **termina na medição**. Um
 *   "fale conosco" no fim transforma o laudo em peça de venda e joga fora a
 *   credibilidade que as três seções custaram a construir.
 * - **Não renderiza medição simulada.** Ver a recusa abaixo.
 *
 * As frases vêm todas de `traduzirChecagem`, em `@propectai/types` — nenhum
 * texto sobre o que foi medido nasce nesta página. É o que permite que a regra
 * 4 seja testada num teste unitário em vez de num navegador.
 */

/**
 * O que a tela diz no lugar do documento, uma entrada por motivo.
 *
 * `Record` exaustivo de propósito: um motivo novo em `RecusaDoRelatorio` não
 * compila até alguém escrever o texto dele — melhor que cair num genérico que
 * promete a coisa errada, que foi o defeito do `CANCELLED` na primeira versão.
 */
const TEXTO_DA_RECUSA: Record<RecusaDoRelatorio, { titulo: string; texto: string }> = {
  FALHOU: {
    titulo: 'Esta verificação não chegou a medir o site.',
    texto:
      'A falha foi nossa, não do site auditado — e por isso não há relatório a ' +
      'emitir. O crédito volta para o saldo do mês. Peça a verificação de novo ' +
      'na ficha do lead.',
  },
  CANCELADA: {
    titulo: 'Esta verificação foi cancelada.',
    texto:
      'Não há medição para relatar. Se ainda quiser o diagnóstico, peça uma ' +
      'verificação nova na ficha do lead.',
  },
  EM_ANDAMENTO: {
    titulo: 'Esta verificação ainda não terminou.',
    texto: 'O relatório aparece aqui assim que a medição concluir.',
  },
  SIMULADA: {
    titulo: 'Esta medição não é real, e por isso não vira relatório.',
    texto:
      'Ela foi produzida pelo provedor de simulação, usado em ambiente de ' +
      'desenvolvimento. Um documento entregável não pode carregar número ' +
      'simulado: fora da tela não há como distinguir um do outro.',
  },
};


export default async function RelatorioPage({
  params,
}: {
  params: Promise<{ auditId: string }>;
}) {
  const { auditId } = await params;

  let audit: AuditDetailView;
  try {
    audit = await serverApi<AuditDetailView>(`/audits/${auditId}`);
  } catch (error) {
    if (error instanceof ServerApiError && error.statusCode === 404) notFound();
    throw error;
  }

  let lead: LeadDetail;
  try {
    lead = await serverApi<LeadDetail>(`/leads/${audit.leadId}`);
  } catch (error) {
    // Auditoria órfã: o lead saiu do acervo depois da medição. Não há cabeçalho
    // honesto a montar sem ele — o documento diz de quem é o site logo na
    // primeira linha.
    if (error instanceof ServerApiError && error.statusCode === 404) notFound();
    throw error;
  }

  const voltar = `/leads/${audit.leadId}`;

  /**
   * **A decisão de emitir vem de `recusaDoRelatorio`, e não desta página.**
   *
   * O card da ficha usa a mesma função para decidir se mostra o link — duas
   * cópias da condição divergiriam no primeiro refactor. Ela é testada no
   * `@propectai/types` contra o produto cartesiano de estado × provedor.
   *
   * A recusa que mais importa é `SIMULADA`. `providerName` existe no schema
   * porque medido e inventado já ficaram indistinguíveis três vezes neste
   * projeto. Em tela interna um selo "simulada" resolve — o operador sabe ler.
   * Num documento que vai para outra empresa não resolve nada: o selo se perde
   * na impressão, no recorte, no encaminhamento. Aqui a única resposta segura é
   * não emitir.
   */
  const recusa = recusaDoRelatorio(audit);

  if (recusa !== null) {
    const { titulo, texto } = TEXTO_DA_RECUSA[recusa];
    return <Recusa voltar={voltar} titulo={titulo} texto={texto} />;
  }

  const endereco = enderecoObservado(audit, lead);

  if (endereco === null) {
    return (
      <Recusa
        voltar={voltar}
        titulo="Não há endereço para nomear no relatório."
        texto={
          'Nenhuma checagem registrou a URL observada e o lead está sem site ' +
          'cadastrado. As frases do diagnóstico nomeiam o endereço verificado, e ' +
          'emitir o documento sem ele seria afirmar algo sobre um alvo que não ' +
          'sabemos qual é.'
        }
      />
    );
  }

  // `montarRelatorio`, e não um `map` sobre `traduzirChecagem` aqui: há uma
  // regra que só existe no conjunto — certificado e redirect não entram como
  // "certo" quando a página não abriu — e ela precisa de teste unitário, que a
  // web não tem. A checagem viaja junto com cada item para servir de `key`.
  const itens = montarRelatorio(audit.checks, endereco);

  // O workspace ativo é o dono da auditoria — o RLS não deixaria ler uma de
  // outro. O layout já validou a sessão; aqui ela só fornece o nome.
  const session = await getSession();
  const assinatura = session?.tenant?.name ?? null;

  // A ordem é a que veio da API — `createdAt asc`, ou seja a ordem das sondas:
  // DNS, alcance, HTTPS, cadeia. Ela já é decrescente em gravidade por
  // construção, e reordenar aqui seria inventar um critério.
  const achados = itens.filter((p) => p.item.secao === 'ACHADO');
  const certos = itens.filter((p) => p.item.secao === 'CERTO');
  const naoVerificados = itens.filter((p) => p.item.secao === 'NAO_VERIFICADO');

  const local = [lead.address.city, lead.address.stateUf].filter(Boolean).join(' · ');

  return (
    <article className="mx-auto max-w-3xl px-5 py-8 print:py-0">
      <div className="pa-nao-imprime mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={voltar} className="text-xs text-muted hover:text-navy-900">
          ← Voltar para a ficha
        </Link>
        <BotaoImprimir />
      </div>

      <header className="border-b border-line pb-5">
        <p className="pa-label">Diagnóstico de presença digital</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy-900">{lead.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {endereco}
          {local === '' ? null : <> · {local}</>}
        </p>
        {lead.isDemo ? (
          /* Lead de demonstração é empresa inventada. A medição do site pode ser
             real; a empresa não é. Sem esta linha o documento sai idêntico ao de
             um prospecto de verdade. */
          <p className="mt-3 inline-block rounded-control border border-warning/40 bg-warning/5 px-3 py-1.5 text-[11px] font-semibold text-navy-900">
            Empresa de demonstração — este registro não corresponde a um negócio real.
          </p>
        ) : null}
      </header>

      {itens.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          A verificação terminou sem produzir itens para este relatório.
        </p>
      ) : (
        <>
          <Secao
            titulo="O que encontramos"
            descricao="Pontos observados no site que afetam quem tenta chegar até a empresa."
            icone={<AlertTriangle className="h-4 w-4 text-danger" aria-hidden="true" />}
            itens={achados}
            vazio={
              /**
               * **A primeira frase do documento não pode dizer mais do que foi
               * medido.**
               *
               * A versão anterior dizia sempre "Nenhum problema encontrado". O
               * primeiro relatório emitido com medição real — um subdomínio
               * `wixsite.com` — mostrou o defeito: a plataforma responde por
               * qualquer nome, então DNS, certificado e redirecionamento saíram
               * certos, e a única checagem que olhava a página em si não
               * concluiu. O documento abria com "nenhum problema" e só dizia,
               * três seções abaixo, que não sabia se o site abria.
               *
               * A frase era verdadeira e enganava. Quem lê um laudo para na
               * primeira linha.
               */
              naoVerificados.length > 0
                ? 'Nenhum problema encontrado no que foi possível verificar. Parte da verificação não pôde ser concluída — veja abaixo.'
                : 'Nenhum problema encontrado nas verificações desta lista.'
            }
          />

          <Secao
            titulo="O que está correto"
            descricao="Verificado e em ordem."
            icone={<CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
            itens={certos}
            vazio={null}
          />

          {/**
           * **A seção que torna o resto crível, e ela tem o mesmo peso visual
           * que as outras de propósito.**
           *
           * `CLAUDE.md` regra 4: ausência de sinal é DESCONHECIDO, nunca
           * AUSENTE. Num documento de venda a tentação é omitir esta parte,
           * porque ela não vende. É exatamente o contrário: um relatório que só
           * traz problemas parece peça de venda; um que diz o que não conseguiu
           * medir parece medição.
           */}
          <Secao
            titulo="O que não foi possível verificar"
            descricao="Limites da nossa verificação, e não defeitos do site."
            icone={<HelpCircle className="h-4 w-4 text-muted" aria-hidden="true" />}
            itens={naoVerificados}
            vazio={null}
          />
        </>
      )}

      <footer className="mt-10 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
        <p>
          Verificação automatizada do endereço {endereco}, realizada em{' '}
          {formatarDataHora(audit.finishedAt)}. Foram observados: se o endereço
          existe na internet, se o site abre, se há certificado de segurança
          válido e se quem digita o endereço sem <code>https</code> chega à
          versão protegida.
          {audit.status === 'PARTIAL'
            ? ' Parte das verificações não pôde ser concluída; elas estão listadas acima.'
            : null}{' '}
          Versão do verificador: {audit.auditVersion}.
        </p>
        {audit.retentionUntil === null ? null : (
          <p className="mt-2">
            As medições que originaram este documento ficam disponíveis no sistema
            até {formatarData(audit.retentionUntil)}. Este arquivo é a cópia que
            permanece com quem o recebeu.
          </p>
        )}
        {/**
         * **A assinatura é o nome de quem entrega, e não o do produto.**
         *
         * Decisão 3 de 18/09 no `RELATORIO-DIAGNOSTICO-v1.md` §6: `Tenant.name`,
         * em texto, sem logo e sem o nome da ferramenta. A primeira versão desta
         * página saiu sem assinatura nenhuma — o comentário que estava aqui
         * dizia que "o nome do produto ainda é uma decisão em aberto", o que é
         * verdade e responde a outra pergunta: a decisão tirou o produto e
         * **manteve** a agência. Sem assinatura o documento não é entregável:
         * quem for usar cola o conteúdo no próprio timbre.
         */}
        {assinatura === null ? null : (
          <p className="mt-4 text-xs font-semibold text-navy-900">{assinatura}</p>
        )}
      </footer>
    </article>
  );
}

/**
 * O endereço que o documento nomeia.
 *
 * **Prefere o que foi observado ao que está cadastrado**, e a diferença não é
 * teórica: o `Lead.website` pode ter sido editado depois da medição, e o
 * relatório afirmaria coisas sobre um endereço que nunca foi verificado. O
 * `observedUrl` é o registro do que a sonda realmente alcançou.
 */
function enderecoObservado(audit: AuditDetailView, lead: LeadDetail): string | null {
  const observada = audit.checks.find((c) => c.observedUrl !== null)?.observedUrl ?? null;
  const cru = observada ?? lead.website;

  if (cru === null) return null;

  try {
    return new URL(cru).hostname;
  } catch {
    // `Lead.website` vem da fonte sem esquema com frequência. Mostrar como veio
    // é melhor que engolir o endereço.
    return cru;
  }
}

function formatarDataHora(value: string | null): string {
  if (value === null) return 'data não registrada';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatarData(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(value));
}

function Secao({
  titulo,
  descricao,
  icone,
  itens,
  vazio,
}: {
  titulo: string;
  descricao: string;
  icone: React.ReactNode;
  itens: LinhaDoRelatorio[];
  /** Texto quando a seção está vazia. `null` esconde a seção inteira. */
  vazio: string | null;
}) {
  if (itens.length === 0 && vazio === null) return null;

  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 text-card-title text-navy-900">
        {icone}
        {titulo}
      </h2>
      <p className="mt-0.5 text-xs text-muted">{descricao}</p>

      {itens.length === 0 ? (
        <p className="mt-3 text-sm text-navy-900">{vazio}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {itens.map(({ check, item }) => (
            <li key={check} className="pa-item pa-card p-4">
              <p className="text-sm font-semibold leading-relaxed text-navy-900">
                {item.titulo}
              </p>
              {item.porQueImporta === null ? null : (
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {item.porQueImporta}
                </p>
              )}
              {item.oQueFazer === null ? null : (
                <p className="mt-2 text-xs leading-relaxed text-navy-900">
                  <span className="pa-label">O que fazer</span>
                  <br />
                  {item.oQueFazer}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A tela que aparece no lugar do relatório quando ele não deve existir.
 *
 * Deliberadamente sem nada do documento — nem cabeçalho, nem seções vazias.
 * Meio relatório é pior que nenhum: alguém imprime.
 */
function Recusa({
  voltar,
  titulo,
  texto,
}: {
  voltar: string;
  titulo: string;
  texto: string;
}) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-lg font-semibold text-navy-900">{titulo}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{texto}</p>
      <Link
        href={voltar}
        className="mt-6 inline-block rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white"
      >
        Voltar para a ficha
      </Link>
    </div>
  );
}
