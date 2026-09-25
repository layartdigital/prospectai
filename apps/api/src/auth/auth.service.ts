import { createHash, randomBytes } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import {
  type AuthTenant,
  type Role,
  type SessionResponse,
} from '@propectai/types';

import { PrismaSistemaService } from '../prisma/prisma-sistema.service';
import { declararTenant, PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/request-context';

/** Etapas padrão criadas junto com todo tenant novo. */
const DEFAULT_STAGES = [
  { slug: 'novo', name: 'Novo', color: '#6B7A99' },
  { slug: 'contato-enviado', name: 'Contato Enviado', color: '#3B82F6' },
  { slug: 'respondeu', name: 'Respondeu', color: '#2F6BFF' },
  { slug: 'reuniao-agendada', name: 'Reunião Agendada', color: '#8B5CF6' },
  { slug: 'proposta-enviada', name: 'Proposta Enviada', color: '#F59E0B' },
  { slug: 'negociacao', name: 'Negociação', color: '#F97316' },
  { slug: 'fechado', name: 'Fechado', color: '#22C55E', isTerminal: true, isWon: true },
  { slug: 'perdido', name: 'Perdido', color: '#EF4444', isTerminal: true },
];

/**
 * Converte "15m", "7d", "3600" em segundos.
 * Valor ausente ou malformado cai no padrão — nunca em uma sessão eterna.
 */
function parseTtlSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const match = /^(\d+)\s*([smhd])?$/i.exec(value.trim());
  if (!match) return fallback;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;

  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const unit = match[2]?.toLowerCase();

  return unit ? amount * (multipliers[unit] ?? 1) : amount;
}

export interface IssuedTokens {
  userId: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sistema: PrismaSistemaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Registro
  // ---------------------------------------------------------------------------

