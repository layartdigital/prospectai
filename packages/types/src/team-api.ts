import type { Role } from './common';

/** Membro ativo do workspace. */
export interface TeamMemberView {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  isYou: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Convite pendente. */
export interface InvitationView {
  id: string;
  email: string;
  role: Role;
  invitedByName: string | null;
  expiresAt: string;
  createdAt: string;
  /**
   * Link de aceite, devolvido **apenas na criação**.
   *
   * Não há envio de e-mail no produto, então quem convida copia o link e
   * envia pelo canal que preferir. Na listagem vem `null`: o token é guardado
   * como hash, e reconstruí-lo depois seria guardar o segredo em claro.
   */
  acceptUrl: string | null;
}

export interface TeamView {
  members: TeamMemberView[];
  invitations: InvitationView[];
  /** Assentos ocupados: membros ativos mais convites pendentes. */
  seatsUsed: number;
  seatsIncluded: number;
}

export interface InviteMemberInput {
  email: string;
  role: Role;
}

/** Dados que o convidado vê antes de aceitar, sem precisar de sessão. */
export interface InvitationPreview {
  tenantName: string;
  email: string;
  role: Role;
  invitedByName: string | null;
  /** Já existe conta com este e-mail: aceitar só pede a senha atual. */
  userExists: boolean;
}

export interface AcceptInvitationInput {
  token: string;
  /** Obrigatório apenas quando ainda não existe conta com o e-mail. */
  name?: string;
  password: string;
}

/** Rótulo e descrição de cada papel, para a interface não inventar os seus. */
export const ROLE_LABELS: Record<Role, { label: string; description: string }> = {
  OWNER: {
    label: 'Dono',
    description: 'Controle total, incluindo plano, cobrança e equipe.',
  },
  ADMIN: {
    label: 'Administrador',
    description: 'Gerencia equipe e configurações. Não altera o plano.',
  },
  MANAGER: {
    label: 'Gerente',
    description: 'Gerencia leads, pipeline e preferências de prospecção.',
  },
  SDR: {
    label: 'SDR',
    description: 'Trabalha leads e registra contatos. Não muda configuração.',
  },
  VIEWER: {
    label: 'Visualizador',
    description: 'Só leitura. Não altera nada.',
  },
};
