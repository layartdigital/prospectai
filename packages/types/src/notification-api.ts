export const NOTIFICATION_TYPES = [
  'HIGH_SCORE_LEAD',
  'SEARCH_COMPLETED',
  'SEARCH_FAILED',
  'FOLLOWUP_OVERDUE',
  'LIMIT_NEAR',
  'WEEKLY_SUMMARY',
  'LEAD_PROFILE_UPDATED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  HIGH_SCORE_LEAD: 'Oportunidade alta',
  SEARCH_COMPLETED: 'Busca concluída',
  SEARCH_FAILED: 'Busca com erro',
  FOLLOWUP_OVERDUE: 'Follow-up vencido',
  LIMIT_NEAR: 'Limite do plano',
  WEEKLY_SUMMARY: 'Resumo semanal',
  LEAD_PROFILE_UPDATED: 'Perfil atualizado',
};

/**
 * Severidade visual.
 *
 * Só `SEARCH_FAILED` e `FOLLOWUP_OVERDUE` pedem atenção imediata. Pintar
 * tudo de vermelho faz o usuário parar de olhar para o vermelho.
 */
export const NOTIFICATION_SEVERITY: Record<
  NotificationType,
  'info' | 'success' | 'warning' | 'danger'
> = {
  HIGH_SCORE_LEAD: 'success',
  SEARCH_COMPLETED: 'info',
  SEARCH_FAILED: 'danger',
  FOLLOWUP_OVERDUE: 'warning',
  LIMIT_NEAR: 'warning',
  WEEKLY_SUMMARY: 'info',
  LEAD_PROFILE_UPDATED: 'info',
};

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** Destino ao clicar, quando o payload permite montar um. */
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationView[];
  unreadCount: number;
  total: number;
}
