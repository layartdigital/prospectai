import {
  Bell,
  Calculator,
  CreditCard,
  FileText,
  HelpCircle,
  History,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Navegação principal.
 *
 * Regra que vale para toda adição aqui: só entra no menu o que funciona.
 * Item que existe apenas para abrir um modal de bloqueio é o defeito que
 * este produto foi construído para evitar.
 *
 * O módulo "Construtor de Sites" não existe e não deve ser adicionado em
 * hipótese alguma.
 */
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Nova Busca', href: '/search', icon: Search },
  { label: 'Meus Leads', href: '/leads', icon: Users },
  { label: 'Pipeline', href: '/pipeline', icon: KanbanSquare },
  { label: 'Histórico', href: '/history', icon: History },
  { label: 'Propostas', href: '/proposals', icon: FileText },
  { label: 'Precificador', href: '/pricing-calculator', icon: Calculator },
  { label: 'Avisos', href: '/notifications', icon: Bell },
];

/**
 * Duas rotas existem e funcionam, mas ficam fora do menu por decisão de
 * 31/07/2026 — registrada em docs/strategic/scope-v0.1.1.md §4.4:
 *
 *   /ai-outreach   Duplica o LeadOutreachCard da ficha do lead. Dois lugares
 *                  para a mesma tarefa fazem o usuário perguntar qual é o
 *                  oficial. O código fica; a porta de entrada é a ficha.
 *
 *   /contracts     Sem provedor de assinatura digital contratado, a tela
 *                  promete um fluxo que não fecha. Entra no menu quando
 *                  houver assinatura de verdade.
 *
 * Não são placeholders nem paywall: quem chegar pela URL encontra tela
 * funcional. O que se decidiu é não convidar para elas ainda.
 */

export const SECONDARY_NAV: NavItem[] = [
  { label: 'Fazer Upgrade', href: '/subscription', icon: Sparkles },
  { label: 'Assinatura', href: '/subscription', icon: CreditCard },
  { label: 'Configurações', href: '/settings', icon: Settings },
  { label: 'Ajuda', href: '/help', icon: HelpCircle },
];

/** "Sair" não é link: precisa revogar o refresh token no servidor. */
export const LOGOUT_ICON = LogOut;
