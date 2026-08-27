import { lookup } from 'node:dns/promises';

import type {
  SiteAuditInput,
  SiteAuditProvider,
  SiteAuditResult,
  SiteCheckResult,
} from '@propectai/types';
import { AUDIT_VERSION } from '@propectai/types';

import {
  buscar,
  ORCAMENTO_JOB_MS,
  type ResultadoBusca,
  type Transporte,
} from '../../egress/fetcher';
import type { EnderecoResolvido, Resolvedor } from '../../egress/guard';
import { criarTransporte } from '../../egress/transporte';

/**
 * Auditoria de presenca digital, medida por nos.
 *
 * Quatro checagens, e todas saem de no maximo duas sondas HTTP. Nenhum byte da
 * pagina e guardado: o que persiste sao codigos de status, saltos e codigos de
 * erro. O corpo e lido apenas porque o `fetcher` precisa terminar a resposta —
 * e descartado em seguida.
 *
 * **A sonda comeca sempre em `http://`, mesmo quando o cadastro diz `https://`.**
 * O esquema gravado em `Lead.website` e uma afirmacao de quem cadastrou, nao uma
 * medicao — e substituir afirmacao por medicao e o proposito inteiro deste
 * arquivo. Comecar em http mede de graca a coisa mais vendavel do conjunto: se o
 * site forca a subida para https ou aceita trafego em claro.
 */

const TETO_SONDA_MS = 10_000;

/**
 * Recusas da tabela de faixas — dominio que existe e aponta para dentro.
 *
 * Listado, e nao detectado por prefixo do nome: os motivos sao `LOOPBACK`,
 * `PRIVADO`, `CGNAT` e companhia, sem prefixo comum. A primeira versao deste
 * arquivo testava `startsWith('IP_')` e nunca casava com nada — um `if` morto
 * que teria classificado todo dominio apontado para a rede interna como
 * simplesmente inalcancavel.
 *
 * A distincao importa porque as duas coisas geram conversas opostas: "seu
 * dominio nao existe" e um achado para o cliente; "seu dominio aponta para
 * 10.0.0.5" e um alerta para nos.
 */
const FAIXA_BLOQUEADA: ReadonlySet<string> = new Set([
  'LOOPBACK',
  'PRIVADO',
  'LINK_LOCAL',
  'METADADOS_CLOUD',
  'CGNAT',
  'RESERVADO',
  'MULTICAST',
  'BROADCAST',
  'IPV6_ULA',
  'IPV6_TRANSICAO',
  'ZONA_EXPLICITA',
]);

interface Sonda {
  readonly url: string;
  readonly resultado: ResultadoBusca;
}

/**
 * O que o codigo de status diz sobre o site — e o que ele nao diz.
 *
 * A primeira versao nao olhava para o status. Um site respondendo **500 em
 * todas as paginas** passava nas quatro checagens, e o relatorio entregue ao
 * prospect dizia que a presenca digital dele estava saudavel. O buraco era no
 * conjunto, nao num `if`: nenhuma outra checagem pegaria isso.
 *
 * **A parte dificil e o 4xx, e a regra 4 e quem decide.** O nosso `User-Agent`
 * se identifica como bot, e WAF de site pequeno responde 403 a bot o tempo
 * todo. Chamar isso de "site fora do ar" seria falso negativo — exatamente o
 * que a regra 4 existe para impedir: *"ausencia de sinal e DESCONHECIDO, nunca
 * AUSENTE"*. Nao medimos o site; medimos uma recusa a ser medido.
 *
 * `SKIPPED` e o estado do enum que carrega a propriedade que importa — nao
 * pontua. A distincao entre "nao tentamos" e "tentamos e nao deu para saber"
 * fica no `errorCode`, que e codigo estavel por desenho.
 */
type ClasseResposta = 'SERVIU' | 'INCONCLUSIVA' | 'QUEBRADA';

function classificar(status: number): ClasseResposta {
  if (status >= 200 && status < 300) return 'SERVIU';
  if (status >= 500) return 'QUEBRADA';
  // 4xx na pratica. 1xx e 3xx nao chegam aqui: o `fetcher` segue o redirect e
  // devolve `REDIRECT_DEMAIS` como falha quando estoura.
  return 'INCONCLUSIVA';
}

