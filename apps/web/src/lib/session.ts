import type { SessionResponse } from '@propectai/types';
import { cookies } from 'next/headers';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3101';

/**
 * Lê a sessão do usuário no servidor.
 *
 * Os cookies de autenticação são HttpOnly, então o Server Component precisa
 * repassá-los explicitamente para a API. Devolve null quando não há sessão,
 * em vez de lançar: quem decide redirecionar é o chamador.
 */
export async function getSession(): Promise<SessionResponse | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  if (!cookieHeader) return null;

  try {
    const response = await fetch(`${API_INTERNAL_URL}/api/v1/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });

    if (!response.ok) return null;
    return (await response.json()) as SessionResponse;
  } catch {
    // API fora do ar. Tratado como ausência de sessão pelo chamador.
    return null;
  }
}
