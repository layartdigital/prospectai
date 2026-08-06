import { ForbiddenException, Injectable } from '@nestjs/common';
import { PLAN_LIMITS, type PlanCode, type PlanLimits } from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';

export type Capability =
  | 'export.csv'
  | 'export.xlsx'
  | 'pipeline'
  | 'ai.outreach'
  | 'phone.full';

/**
 * Ponto único de verificação de plano.
 *
 * Nenhum controller, serviço ou componente lê limite diretamente. Quando um
 * limite muda, muda aqui — e não em quinze lugares espalhados, que é como
 * um produto acaba mostrando "500 leads" numa tela e "150" na outra.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  limits(planCode: PlanCode): PlanLimits {
    return PLAN_LIMITS[planCode];
  }

  can(planCode: PlanCode, capability: Capability): boolean {
    const limits = this.limits(planCode);

    switch (capability) {
      case 'export.csv':
        return limits.exportFormats.includes('csv');
      case 'export.xlsx':
        return limits.exportFormats.includes('xlsx');
      case 'pipeline':
        return limits.pipelineEnabled;
      case 'ai.outreach':
        return limits.aiGenerationsPerMonth > 0;
      case 'phone.full':
        return !limits.maskPhones;
      default:
        return false;
    }
  }

  /**
   * Lança apenas quando o usuário tentou explicitamente executar a ação.
   * Carregar uma página nunca deve chamar este método — é o que provoca
   * paywall abrindo sozinho.
   */
  assert(planCode: PlanCode, capability: Capability): void {
    if (!this.can(planCode, capability)) {
      throw new ForbiddenException({
        message: 'Recurso não disponível no seu plano',
        code: 'PLAN_LIMIT',
        capability,
        planCode,
      });
    }
  }

  /** Período de consumo do mês corrente, criado sob demanda. */
  async currentUsage(tenantId: string) {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    return this.prisma.planUsage.upsert({
      where: { tenantId_periodStart: { tenantId, periodStart } },
      create: { tenantId, periodStart, periodEnd },
      update: {},
    });
  }

  /**
   * Saldo de leads disponível.
   *
   * `reserved` conta o que está em voo; `settled` conta o que virou lead novo
   * de fato. Duplicado não entra em nenhum dos dois.
   */
  async availableLeadCredits(tenantId: string, planCode: PlanCode): Promise<number> {
    const usage = await this.currentUsage(tenantId);
    const included = this.limits(planCode).leadsIncluded;
    return Math.max(0, included - usage.leadsReserved - usage.leadsSettled);
  }

  /** Mascara o telefone quando o plano exige: (11) ••••••-0924 */
  maskPhone(phone: string | null, planCode: PlanCode): string | null {
    if (!phone) return null;
    if (!this.limits(planCode).maskPhones) return phone;

    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6) return '••••••';

    const ddd = digits.slice(-11, -9) || digits.slice(0, 2);
    const last = digits.slice(-4);
    return `(${ddd}) ••••••-${last}`;
  }
}
