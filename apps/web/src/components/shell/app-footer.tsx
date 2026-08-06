import { api } from '@/lib/api';

/**
 * Rodape discreto: versao, ambiente e status da API.
 * Server Component - busca direto da API a cada render, sem cache.
 * Se a API estiver fora, o rodape mostra isso em vez de quebrar a pagina.
 */
export async function AppFooter() {
  let version = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.1';
  let environment = 'desconhecido';
  let apiStatus: 'ok' | 'degraded' | 'down' | 'inacessível' = 'inacessível';

  try {
    const [versionInfo, health] = await Promise.all([api.version(), api.health()]);
    version = versionInfo.version;
    environment = versionInfo.environment;
    apiStatus = health.status;
  } catch {
    // API fora do ar: o rodape informa, a pagina continua funcionando.
  }

  const statusColor =
    apiStatus === 'ok'
      ? 'bg-success'
      : apiStatus === 'degraded'
        ? 'bg-warning'
        : 'bg-danger';

  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-[11px] text-muted">
      <span className="font-medium">PropectAI v{version}</span>
      <span aria-hidden="true">·</span>
      <span>{environment}</span>
      <span aria-hidden="true">·</span>
      <span className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${statusColor}`}
          aria-hidden="true"
        />
        API {apiStatus}
      </span>
      <span aria-hidden="true">·</span>
      <a
        href="http://localhost:3101/api/docs"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded underline underline-offset-2 hover:text-navy-900"
      >
        Documentação
      </a>
    </footer>
  );
}
