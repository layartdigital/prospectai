import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import {
  ROLE_RANK,
  type InvitationPreview,
  type InvitationView,
  type PlanCode,
  type Role,
  type TeamView,
} from '@propectai/types';

import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

/** Convite vence em sete dias. Link eterno é credencial eterna. */
const INVITE_TTL_DAYS = 7;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------

  async list(tenantId: string, planCode: PlanCode, userId: string): Promise<TeamView> {
    const [memberships, invitations] = await Promise.all([
      this.prisma.membership.findMany({
        where: { tenantId, deletedAt: null },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.invitation.findMany({
        where: { tenantId, acceptedAt: null, revokedAt: null },
        include: { invitedBy: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const pendentes = invitations.filter((convite) => convite.expiresAt > new Date());

    return {
      members: memberships.map((membership) => ({
        membershipId: membership.id,
        userId: membership.userId,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role as Role,
        isYou: membership.userId === userId,
        lastLoginAt: membership.user.lastLoginAt?.toISOString() ?? null,
        createdAt: membership.createdAt.toISOString(),
      })),
      invitations: pendentes.map((convite) => ({
        id: convite.id,
        email: convite.email,
        role: convite.role as Role,
        invitedByName: convite.invitedBy?.name ?? null,
        expiresAt: convite.expiresAt.toISOString(),
        createdAt: convite.createdAt.toISOString(),
        // Token guardado como hash: não há como reconstruir o link depois.
        acceptUrl: null,
      })),
      // Convite pendente ocupa assento. Sem isso, mil convites furam o plano
      // sem que ninguém tenha entrado.
      seatsUsed: memberships.length + pendentes.length,
      seatsIncluded: this.entitlements.limits(planCode).maxUsers,
    };
  }

  // ---------------------------------------------------------------------------
  // Convite
  // ---------------------------------------------------------------------------

  async invite(
    tenantId: string,
    planCode: PlanCode,
    convidante: { id: string; role: Role },
    input: { email: string; role: Role },
  ): Promise<InvitationView> {
    const email = input.email.trim().toLowerCase();

    // Ninguém concede papel acima do próprio. Sem esta regra, um ADMIN cria um
    // OWNER e escala privilégio em duas requisições.
    if (ROLE_RANK[input.role] < ROLE_RANK[convidante.role]) {
      throw new ForbiddenException(
        'Você não pode conceder um papel acima do seu próprio',
      );
    }

    const jaMembro = await this.prisma.membership.findFirst({
      where: { tenantId, deletedAt: null, user: { email } },
    });
    if (jaMembro) {
      throw new ConflictException('Esta pessoa já faz parte do workspace');
    }

    const jaConvidado = await this.prisma.invitation.findFirst({
      where: {
        tenantId,
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (jaConvidado) {
      throw new ConflictException('Já existe um convite pendente para este e-mail');
    }

    const { seatsUsed, seatsIncluded } = await this.list(
      tenantId,
      planCode,
      convidante.id,
    );

    // O gate age aqui, na tentativa — nunca ao carregar a tela de equipe.
    if (seatsUsed >= seatsIncluded) {
      throw new ForbiddenException({
        message: `O plano ${planCode} inclui ${seatsIncluded} ${
          seatsIncluded === 1 ? 'usuário' : 'usuários'
        }. Faça upgrade para convidar mais pessoas.`,
        code: 'PLAN_LIMIT',
        capability: 'team.invite',
        planCode,
      });
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const convite = await this.prisma.invitation.create({
      data: {
        tenantId,
        email,
        role: input.role,
        tokenHash: hashToken(token),
        invitedById: convidante.id,
        expiresAt,
      },
      include: { invitedBy: true },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: convidante.id,
        action: 'team.invited',
        entityType: 'Invitation',
        entityId: convite.id,
        after: { email, role: input.role },
      },
    });

    return {
      id: convite.id,
      email: convite.email,
      role: convite.role as Role,
      invitedByName: convite.invitedBy?.name ?? null,
      expiresAt: convite.expiresAt.toISOString(),
      createdAt: convite.createdAt.toISOString(),
      // Única vez em que o token existe em claro. Depois daqui, só o hash.
      acceptUrl: `${this.webOrigin()}/invite/${token}`,
    };
  }

  async revokeInvitation(
    tenantId: string,
    invitationId: string,
    userId: string,
  ): Promise<void> {
    const convite = await this.prisma.invitation.findFirst({
      where: { id: invitationId, tenantId },
    });
    if (!convite) throw new NotFoundException('Convite não encontrado');

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'team.invitation_revoked',
        entityType: 'Invitation',
        entityId: invitationId,
        before: { email: convite.email, role: convite.role },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Aceite — rota pública
  // ---------------------------------------------------------------------------

  async previewInvitation(token: string): Promise<InvitationPreview> {
    const convite = await this.conviteValido(token);

    const user = await this.prisma.user.findUnique({
      where: { email: convite.email },
    });

    return {
      tenantName: convite.tenant.name,
      email: convite.email,
      role: convite.role as Role,
      invitedByName: convite.invitedBy?.name ?? null,
      userExists: Boolean(user),
    };
  }

  /**
   * Aceita o convite e devolve o usuário para a sessão ser aberta.
   *
   * Dois caminhos: conta nova cria usuário com a senha escolhida; conta
   * existente exige a senha atual. O segundo é o que impede alguém com o link
   * de anexar um workspace à conta de outra pessoa.
   */
  async accept(input: {
    token: string;
    name?: string;
    password: string;
  }): Promise<{ userId: string; tenantId: string }> {
    const convite = await this.conviteValido(input.token);

    const existente = await this.prisma.user.findUnique({
      where: { email: convite.email },
    });

    if (existente) {
      const senhaConfere = await argonVerify(existente.passwordHash, input.password);
      if (!senhaConfere) {
        throw new ForbiddenException(
          'Já existe uma conta com este e-mail. Informe a senha dela para aceitar o convite.',
        );
      }
    } else if (!input.name || input.name.trim().length < 2) {
      throw new BadRequestException('Informe seu nome');
    }

    const passwordHash = existente ? null : await argonHash(input.password);

    return this.prisma.$transaction(async (tx) => {
      const user =
        existente ??
        (await tx.user.create({
          data: {
            email: convite.email,
            name: input.name!.trim(),
            passwordHash: passwordHash!,
          },
        }));

      // Já membro por outro caminho entre a leitura e agora: idempotente.
      const jaMembro = await tx.membership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: convite.tenantId } },
      });

      if (!jaMembro) {
        await tx.membership.create({
          data: {
            userId: user.id,
            tenantId: convite.tenantId,
            role: convite.role,
            isDefault: !existente,
          },
        });
      }

      await tx.invitation.update({
        where: { id: convite.id },
        data: { acceptedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          tenantId: convite.tenantId,
          actorId: user.id,
          action: 'team.invitation_accepted',
          entityType: 'Membership',
          entityId: convite.id,
          after: { email: convite.email, role: convite.role },
        },
      });

      return { userId: user.id, tenantId: convite.tenantId };
    });
  }

  // ---------------------------------------------------------------------------
  // Membros
  // ---------------------------------------------------------------------------

  async changeRole(
    tenantId: string,
    membershipId: string,
    ator: { id: string; role: Role },
    novoPapel: Role,
  ): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId, deletedAt: null },
    });
    if (!membership) throw new NotFoundException('Membro não encontrado');

    if (ROLE_RANK[novoPapel] < ROLE_RANK[ator.role]) {
      throw new ForbiddenException('Você não pode conceder um papel acima do seu');
    }

    // Rebaixar alguém acima de você é escalada de privilégio pelo avesso.
    if (ROLE_RANK[membership.role as Role] < ROLE_RANK[ator.role]) {
      throw new ForbiddenException('Você não pode alterar alguém acima do seu papel');
    }

    if (membership.role === 'OWNER' && novoPapel !== 'OWNER') {
      await this.assertNaoEUltimoDono(tenantId, membershipId);
    }

    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { role: novoPapel },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: ator.id,
        action: 'team.role_changed',
        entityType: 'Membership',
        entityId: membershipId,
        before: { role: membership.role },
        after: { role: novoPapel },
      },
    });
  }

  async removeMember(
    tenantId: string,
    membershipId: string,
    ator: { id: string; role: Role },
  ): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId, deletedAt: null },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException('Membro não encontrado');

    if (ROLE_RANK[membership.role as Role] < ROLE_RANK[ator.role]) {
      throw new ForbiddenException('Você não pode remover alguém acima do seu papel');
    }

    if (membership.role === 'OWNER') {
      await this.assertNaoEUltimoDono(tenantId, membershipId);
    }

    // Soft delete: o histórico do lead aponta para o autor, e apagar o vínculo
    // deixaria contatos e notas órfãos de quem os registrou.
    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { deletedAt: new Date() },
    });

    // A sessão precisa morrer junto. Sem isto, quem foi removido continua
    // trabalhando até o access token expirar.
    await this.prisma.refreshToken.updateMany({
      where: { userId: membership.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: ator.id,
        action: 'team.member_removed',
        entityType: 'Membership',
        entityId: membershipId,
        before: { email: membership.user.email, role: membership.role },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  /**
   * Workspace sem dono é workspace sem quem mude plano, convide ou remova.
   * Estado irrecuperável pela própria interface.
   */
  private async assertNaoEUltimoDono(
    tenantId: string,
    membershipId: string,
  ): Promise<void> {
    const outrosDonos = await this.prisma.membership.count({
      where: {
        tenantId,
        role: 'OWNER',
        deletedAt: null,
        id: { not: membershipId },
      },
    });

    if (outrosDonos === 0) {
      throw new BadRequestException(
        'Este é o único dono do workspace. Promova outra pessoa a dono antes.',
      );
    }
  }

  private async conviteValido(token: string) {
    const convite = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { tenant: true, invitedBy: true },
    });

    if (!convite || convite.revokedAt || convite.acceptedAt) {
      throw new NotFoundException('Convite inválido ou já utilizado');
    }
    if (convite.expiresAt < new Date()) {
      throw new NotFoundException('Este convite expirou. Peça um novo.');
    }

    return convite;
  }

  private webOrigin(): string {
    return this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3100';
  }
}
