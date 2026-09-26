/**
 * Troca a senha de um usuario e derruba todas as sessoes dele.
 *
 * Existe como script, e nao como tela, pelo mesmo motivo do
 * `set-platform-admin.ts`: enquanto o produto nao tiver troca de senha, uma
 * rotacao exige acesso ao servidor, e nao apenas acesso a uma conta.
 *
 * Uso:
 *   pnpm db:senha pessoa@empresa.com "motivo da rotacao"
 *
 * A senha **nao vai na linha de comando**. Ela e lida do stdin, e isso e
 * seguranca, nao estilo: argumento de comando aparece no historico do shell, no
 * `ps` de qualquer processo da maquina e nos logs de auditoria do sistema.
 *
 *   - Terminal: pergunta duas vezes, sem eco, e compara.
 *   - Cano (`echo ... | pnpm db:senha ...`): le uma linha e segue.
 *
 * O que nunca sai daqui: a senha, o hash, ou qualquer pedaco dos dois.
 */

import path from 'node:path';
import readline from 'node:readline';

import dotenv from 'dotenv';

import { criarPrismaScript } from './cliente';
import { rotacionarSenha } from './lib/rotacionar-senha';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = criarPrismaScript();

/** Le uma linha do stdin sem eco quando ha terminal; do cano quando nao ha. */
function lerSegredo(rotulo: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (pedaco: string) => {
        buffer += pedaco;
      });
      process.stdin.on('end', () => resolve(buffer.split('\n')[0] ?? ''));
      process.stdin.on('error', reject);
    });
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  return new Promise((resolve) => {
    const saida = process.stdout as NodeJS.WriteStream & { muted?: boolean };
    // `_writeToOutput` e o ponto onde o readline ecoa. Silencia-lo e a forma
    // suportada de esconder a digitacao sem reimplementar o terminal.
    const rlInterno = rl as unknown as { _writeToOutput: (texto: string) => void };
    const escreverOriginal = rlInterno._writeToOutput.bind(rl);
    rlInterno._writeToOutput = (texto: string) => {
      if (saida.muted) return;
      escreverOriginal(texto);
    };

    rl.question(`${rotulo}: `, (resposta) => {
      saida.muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(resposta);
    });
    saida.muted = true;
  });
}

async function main(): Promise<void> {
  const [email, motivo] = process.argv.slice(2);

  if (!email || !motivo) {
    console.log('\n  Uso:');
    console.log('    pnpm db:senha pessoa@empresa.com "motivo da rotacao"');
    console.log('\n  A senha e lida do stdin, nunca por argumento.\n');
    process.exitCode = 1;
    return;
  }

  const senha = await lerSegredo('Senha nova');

  if (process.stdin.isTTY) {
    const confirmacao = await lerSegredo('Repita a senha');
    if (senha !== confirmacao) {
      console.error('  As duas digitacoes nao conferem. Nada foi alterado.');
      process.exitCode = 1;
      return;
    }
  }

  const resultado = await rotacionarSenha(prisma, {
    email,
    senhaNova: senha,
    motivo,
    origem: 'cli',
  });

  console.log(`\n  Senha trocada: ${resultado.email}`);
  // "Refresh tokens validos revogados", e nao "Sessoes revogadas": linha de
  // refresh nao e sessao — uma cadeia de rotacao produz varias para o mesmo
  // navegador — e expirada nao e revogada. Ver `prisma/lib/rotacionar-senha.ts`.
  console.log(`  Refresh tokens validos revogados: ${resultado.tokensValidosRevogados}`);
  console.log('  Trilha: SECURITY.PASSWORD_ROTATED (evento global, tenantId nulo)\n');
}

main()
  .catch((erro: unknown) => {
    console.error(`  ${erro instanceof Error ? erro.message : String(erro)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