export interface OpcoesAuditoriaNativa {
  /** Injetaveis para teste. Em producao, DNS e socket de verdade. */
  readonly resolver?: Resolvedor;
  readonly transporte?: Transporte;
  readonly agora?: () => number;
}

/**
 * Resolvedor de producao.
 *
 * `all: true` porque o `guard` valida **todos** os enderecos, nao o primeiro —
 * uma resposta que mistura IP publico e privado e ataque, e pegar so o primeiro
 * deixaria o segundo alcancavel.
 */
async function resolverReal(hostname: string): Promise<EnderecoResolvido[]> {
  const enderecos = await lookup(hostname, { all: true, verbatim: true });
  return enderecos.map((e) => ({
    address: e.address,
    family: e.family === 6 ? 6 : 4,
  }));
}

/**
 * Tira a query antes de guardar. Ver a nota em `SiteCheckResult.observedUrl`:
 * site de captura poe dado pessoal ali, e o §3 proibe que isso entre.
 */
function semQuery(bruta: string): string | null {
  try {
    const u = new URL(bruta);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * `Lead.website` vem do Google Maps, entao vem de tudo: com esquema, sem
 * esquema, com espaco sobrando, e as vezes nao vem URL nenhuma.
 */
function normalizar(bruto: string): { hostname: string; caminho: string } | null {
  const limpo = bruto.trim();
  if (limpo === '') return null;
  const comEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(limpo) ? limpo : `http://${limpo}`;
  try {
    const u = new URL(comEsquema);
    if (u.hostname === '') return null;
    return { hostname: u.host, caminho: u.pathname + u.search };
  } catch {
    return null;
  }
}

export class NativeSiteAuditProvider implements SiteAuditProvider {
  readonly name = 'native';

  private readonly resolver: Resolvedor;
  private readonly transporte: Transporte;
  private readonly agora: () => number;

  constructor(opcoes: OpcoesAuditoriaNativa = {}) {
    this.resolver = opcoes.resolver ?? resolverReal;
    this.transporte = opcoes.transporte ?? criarTransporte();
    this.agora = opcoes.agora ?? ((): number => Date.now());
  }

  async auditar(entrada: SiteAuditInput): Promise<SiteAuditResult> {
    const inicio = this.agora();
    const orcamento = entrada.orcamentoMs ?? ORCAMENTO_JOB_MS;
    const observedAt = new Date(inicio).toISOString();

    const alvo = normalizar(entrada.website);
    if (alvo === null) {
      // Nao ha o que medir. E falha nossa apenas no sentido de que a auditoria
      // nunca deveria ter sido enfileirada — quem pede confere antes.
      return {
        auditVersion: AUDIT_VERSION,
        status: 'FAILED',
        checks: [],
        durationMs: this.agora() - inicio,
        errorCode: 'WEBSITE_INVALIDO',
      };
    }

    const restante = (): number => orcamento - (this.agora() - inicio);

    // Sonda 1: http. Mede alcance na 80 e a cadeia de redirect de uma vez.
    const sondaHttp = await this.sondar(`http://${alvo.hostname}${alvo.caminho}`, restante());

    // Sonda 2: https, **so se a primeira nao terminou em https**. Site moderno
    // sobe sozinho e paga uma requisicao; site sem https paga duas, e a segunda
    // e justamente a que produz o achado.
    const subiu = sondaHttp.resultado.ok && sondaHttp.resultado.urlFinal.startsWith('https://');
    const sondaHttps = subiu
      ? null
      : restante() > 0
        ? await this.sondar(`https://${alvo.hostname}${alvo.caminho}`, restante())
        : null;

    const checks = this.avaliar(alvo.hostname, sondaHttp, sondaHttps, observedAt);
    const estourou = restante() <= 0;

    return {
      auditVersion: AUDIT_VERSION,
      // **`PARTIAL` e falta de tempo, nao reprovacao.** Site que reprova em
      // tudo produz auditoria `COMPLETED` — nos medimos, e a medicao e o
      // produto.
      status: estourou && checks.some((c) => c.outcome === 'SKIPPED') ? 'PARTIAL' : 'COMPLETED',
      checks,
      durationMs: this.agora() - inicio,
      errorCode: null,
    };
  }

  private async sondar(url: string, restanteMs: number): Promise<Sonda> {
    const resultado = await buscar(url, {
      resolver: this.resolver,
      transporte: this.transporte,
      agora: this.agora,
      orcamentoMs: Math.max(0, Math.min(TETO_SONDA_MS, restanteMs)),
    });
    return { url, resultado };
  }

  private avaliar(
    hostname: string,
    http: Sonda,
    https: Sonda | null,
    observedAt: string,
  ): SiteCheckResult[] {
    const base = { observedAt, confidence: null };

    // Um unico motivo de recusa prova que o nome nao resolveu para nada
    // utilizavel. `DNS_SEM_RESPOSTA` e `DNS_FALHOU` significam que o dominio
    // nao existe ou nao responde — achado forte. As faixas bloqueadas sao
    // outra coisa: o dominio existe e aponta para dentro, o que e recusa nossa
    // e nao ausencia dele.
    const motivos = [http, https]
      .filter((s): s is Sonda => s !== null)
      .map((s) => (s.resultado.ok ? null : s.resultado.motivo));
    const semDns = motivos.every((m) => m === 'DNS_SEM_RESPOSTA' || m === 'DNS_FALHOU');
    const bloqueado = motivos.some((m) => m !== null && FAIXA_BLOQUEADA.has(m));

    const dns: SiteCheckResult = {
      ...base,
      check: 'DNS',
      outcome: semDns ? 'FAILED' : 'OK',
      observedUrl: null,
      result: { hostname },
      errorCode: semDns ? 'NAO_RESOLVE' : bloqueado ? 'DESTINO_BLOQUEADO' : null,
    };

    // Sem DNS nao ha o que alcancar. Os tres seguintes ficam SKIPPED — e a
    // auditoria continua COMPLETED, porque a resposta "esse dominio nao existe"
    // e a medicao, nao a falta dela.
    if (semDns) {
      const pulado = (check: SiteCheckResult['check']): SiteCheckResult => ({
        ...base,
        check,
        outcome: 'SKIPPED',
        observedUrl: null,
        result: null,
        errorCode: 'SEM_DNS',
      });
      return [dns, pulado('HTTP_REACHABLE'), pulado('HTTPS'), pulado('REDIRECT_CHAIN')];
    }

    const qualquer = http.resultado.ok ? http : https?.resultado.ok ? https : null;

    const statusFinal = qualquer?.resultado.ok === true ? qualquer.resultado.status : null;
    const classe = statusFinal === null ? null : classificar(statusFinal);

    /**
     * **A porta 80 atendeu?** — e nao "a cadeia inteira deu certo".
     *
     * `saltos` na falha e o indice do salto onde ela ocorreu, entao qualquer
     * valor maior que zero prova que o primeiro salto **recebeu resposta** e
     * mandou seguir adiante.
     *
     * O smoke test contra `expired.badssl.com` mostrou a diferenca: a porta 80
     * respondeu e redirecionou, o certificado do destino e que estava vencido —
     * e o campo saia `porta80: false`, afirmando que o site nao atende em 80.
     * Dado falso gravado, da mesma familia do `forcaHttps: false` corrigido
     * horas antes: **afirmar o contrario do que se observou e pior que nao
     * afirmar nada.**
     */
    const porta80 = http.resultado.ok || http.resultado.saltos >= 1;

    /**
     * Redirect que leva a um destino quebrado nao e "site inalcancavel".
     *
     * Sem isto, `HTTP_REACHABLE` e `HTTPS` saiam com o **mesmo** `errorCode` —
     * o relatorio contaria a mesma causa duas vezes com rotulos diferentes. A
     * historia verdadeira tem duas partes: a porta 80 funciona e manda para
     * https; o https e que esta quebrado. Cada checagem conta a sua.
     */
    const quebrouDepoisDoSalto = !http.resultado.ok && http.resultado.saltos >= 1;

    const alcance: SiteCheckResult = {
      ...base,
      check: 'HTTP_REACHABLE',
      outcome:
        classe === 'SERVIU'
          ? 'OK'
          : classe === 'QUEBRADA'
            ? 'FAILED'
            : classe === 'INCONCLUSIVA'
              ? 'SKIPPED'
              : 'FAILED',
      observedUrl: qualquer?.resultado.ok === true ? semQuery(qualquer.resultado.urlFinal) : null,
      // O status vai para o `result` em **todos** os desfechos, inclusive nos
      // que reprovam. A classificacao acima e um palpite sobre o mundo real —
      // quantos 403 sao WAF e quantos sao site quebrado so o dado dira. Guardar
      // o numero e o que permite rever a regra com evidencia em vez de opiniao.
      result: statusFinal === null ? { porta80 } : { status: statusFinal, porta80 },
      errorCode:
        classe === 'SERVIU'
          ? null
          : classe === 'QUEBRADA'
            ? 'ERRO_DO_SERVIDOR'
            : classe === 'INCONCLUSIVA'
              ? 'RESPOSTA_NAO_CONCLUSIVA'
              : quebrouDepoisDoSalto
                ? 'REDIRECT_PARA_DESTINO_QUEBRADO'
                : this.codigo(http),
    };

    // O final da cadeia e o que vale: se a sonda http subiu para https, o https
    // esta provado sem segunda requisicao. `buscar()` so devolve `ok` depois de
    // o TLS validar, porque o transporte usa `rejectUnauthorized`.
    const finalHttps =
      (http.resultado.ok && http.resultado.urlFinal.startsWith('https://')) ||
      (https?.resultado.ok === true && https.resultado.urlFinal.startsWith('https://'));

    const sondaTls = http.resultado.ok && http.resultado.urlFinal.startsWith('https://') ? http : https;

    const tls: SiteCheckResult = {
      ...base,
      check: 'HTTPS',
      outcome: finalHttps ? 'OK' : 'FAILED',
      observedUrl:
        finalHttps && sondaTls?.resultado.ok === true ? semQuery(sondaTls.resultado.urlFinal) : null,
      result: { certificadoValido: finalHttps },
      // Aqui o `detalhe` do `fetcher` vira produto: `TLS_CERTIFICADO_EXPIRADO`
      // e um achado que se vende; `CONEXAO_RECUSADA` e so uma ausencia.
      errorCode: finalHttps ? null : sondaTls !== null ? this.codigo(sondaTls) : 'SEM_HTTPS',
    };

    // Salto observado continua sendo salto observado quando a cadeia falha
    // depois. Zerar aqui apagaria a unica coisa que a sonda chegou a medir —
    // `expired.badssl.com` redireciona, e o resultado dizia `saltos: 0`.
    const saltos = http.resultado.ok
      ? http.resultado.saltos
      : http.resultado.saltos >= 1
        ? http.resultado.saltos
        : https?.resultado.ok === true
          ? https.resultado.saltos
          : 0;

    // A medicao que substitui o `raw.startsWith('https://')` do `normalize.ts`:
    // nao "o cadastro diz https", e sim "a porta 80 manda para https".
    const forcaHttps = http.resultado.ok && http.resultado.urlFinal.startsWith('https://');
    const classeHttp = http.resultado.ok ? classificar(http.resultado.status) : null;

    /**
     * **`forcaHttps: false` so vale quando a sonda http foi conclusiva.**
     *
     * O smoke test contra alvo publico mostrou o problema em uma linha: um
     * dominio que sobe para https no mundo real saiu com `forcaHttps: false`
     * porque a resposta veio de um intermediario, sem redirect. Registrar
     * "false" ali afirma que o site aceita trafego em claro — um achado
     * inventado, sobre uma sonda que nao chegou ao site.
     *
     * O `true` nao tem esse problema: se o redirect foi observado, ele
     * aconteceu, e o status final nao muda isso.
     */
    const cadeiaConclusiva = forcaHttps || classeHttp === 'SERVIU';

    const cadeia: SiteCheckResult = {
      ...base,
      check: 'REDIRECT_CHAIN',
      outcome: qualquer === null ? 'SKIPPED' : cadeiaConclusiva ? 'OK' : 'SKIPPED',
      observedUrl: qualquer?.resultado.ok === true ? semQuery(qualquer.resultado.urlFinal) : null,
      result: cadeiaConclusiva ? { saltos, forcaHttps } : { saltos },
      errorCode:
        qualquer === null
          ? 'SEM_RESPOSTA'
          : cadeiaConclusiva
            ? null
            : 'SONDA_HTTP_NAO_CONCLUSIVA',
    };

    return [dns, alcance, tls, cadeia];
  }

  /** O `detalhe` quando existe; o motivo uniforme quando nao. */
  private codigo(sonda: Sonda): string | null {
    if (sonda.resultado.ok) return null;
    return sonda.resultado.detalhe ?? sonda.resultado.motivo;
  }
}
