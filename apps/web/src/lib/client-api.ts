'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101';

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    /** Presente quando o bloqueio veio de limite de plano. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

export async function clientApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string | string[]; code?: string }
      | null;

    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;

    throw new ClientApiError(
      message ?? 'Não foi possível concluir a ação',
      response.status,
      body?.code,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