  async register(input: {
    name: string;
    email: string;
    password: string;
    tenantName: string;
  }): Promise<{ userId: string; tenantId: string }> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Já existe uma conta com este e-mail');
    }

    const passwordHash = await argonHash(input.password);
    const slug = await this.uniqueSlug(input.tenantName);

    const freePlan = await this.prisma.plan.findUnique({ where: { code: 'FREE' } });

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name: input.name.trim(), passwordHash },
      });

      const tenant = await tx.tenant.create({
        data: { name: input.tenantName.trim(), slug },
      });

      /**
       * **O contexto e declarado aqui, no meio, e nao na abertura.**
       *
       * Este e o unico lugar do produto onde o tenant nasce dentro da propria
       * transacao que o usa. Nao havia como embrulhar com `comTenant`: na
       * abertura o `tenant.id` ainda nao existe.
       *
       * Tudo o que vem acima toca tabelas sem politica — `users` e `tenants` sao
       * globais por natureza, porque a pessoa existe antes do workspace e o
       * workspace e o proprio sujeito da regra. Tudo o que vem abaixo e
       * escopado, e passa a enxergar o contexto certo.
       *
       * **Foi exatamente esta linha que faltou** quando a familia Pipeline foi
       * ligada em 27/08: o `pipelineStage.createMany` logo abaixo virou
       * "new row violates row-level security policy", o registro passou a
       * responder 500, e 45 testes cairam junto.
       */
      await declararTenant(tx, tenant.id);

      await tx.membership.create({
        data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', isDefault: true },
      });

      if (freePlan) {
        await tx.subscription.create({
          data: { tenantId: tenant.id, planId: freePlan.id, status: 'TRIALING' },
        });
      }

      await tx.onboardingState.create({ data: { tenantId: tenant.id } });

      await tx.pipelineStage.createMany({
        data: DEFAULT_STAGES.map((stage, index) => ({
          tenantId: tenant.id,
          slug: stage.slug,
          name: stage.name,
          color: stage.color,
          order: index,
          isTerminal: stage.isTerminal ?? false,
          isWon: stage.isWon ?? false,
        })),
      });

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: user.id,
          action: 'auth.register',
          entityType: 'Tenant',
          entityId: tenant.id,
        },
      });

      return { userId: user.id, tenantId: tenant.id };
    });
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async validateCredentials(email: string, password: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    // Mensagem idêntica para e-mail inexistente e senha errada: dizer qual
    // dos dois falhou entrega uma lista de e-mails cadastrados.
    const invalid = new UnauthorizedException('E-mail ou senha incorretos');

    // O retorno e usado, e nao so a validacao: e ele que estreita o tipo de
    // `user` de "talvez nulo" para "existe e esta habilitado". Ignora-lo
    // deixaria o compilador cego justamente na fronteira que a funcao existe
    // para guardar — foi o que aconteceu na primeira versao deste commit.
    const habilitado = this.garantirHabilitado(user, invalid);

    const ok = await argonVerify(habilitado.passwordHash, password);
    if (!ok) throw invalid;

    await this.prisma.user.update({
      where: { id: habilitado.id },
      data: { lastLoginAt: new Date() },
    });

    return habilitado.id;
  }

  // ---------------------------------------------------------------------------
  // A regra de quem pode ter credencial, num lugar so
  // ---------------------------------------------------------------------------

  /**
   * **Conta desabilitada nao emite e nao renova credencial.**
   *
   * Ate 25/09/2026 esta regra existia em **um** lugar: o `validateCredentials`.
   * Login recusava conta inativa; renovacao nao. Medido no GATE S0: quem
   * tivesse um refresh token valido continuava rodando para sempre, porque cada
   * rotacao emitia outro com sete dias novos. Desativar usuario nao expulsava
   * ninguem — era decoracao.
   *
   * O chamador escolhe a excecao de proposito. No login ela precisa ser
   * **identica** a de senha errada, senao a tela vira consulta de contas
   * existentes; na renovacao pode dizer que a sessao acabou, porque quem esta
   * ali ja provou quem e.
   *
   * `revokeRefreshToken` **nao** passa por aqui, e isso e decisao, nao
   * esquecimento: sessao de conta desativada precisa continuar revogavel. Negar
   * a revogacao seria proteger o token contra quem quer derruba-lo.
   */
  private garantirHabilitado<T extends { isActive: boolean; deletedAt: Date | null }>(
    usuario: T | null,
    recusa: UnauthorizedException,
  ): T {
    if (!usuario || !usuario.isActive || usuario.deletedAt) throw recusa;
    return usuario;
  }

  // ---------------------------------------------------------------------------
  // Tokens
  // ---------------------------------------------------------------------------

  async issueTokens(
    userId: string,
    meta: { userAgent?: string; ipAddress?: string } = {},
  ): Promise<IssuedTokens> {
    const user = this.garantirHabilitado(
      await this.prisma.user.findUnique({ where: { id: userId } }),
      new UnauthorizedException('Esta conta nao pode iniciar sessao'),
    );

    const payload: JwtPayload = { sub: user.id, email: user.email };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      // Em segundos, de propósito: o tipo `expiresIn` do @nestjs/jwt aceita
      // number ou um literal de template do pacote `ms`, e uma string comum
      // vinda do .env não satisfaz o segundo.
      expiresIn: parseTtlSeconds(this.config.get<string>('JWT_ACCESS_TTL'), 900),
    });

    // O refresh token é opaco, não JWT: precisa ser revogável no banco.
    //
    // `JWT_REFRESH_TTL` passou a ser lido em 25/09/2026. Ate entao os 7 dias
    // estavam escritos aqui e a variavel existia no `.env.example` e no CI sem
    // nenhum leitor — mexer nela nao mudava nada, o que e pior do que nao
    // existir. O padrao continua 7 dias, agora explicito.
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() +
        parseTtlSeconds(this.config.get<string>('JWT_REFRESH_TTL'), 7 * 24 * 60 * 60) * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });

    return { userId: user.id, accessToken, refreshToken, refreshExpiresAt };
  }

  /**
   * Rotação: **quem revoga o token antigo ganha o direito de emitir o novo.**
   *
   * A ordem inverteu em 25/09/2026, e o motivo e concorrencia. A versao
   * anterior lia o token, conferia `revokedAt` em memoria, emitia o substituto
   * e so entao revogava o antigo. Duas requisicoes simultaneas com o mesmo
   * token — o navegador com duas abas, ou um retry — liam as duas a mesma linha
   * como valida e **ambas emitiam descendente**. Um refresh token virava dois,
   * e o desenho de deteccao de reuso (`replacedBy`) nao via nada de errado.
   *
   * Agora a revogacao e a **reivindicacao**: um `updateMany` condicional que so
   * afeta a linha se ela ainda estiver valida. O banco serializa a escrita, e
   * `count` responde quem chegou primeiro — 1 para o vencedor, 0 para o
   * perdedor, sem leitura previa em que confiar.
   *
   * O preco esta declarado: se a emissao falhar depois da reivindicacao, a
   * sessao se perde e a pessoa entra de novo. Preferimos perder uma sessao a
   * duplicar credencial.
   */
  async rotateRefreshToken(
    rawToken: string,
    meta: { userAgent?: string; ipAddress?: string } = {},
  ): Promise<IssuedTokens> {
    const tokenHash = this.hashToken(rawToken);
    const expirada = new UnauthorizedException('Sessão expirada. Entre novamente.');

    const reivindicacao = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });

    if (reivindicacao.count === 0) throw expirada;

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) throw expirada;

    const issued = await this.issueTokens(stored.userId, meta);

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedBy: this.hashToken(issued.refreshToken) },
    });

    return issued;
  }

  /**
   * **Nao passa por `garantirHabilitado`, de proposito.** Ver a nota daquela
   * funcao: conta desativada continua podendo ter a sessao derrubada.
   */
  async revokeRefreshToken(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Sessão
  // ---------------------------------------------------------------------------

  /**
   * **Atravessa tenants de proposito, e nao recebe `comTenant`.**
   *
   * Esta consulta lista os workspaces de uma pessoa — e a pergunta e sobre ela,
   * nao sobre um deles. Nao existe um tenant a declarar aqui; o proposito e
   * justamente enumera-los.
   *
   * Terceiro caso de travessia deliberada do repositorio, junto com o
   * `AdminService` e o `PrivacyService`. Quando a familia 6 puser politica em
   * `memberships`, esta leitura devolve zero e **o login para de listar
   * workspace nenhum** — precisa do papel que atravessa tenants, o mesmo
   * `propectai_admin` dos outros dois.
   *
   * E repare como ele chega la: `memberships` vem por `include` a partir de
   * `user`, que nao e tabela escopada. **Varredura por delegate nao encontra
   * este caminho** — ver a nota de metodo no `PLANO-RLS-PASSO6-v1.md`.
   */
  async getSession(userId: string, activeTenantId?: string): Promise<SessionResponse> {
    const user = await this.sistema.atravessandoTenants(
      'listar os workspaces de uma pessoa: a pergunta e sobre ela, nao sobre um deles',
      (db) =>
        db.user.findUniqueOrThrow({
          where: { id: userId },
          include: {
            memberships: {
              where: { deletedAt: null, tenant: { deletedAt: null } },
              orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
              include: {
                tenant: {
                  include: {
                    subscription: { include: { plan: true } },
                    onboardingState: true,
                  },
                },
              },
            },
          },
        }),
    );

    this.garantirHabilitado(user, new UnauthorizedException('Esta conta nao esta ativa'));

    const tenants: AuthTenant[] = user.memberships.map((membership) => ({
      id: membership.tenantId,
      name: membership.tenant.name,
      slug: membership.tenant.slug,
      role: membership.role as Role,
      planCode: membership.tenant.subscription?.plan.code ?? 'FREE',
    }));

    const active =
      tenants.find((tenant) => tenant.id === activeTenantId) ?? tenants[0] ?? null;

    const activeMembership = user.memberships.find((m) => m.tenantId === active?.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      tenant: active,
      tenants,
      onboardingCompleted: Boolean(
        activeMembership?.tenant.onboardingState?.completedAt,
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Auxiliares
  // ---------------------------------------------------------------------------

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .normalize('NFD')
        .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'workspace';

    let slug = base;
    let suffix = 1;

    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${base}-${suffix}`;
    }

    return slug;
  }
}
