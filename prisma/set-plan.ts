/**
 * Troca o plano do tenant de demonstração.
 *
 * Existe para exercitar os feature gates dos dois lados sem editar o banco
 * à mão. Só age em tenants marcados com `isDemo: true`.
 *
 * Uso:
 *   pnpm db:plan free           telefone mascarado, sem IA, sem pipeline
 *   pnpm db:plan start          150 leads, 50 gerações de IA, CSV
 *   pnpm db:plan pro            500 leads, 300 gerações, CSV e Excel
 *   pnpm db:plan agency         3.000 leads, 2.000 gerações
 *   pnpm db:plan pro --reset    troca o plano e zera o consumo
 *   pnpm dev:unlock             atalho para agency + reset
 *
 * A lista aceita sai do banco: `pnpm db:plan` sem argumento imprime os
 * códigos cadastrados, inclusive os criados pelo Master.
 *
 * Por que não deixar tudo liberado sempre: os gates são regra de produto.
 * Um ambiente que roda permanentemente como AGENCY nunca exercita o
 * mascaramento de telefone nem o bloqueio de IA — e o bug só aparece em
 * produção, que é tarde.
 */

import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requested = (args[0] ?? '').toUpperCase();
  const shouldReset = args.includes('--reset');

  // A lista de planos válidos é o banco, não uma constante.
  //
  // Antes havia um `VALID` de quatro literais aqui. Com o Master criando
  // plano, esse script recusaria justamente o plano novo — e a mensagem de
  // erro diria "informe um plano válido" sobre um plano que existe.
  const planos = await prisma.plan.findMany({
    select: { code: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (planos.length === 0) {
    console.log('\n  Nenhum plano cadastrado. Rode `pnpm db:seed` antes.\n');
    process.exitCode = 1;
    return;
  }

  const plan = requested
    ? planos.find((p) => p.code === requested)
    : undefined;

  if (!plan) {
    const lista = planos.map((p) => p.code.toLowerCase()).join(', ');
    console.log(`\n  Informe um plano válido: ${lista}`);
    console.log('  Exemplo: pnpm db:plan pro --reset\n');
    process.exitCode = 1;
    return;
  }

  const planoCompleto = await prisma.plan.findUniqueOrThrow({
    where: { code: plan.code },
  });

  const tenants = await prisma.tenant.findMany({
    where: { isDemo: true, deletedAt: null },
    select: { id: true, name: true },
  });

  if (tenants.length === 0) {
    console.log('\n  Nenhum tenant de demonstração encontrado. Rode `pnpm db:seed`.\n');
    process.exitCode = 1;
    return;
  }

  for (const tenant of tenants) {
    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, planId: planoCompleto.id, status: 'ACTIVE' },
      update: { planId: planoCompleto.id, status: 'ACTIVE' },
    });
  }

  if (shouldReset) {
    await prisma.planUsage.updateMany({
      where: { tenantId: { in: tenants.map((tenant) => tenant.id) } },
      data: { leadsReserved: 0, leadsSettled: 0, aiGenerationsCount: 0 },
    });
  }

  const limits = planoCompleto.limits as Record<string, unknown>;

  console.log(`\n  Plano alterado para ${requested}`);
  console.log('  ──────────────────────────────');
  for (const tenant of tenants) console.log(`  ${tenant.name}`);
  console.log('');
  console.log(`  Leads incluídos      ${String(limits.leadsIncluded)}`);
  console.log(`  Gerações de IA/mês   ${String(limits.aiGenerationsPerMonth)}`);
  console.log(`  Telefone mascarado   ${limits.maskPhones ? 'sim' : 'não'}`);
  console.log(`  Pipeline liberado    ${limits.pipelineEnabled ? 'sim' : 'não'}`);
  console.log(`  Exportação           ${(limits.exportFormats as string[]).join(', ') || 'nenhuma'}`);
  if (shouldReset) console.log('\n  Consumo zerado.');
  console.log('\n  Recarregue a página para ver a mudança.\n');
}

main()
  .catch((error: unknown) => {
    console.error('Falha ao trocar o plano:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
