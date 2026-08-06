/**
 * Devolve o saldo de leads do tenant de demonstração.
 *
 * Existe para testar o ciclo de prospecção sem precisar mexer no banco à mão.
 * Só age em tenants marcados com `isDemo: true` — nunca em dados reais.
 *
 * Uso: pnpm db:reset-quota
 */

import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const demoTenants = await prisma.tenant.findMany({
    where: { isDemo: true, deletedAt: null },
    select: { id: true, name: true },
  });

  if (demoTenants.length === 0) {
    console.log('\n  Nenhum tenant de demonstração encontrado. Rode `pnpm db:seed` antes.\n');
    return;
  }

  const result = await prisma.planUsage.updateMany({
    where: { tenantId: { in: demoTenants.map((tenant) => tenant.id) } },
    data: { leadsReserved: 0, leadsSettled: 0 },
  });

  console.log('\n  Saldo de leads devolvido');
  console.log('  ────────────────────────');
  for (const tenant of demoTenants) {
    console.log(`  ${tenant.name}`);
  }
  console.log(`\n  ${result.count} período(s) zerado(s).\n`);
}

main()
  .catch((error: unknown) => {
    console.error('Falha ao devolver o saldo:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
