import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AIProvider,
  type GenerateOutreachInput,
  type OutreachChannel,
  type OutreachLeadContext,
  type OutreachMessageView,
  type OutreachQuotaView,
  type OutreachTone,
  type PlanCode,
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

  async quota(tenantId: string, planCode: PlanCode): Promise<OutreachQuotaView> {
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
    const messages = await this.prisma.outreachMessage.findMany({
      where: { tenantId, leadId },
      orderBy: { createdAt: 'desc' },
      include: { author: true },
    });

    return messages.map((message) => this.toView(message));
  }

  /**
   * Gera um rascunho de abordagem.
   *
   * O gate de plano é verificado AQUI, dentro de uma ação explícita do
   * usuário. Nenhuma tela chama este método ao carregar.
   */
  async generate(
    tenantId: string,
    leadId: string,
    userId: string,
    planCode: PlanCode,
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

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId, deletedAt: null },
      include: {
        digitalPresence: true,
        score: { include: { reasons: { orderBy: { weight: 'desc' }, take: 3 } } },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');

    const onboarding = await this.prisma.onboardingState.findUnique({
      where: { tenantId },
    });

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

    const generated = await this.ai.generateOutreach({
      prompt,
      channel: input.channel,
      tone: input.tone,
    });

    const previousCount = await this.prisma.outreachMessage.count({
      where: { tenantId, leadId },
    });

    const message = await this.prisma.outreachMessage.create({
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

    await this.prisma.planUsage.update({
      where: { tenantId_periodStart: { tenantId, periodStart: usage.periodStart } },
      data: { aiGenerationsCount: { increment: 1 } },
    });

    await this.prisma.leadActivity.create({
      data: {
        tenantId,
        leadId,
        actorId: userId,
        type: 'OUTREACH_GENERATED',
        metadata: { channel: input.channel, tone: input.tone, provider: this.ai.name },
      },
    });

    return this.toView(message);
  }

  /** Edição manual do rascunho. O texto gerado nunca é a palavra final. */
  async update(
    tenantId: string,
    messageId: string,
    content: string,
  ): Promise<OutreachMessageView> {
    const existing = await this.prisma.outreachMessage.findFirst({
      where: { id: messageId, tenantId },
    });
    if (!existing) throw new NotFoundException('Mensagem não encontrada');

    const message = await this.prisma.outreachMessage.update({
      where: { id: messageId },
      data: { content },
      include: { author: true },
    });

    return this.toView(message);
  }

  /**
   * Marca como enviada e registra o contato.
   *
   * O envio é sempre feito pelo humano, fora do produto. Aqui apenas
   * registramos que aconteceu — a v0.1.1 não dispara nada automaticamente.
   */
  async markAsSent(
    tenantId: string,
    messageId: string,
    userId: string,
  ): Promise<OutreachMessageView> {
    const existing = await this.prisma.outreachMessage.findFirst({
      where: { id: messageId, tenantId },
    });
    if (!existing) throw new NotFoundException('Mensagem não encontrada');

    const message = await this.prisma.outreachMessage.update({
      where: { id: messageId },
      data: { isSent: true, sentAt: new Date() },
      include: { author: true },
    });

    await this.prisma.leadContactRecord.create({
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

    await this.prisma.lead.update({
      where: { id: existing.leadId },
      data: { lastContactedAt: new Date() },
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
