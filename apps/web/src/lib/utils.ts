import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Mascara de telefone do plano FREE: (11) ••••••-0924
 * O plano determina se o numero completo aparece; a mascara nunca e
 * aplicada no cliente sobre um dado completo que ja veio da API.
 */
export function formatMaskedPhone(masked: string | null): string {
  return masked ?? 'Telefone não disponível';
}

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
