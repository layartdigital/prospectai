/**
 * Gateway minimo do E2E em CI (P04-QA-04).
 *
 * Reproduz a topologia de producao em que o navegador fala com UMA origem:
 * `/api/*` vai para a API (NestJS) e o resto para o Next. Em producao quem faz
 * isso e o nginx do gateway; em `next dev` e o `rewrites()` do Next. Com
 * `next start` (build de producao) o Next nao tem rewrite de `/api` de
 * proposito (`next.config.mjs`), entao o E2E precisa de algo no lugar do nginx.
 *
 * Isto NAO e um servidor simulado: nao responde nada por conta propria. Cada
 * requisicao e repassada byte a byte (cabecalhos, cookies, corpo) para a
 * aplicacao real e a resposta volta intacta. Sem dependencias (so `node:http`),
 * para nao acrescentar pacote ao projeto.
 *
 * Variaveis: GATEWAY_PORT (3100), WEB_TARGET_PORT (3200), API_TARGET_PORT (3101).
 */
import http from 'node:http';

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 3100);
const WEB_PORT = Number(process.env.WEB_TARGET_PORT ?? 3200);
const API_PORT = Number(process.env.API_TARGET_PORT ?? 3101);
const HOST = '127.0.0.1';

const servidor = http.createServer((req, res) => {
  const url = req.url ?? '/';
  const paraApi = url === '/api' || url.startsWith('/api/');
  const porta = paraApi ? API_PORT : WEB_PORT;

  const headers = { ...req.headers };
  // Host original preservado: o Next monta redirecionamentos a partir dele.
  headers['x-forwarded-host'] = req.headers.host ?? `localhost:${GATEWAY_PORT}`;
  headers['x-forwarded-proto'] = 'http';

  const upstream = http.request(
    { host: HOST, port: porta, method: req.method, path: url, headers },
    (resposta) => {
      res.writeHead(resposta.statusCode ?? 502, resposta.headers);
      resposta.pipe(res);
    },
  );

  upstream.on('error', (erro) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`gateway: destino ${paraApi ? 'api' : 'web'}:${porta} indisponivel (${erro.code ?? erro.message})`);
  });

  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
});

// Sem host explicito (dual-stack), como a API: o navegador resolve `localhost` para ::1 ou 127.0.0.1.
servidor.listen(GATEWAY_PORT, () => {
  console.log(`[gateway] http://localhost:${GATEWAY_PORT}  /api -> :${API_PORT}  resto -> :${WEB_PORT}`);
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
