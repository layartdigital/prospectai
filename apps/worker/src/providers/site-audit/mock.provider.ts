import type {
  SiteAuditInput,
  SiteAuditProvider,
  SiteAuditResult,
  SiteCheckResult,
} from '@propectai/types';
import { AUDIT_VERSION } from '@propectai/types';

/**
 * Auditoria de teste.
 *
 * Existe pelo mesmo motivo que o `MockLeadSourceProvider`: o ciclo completo —
 * fila, cota, persistencia, tela, relatorio — precisa ser exercitavel sem
 * depender da internet. E o provider padrao ate a checagem nativa estar
 * comprovada contra alvo publico; so entao `SITE_AUDIT_PROVIDER` passa para
 * `native`.
 *
 * **Nao sorteia.** O resultado sai do proprio hostname, entao o mesmo lead
 * produz sempre a mesma auditoria — do contrario a tela piscaria a cada
 * recarga e nenhum teste de ponta a ponta poderia afirmar nada.
 */

/**
 * Mesma normalizacao do provider nativo.
 *
 * **O mock precisa produzir a MESMA forma que o nativo, nao so o mesmo tipo.**
 * A primeira versao gravava a URL inteira num campo chamado `hostname`, e o
 * nativo grava so o host. So apareceu quando os dois rodaram lado a lado numa
 * auditoria de verdade: qualquer tela construida sobre o mock mostraria
 * `https://exemplo.com.br` num campo que promete `exemplo.com.br`, e quebraria
 * na troca para o nativo.
 *
 * Mock que diverge do real nao e um dublê — e uma segunda implementacao errada.
 */
function normalizar(bruto: string): { host: string; url: string } | null {
  const limpo = bruto.trim();
  if (limpo === '') return null;
  const comEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(limpo) ? limpo : `http://${limpo}`;
  try {
    const u = new URL(comEsquema);
    if (u.hostname === '') return null;
    return { host: u.host, url: `${u.origin}${u.pathname}` };
  } catch {
    return null;
  }
}

function somaDoNome(texto: string): number {
  let soma = 0;
  for (let i = 0; i < texto.length; i++) soma = (soma * 31 + texto.charCodeAt(i)) >>> 0;
  return soma;
}

export class MockSiteAuditProvider implements SiteAuditProvider {
  readonly name = 'mock';

  async auditar(entrada: SiteAuditInput): Promise<SiteAuditResult> {
    const observedAt = new Date().toISOString();
    const base = { observedAt, confidence: null };

    const alvo = normalizar(entrada.website);
    if (alvo === null) {
      return {
        auditVersion: AUDIT_VERSION,
        status: 'FAILED',
        checks: [],
        durationMs: 1,
        errorCode: 'WEBSITE_INVALIDO',
      };
    }

    const semente = somaDoNome(alvo.host);
    const resolve = semente % 7 !== 0;
    const temHttps = resolve && semente % 3 !== 0;

    if (!resolve) {
      const pulado = (check: SiteCheckResult['check']): SiteCheckResult => ({
        ...base,
        check,
        outcome: 'SKIPPED',
        observedUrl: null,
        result: null,
        errorCode: 'SEM_DNS',
      });
      return {
        auditVersion: AUDIT_VERSION,
        status: 'COMPLETED',
        checks: [
          {
            ...base,
            check: 'DNS',
            outcome: 'FAILED',
            observedUrl: null,
            // O nativo grava `{ hostname }` mesmo quando reprova. Omitir aqui
            // faria o mock divergir de novo, so que no caminho de erro.
            result: { hostname: alvo.host },
            errorCode: 'NAO_RESOLVE',
          },
          pulado('HTTP_REACHABLE'),
          pulado('HTTPS'),
          pulado('REDIRECT_CHAIN'),
        ],
        durationMs: 120,
        errorCode: null,
      };
    }

    const finalUrl = temHttps
      ? alvo.url.replace(/^http:/, 'https:')
      : alvo.url;

    return {
      auditVersion: AUDIT_VERSION,
      status: 'COMPLETED',
      checks: [
        { ...base, check: 'DNS', outcome: 'OK', observedUrl: null, result: { hostname: alvo.host }, errorCode: null },
        {
          ...base,
          check: 'HTTP_REACHABLE',
          outcome: 'OK',
          observedUrl: finalUrl,
          result: { status: 200, porta80: true },
          errorCode: null,
        },
        {
          ...base,
          check: 'HTTPS',
          outcome: temHttps ? 'OK' : 'FAILED',
          observedUrl: temHttps ? finalUrl : null,
          result: { certificadoValido: temHttps },
          errorCode: temHttps ? null : 'SEM_HTTPS',
        },
        {
          ...base,
          check: 'REDIRECT_CHAIN',
          outcome: 'OK',
          observedUrl: finalUrl,
          result: { saltos: temHttps ? 1 : 0, forcaHttps: temHttps },
          errorCode: null,
        },
      ],
      durationMs: 340,
      errorCode: null,
    };
  }
}
