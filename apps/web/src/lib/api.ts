import type { HealthResponse, VersionResponse } from '@propectai/types';

import { API_PREFIX } from './client-api-url';

/**
 * O navegador e o servidor Next falam com a API por caminhos diferentes.
 *
 * No servidor usamos 127.0.0.1 explicito: o fetch do Node resolve "localhost"
 * preferindo ::1 no Windows, e uma API ligada so em IPv4 aparece como fora
 * do ar. O fetch do Node tambem exige URL absoluta, entao o lado servidor
 * continua carregando um endereco.
 *
 * No navegador a base e vazia de proposito: caminho relativo, mesma origem.
 * Quem encaminha `/api` e o gateway (producao) ou o rewrite do Next
 * (desenvolvimento). Ver `lib/client-api-url.ts`.
 */
const API_URL =
  typeof window === 'undefined'
    ? (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3101')
    : '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${API_PREFIX}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `Falha na requisição (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // corpo nao e JSON - mantem a mensagem padrao
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>('/health', { cache: 'no-store' }),
  version: () => request<VersionResponse>('/system/version', { cache: 'no-store' }),
};
