import { cookies } from 'next/headers';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3101';

export class ServerApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ServerApiError';
  }
}

/**
 * Fetch autenticado para Server Components.
 *
 * Os cookies de sessão são HttpOnly, então precisam ser repassados
 * explicitamente — o Node não os carrega sozinho como o navegador faz.
 */
export async function serverApi<T>(path: string): Promise<T> {
  const cookieStore = await cookies();

  const response = await fetch(`${API_INTERNAL_URL}/api/v1${path}`, {
    headers: { cookie: cookieStore.toString() },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new ServerApiError(
      `Falha ao carregar ${path}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}
