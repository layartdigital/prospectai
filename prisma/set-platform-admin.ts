/**
 * Promove ou remove um operador da plataforma.
 *
 * Existe como script, e não como tela, de propósito. Uma interface que promove
 * operador seria o alvo mais valioso do sistema inteiro: comprometer uma conta
 * de dono e clicar num botão daria acesso a todos os tenants. Exigir acesso ao
 * servidor eleva o custo do ataque de "roubar uma senha" para "entrar na
 * infraestrutura".
 *
 * Uso:
 *   pnpm db:admin add pessoa@empresa.com "Operacao Layart"
 *   pnpm db:admin remove pessoa@empresa.com
 *   pnpm db:admin list
 */

import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [acao, email, nota] = process.argv.slice(2);

  if (acao === 'list') {
    const admins = await prisma.platformAdmin.findMany({ include: { user: true } });

    console.log('\n  Operadores da plataforma');
    console.log('  ─────────────────────────');
    if (admins.length === 0) console.log('  (nenhum)');
    for (const admin of admins) {
      console.log(`  ${admin.user.email}${admin.note ? `  ·  ${admin.note}` : ''}`);
    }
    console.log('');
    return;
  }

  if (!email || (acao !== 'add' && acao !== 'remove')) {
    console.log('\n  Uso:');
    console.log('    pnpm db:admin add pessoa@empresa.com "motivo"');
    console.log('    pnpm db:admin remove pessoa@empresa.com');
    console.log('    pnpm db:admin list\n');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (!user) {
    console.log(`\n  Nenhum usuário com o e-mail ${email}.`);
    console.log('  A pessoa precisa ter conta antes de virar operador.\n');
    process.exitCode = 1;
    return;
  }

  if (acao === 'remove') {
    const restantes = await prisma.platformAdmin.count({
      where: { userId: { not: user.id } },
    });

    // Plataforma sem operador é plataforma que ninguém administra, e a saída
    // seria rodar este mesmo script — que exige acesso ao servidor. Barrar
    // aqui evita descobrir isso no pior momento.
    if (restantes === 0) {
      console.log('\n  Este é o último operador da plataforma.');
      console.log('  Promova outra pessoa antes de remover.\n');
      process.exitCode = 1;
      return;
    }

    await prisma.platformAdmin.deleteMany({ where: { userId: user.id } });
    console.log(`\n  ${email} não é mais operador da plataforma.\n`);
    return;
  }

  await prisma.platformAdmin.upsert({
    where: { userId: user.id },
    create: { userId: user.id, note: nota ?? null },
    update: { note: nota ?? null },
  });

  console.log(`\n  ${email} agora é operador da plataforma.`);
  console.log('  Acesso em /admin. Isto não dá acesso a workspace nenhum —');
  console.log('  para entrar num tenant continua sendo preciso ter membership.\n');
}

main()
  .catch((error: unknown) => {
    console.error('Falha:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
