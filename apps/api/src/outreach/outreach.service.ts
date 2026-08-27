import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AIProvider,
  type GenerateOutreachInput,
  type OutreachChannel,
  type OutreachLeadContext,
  type OutreachMessageView,
  type OutreachQuotaView,
  type OutreachTone,
} from '@propectai/types';

import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { AIProviderFactory } from './providers/ai-provider.factory';

@Injectable()
export class OutreachService {
  /**
   * Qual provider está ativo é decisão de configuração, não de código.
   * A fábrica resolve na inicialização e registra a escolha em log.
   */
  private readonly ai: AIProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    aiFactory: AIProviderFactory,
  ) {
    this.ai = aiFactory.get();
  }

  /**
   * Só entitlements — nenhuma leitura direta do Prisma acontece aqui.
   *
   * O `EntitlementsService` usa o próprio client e por isso fica de fora de
   * qualquer bloco; ele é um dos três casos especiais da fase A (precisa
   * receber o `tx` por parâmetro) e será tratado na fatia 8.
   */
  async quota(tenantId: string, planCode: string): Promise<OutreachQuotaView> {
    const limits = this.entitlements.limits(planCode);
    const usage = await this.entitlements.currentUsage(tenantId);

    return {
      planCode,
      used: usage.aiGenerationsCount,
      included: limits.aiGenerationsPerMonth,
      available: Math.max(0, limits.aiGenerationsPerMonth - usage.aiGenerationsCount),
      enabled: limits.aiGenerationsPerMonth > 0,
    };
  }

  async list(tenantId: string, leadId: string): Promise<OutreachMessageView[]> {
    const messages = await this.prisma.comTenant(tenantId, (tx) =>
      tx.outreachMessage.findMany({
        where: { tenantId, leadId },
        orderBy: { createdAt: 'desc' },
        include: { author: true },
      }),
    );

    return messages.map((message) => this.toView(message));
  }

  /**
   * Gera um rascunho de abordagem.
   *
   * O gate de plano é verificado AQUI, dentro de uma ação explícita do
   * usuário. Nenhuma tela chama este método ao carregar.
   *
   * **Dois blocos, não um.** A chamada ao provider de IA fica entre a leitura
   * e a escrita, e ela é I/O externo: rede, latência de segundos, e um
   * fornecedor que pode simplesmente não responder. Mantê-la dentro da
   * transação seguraria uma conexão do pool — e o `timeout` de 10 s do
   * `comTenant` — durante toda a espera. É a mesma forma usada em
   * `process-audit-job.ts`, pela mesma razão.
   *
   * O que se perde no corte: entre ler o lead e gravar a mensagem, o lead
   * pode ter sido apagado. Já era assim antes — as quatro chamadas eram
   * soltas — e o custo do erro é uma mensagem órfã, não uma cobrança errada.
   * O que **passou** a ser atômico é o grupo de escrita: mensagem, consumo de
   * cota e atividade agora vivem ou morrem juntos.
   */
  async generate(
    tenantId: string,
    leadId: string,
    userId: string,
    planCode: string,
    input: GenerateOutreachInput,
  ): Promise<OutreachMessageView> {
    this.entitlements.assert(planCode, 'ai.outreach');

    const limits = this.entitlements.limits(planCode);
    const usage = await this.entitlements.currentUsage(tenantId);

    if (usage.aiGenerationsCount >= limits.aiGenerationsPerMonth) {
      throw new ForbiddenException({
        message: `Você usou as ${limits.aiGenerationsPerMonth} gerações do plano ${planCode} neste período`,
        code: 'PLAN_LIMIT',
        capability: 'ai.outreach',
      });
    }

    // Bloco 1 — leitura do contexto.
    const { lead, onboarding } = await this.prisma.comTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId, deletedAt: null },
        include: {
          digitalPresence: true,
          score: { include: { reasons: { orderBy: { weight: 'desc' }, take: 3 } } },
        },
      });

      const onboarding = await tx.onboardingState.findUnique({ where: { tenantId } });

      return { lead, onboarding };
    });

    if (!lead) throw new NotFoundException('Lead não encontrado');

    const context: OutreachLeadContext = {
      name: lead.name,
      category: lead.category,
      city: lead.addressCity,
      stateUf: lead.addressStateUf,
      websiteStatus: lead.websiteStatus,
      website: lead.website,
      reviewCount: lead.reviewCount,
      reviewRating: lead.reviewRating,
      hasWhatsapp: lead.digitalPresence?.whatsappStatus !== 'UNKNOWN',
      scoreValue: lead.score?.value ?? 0,
      scoreReasons: (lead.score?.reasons ?? [])
        .filter((reason) => reason.polarity === 'POSITIVE')
        .map((reason) => reason.label),
    };

    const services = (onboarding?.servicesSold as string[] | null) ?? [];
    const serviceOffered = input.serviceOffered || services[0] || 'presença digital';

    const prompt = this.buildPrompt(context, { ...input, serviceOffered });

    // I/O externo — fora de qualquer transação, de propósito.
    const generated = await this.ai.generateOutreach({
      prompt,
      channel: input.channel,
      tone: input.tone,
    });

    // Bloco 2 — escrita.
    const message = await this.prisma.comTenant(tenantId, async (tx) => {
      /**
       * A contagem entrou no mesmo bloco da criação de propósito: `version`
       * sai dela. Ler fora e gravar depois deixava a janela escancarada para
       * duas gerações simultâneas nascerem com o mesmo número.
       *
       * A transação estreita a janela; não a fecha — só um índice único em
       * `(tenantId, leadId, version)` fecharia, e isso é mudança de schema,
       * fora do escopo desta fase.
       */
      const previousCount = await tx.outreachMessage.count({ where: { tenantId, leadId } });

      const message = await tx.outreachMessage.create({
        data: {
          tenantId,
          leadId,
          authorId: userId,
          channel: input.channel as never,
          tone: input.tone as never,
          serviceOffered,
          objective: input.objective ?? null,
          callToAction: input.callToAction ?? null,
          extraNotes: input.extraNotes ?? null,
          prompt,
          content: generated.content,
          provider: this.ai.name,
          model: this.ai.model,
          tokensEstimated: generated.tokensEstimated,
          version: previousCount + 1,
        },
        include: { author: true },
      });

      await tx.planUsage.update({
        where: { tenantId_periodStart: { tenantId, periodStart: usage.periodStart } },
        data: { aiGenerationsCount: { increment: 1 } },
      });

      await tx.leadActivity.create({
        data: {
          tenantId,
          leadId,
          actorId: userId,
          type: 'OUTREACH_GENERATED',
          metadata: { channel: input.channel, tone: input.tone, provider: this.ai.name },
        },
      });

      return message;
    });

    return this.toView(message);
  }

  /** Edição manual do rascunho. O texto gerado nunca é a palavra final. */
  async update(
    tenantId: string,
    messageId: string,
    content: string,
  ): Promise<OutreachMessageView> {
    const message = await this.prisma.comTenant(tenantId, async (tx) => {
      const existing = await tx.outreachMessage.findFirst({
        where: { id: messageId, tenantId },
      });
      if (!existing) throw new NotFoundException('Mensagem não encontrada');

      return tx.outreachMessage.update({
        where: { id: messageId },
        data: { content },
        include: { author: true },
      });
    });

    return this.toView(message);
  }

  /**
   * Marca como enviada e registra o contato.
   *
   * O envio é sempre feito pelo humano, fora do produto. Aqui apenas
   * registramos que aconteceu — a v0.1.1 não dispara nada automaticamente.
   *
   * As três escritas num bloco só: marcar a mensagem sem gravar o contato
   * deixava o histórico do lead mentindo sobre o que aconteceu.
   */
  async markAsSent(
    tenantId: string,
    messageId: string,
    userId: string,
  ): Promise<OutreachMessageView> {
    const message = await this.prisma.comTenant(tenantId, async (tx) => {
      const existing = await tx.outreachMessage.findFirst({
        where: { id: messageId, tenantId },
      });
      if (!existing) throw new NotFoundException('Mensagem não encontrada');

      const message = await tx.outreachMessage.update({
        where: { id: messageId },
        data: { isSent: true, sentAt: new Date() },
        include: { author: true },
      });

      await tx.leadContactRecord.create({
        data: {
          tenantId,
          leadId: existing.leadId,
          authorId: userId,
          channel: existing.channel,
          direction: 'SENT',
          outcome: 'Abordagem gerada por IA enviada',
          outreachId: messageId,
        },
      });

      await tx.lead.update({
        where: { id: existing.leadId },
        data: { lastContactedAt: new Date() },
      });

      return message;
    });

    return this.toView(message);
  }

  // ---------------------------------------------------------------------------

  /**
   * Monta o prompt em campos rotulados.
   *
   * Formato estruturado de propósito: o provider extrai o que precisa sem
   * interpretar prosa, e fica explícito que só entram fatos verificados.
   * O gancho usa o sinal mais forte do score — que é o argumento comercial
   * mais honesto disponível.
   */
  private buildPrompt(
    lead: OutreachLeadContext,
    input: GenerateOutreachInput & { serviceOffered: string },
  ): string {
    const hooks: string[] = [];

    if (lead.websiteStatus === 'SEM_SITE') {
      hooks.push(
        'Percebi que vocês ainda não têm um site próprio, mesmo já aparecendo bem no Google Maps.',
      );
    } else if (lead.websiteStatus === 'SITE_PRECARIO') {
      hooks.push(
        'Vi que a página de vocês está em um construtor gratuito — funciona, mas limita bastante o que dá para fazer.',
      );
    }

    if (lead.reviewRating !== null && lead.reviewRating >= 4.5 && (lead.reviewCount ?? 0) < 50) {
      hooks.push(
        `A nota de ${lead.reviewRating} mostra que o atendimento é bom; o que falta é mais gente descobrindo isso.`,
      );
    }

    return [
      `EMPRESA: ${lead.name}`,
      `SEGMENTO: ${lead.category ?? 'não informado'}`,
      `CIDADE: ${lead.city ?? 'não informada'}${lead.stateUf ? `, ${lead.stateUf}` : ''}`,
      `GANCHO: ${hooks[0] ?? ''}`,
      `SERVICO: ${input.serviceOffered}`,
      `OBJETIVO: ${input.objective ?? ''}`,
      `CTA: ${input.callToAction ?? ''}`,
      `OBSERVACOES: ${input.extraNotes ?? ''}`,
      `CANAL: ${input.channel}`,
      `TOM: ${input.tone}`,
      '',
      'REGRA: use exclusivamente os fatos acima. Não infira número de unidades,',
      'tempo de mercado, sócios, faturamento ou qualquer dado ausente.',
    ].join('\n');
  }

  private toView(message: {
    id: string;
    channel: string;
    tone: string;
    content: string;
    provider: string;
    model: string | null;
    version: number;
    isSent: boolean;
    sentAt: Date | null;
    createdAt: Date;
    author?: { name: string } | null;
  }): OutreachMessageView {
    return {
      id: message.id,
      channel: message.channel as OutreachChannel,
      tone: message.tone as OutreachTone,
      content: message.content,
      provider: message.provider,
      model: message.model,
      version: message.version,
      isSent: message.isSent,
      sentAt: message.sentAt?.toISOString() ?? null,
      authorName: message.author?.name ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
