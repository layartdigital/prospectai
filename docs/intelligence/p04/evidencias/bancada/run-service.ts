import { IntelligenceService } from '../../work/prospectai/apps/api/src/intelligence/intelligence.service';
import { criarPrismaFalso, type ConsultasFeitas } from './fake-prisma';

/** Mesma regra do EntitlementsService real: plano FREE mascara; os demais nao. */
export function entitlementsDaBancada(planosQueLiberam: string[] = []) {
  const mascara = (plan: string): boolean => !planosQueLiberam.includes(plan);
  return {
    can: (plan: string, cap: string) => (cap === 'phone.full' ? !mascara(plan) : false),
    maskPhone: (phone: string | null, plan: string) => {
      if (!phone) return null;
      if (!mascara(plan)) return phone;
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 6) return '••••••';
      const ddd = digits.slice(-11, -9) || digits.slice(0, 2);
      return `(${ddd}) ••••••-${digits.slice(-4)}`;
    },
  };
}

export const SEGREDO_DA_BANCADA = 'segredo-de-bancada-nao-e-de-producao';
const configDaBancada = (segredo: string) => ({ getOrThrow: () => segredo });

export function criarServico(contador?: ConsultasFeitas, planosQueLiberam: string[] = [], segredo = SEGREDO_DA_BANCADA) {
  return new IntelligenceService(
    criarPrismaFalso(contador) as never,
    entitlementsDaBancada(planosQueLiberam) as never,
    configDaBancada(segredo) as never,
  );
}
