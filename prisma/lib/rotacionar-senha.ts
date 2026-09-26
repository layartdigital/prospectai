/**
 * Rotacao de senha operacional: uma transacao, tres escritas, nenhum segredo em log.
 *
 * Existe desde 25/09/2026. O produto **nao tem** troca de senha — nem endpoint,
 * nem tela, nem "esqueci minha senha" (medido no GATE S0). Enquanto nao tiver,
 * a unica forma de girar uma credencial e esta, com acesso ao servidor.
 *
 * **Fica em `prisma/lib/` e nao em `apps/api`**: o unico consumidor de producao
 * e a CLI `prisma/set-senha.ts`. Nada de `apps/api` importa daqui. Quando
 * existir endpoint de troca de senha, a operacao se muda para uma camada
 * compartilhada — antes disso seria arquitetura sem consumidor.
 *
 * **O hash fica fora da transacao.** Argon2 custa centenas de milissegundos por
 * desenho; calcula-lo com a transacao aberta seguraria linha de `users` e de
 * `refresh_tokens` por todo esse tempo, sem necessidade — o hash nao depende de
 * nada que esteja sendo lido no banco.
 *
 * **As tres escritas sao uma so.** Senha nova sem revogacao deixaria sessao
 * antiga viva; revogacao sem trilha deixaria o evento invisivel; trilha sem
 * senha nova seria mentira registrada. Falha em qualquer uma desfaz as outras.
 *
 * ---
 *
 * **Correcao de precisao, 25/09/2026.** A revogacao filtrava so por
 * `revokedAt: null`, e portanto alcancava tambem linhas **ja expiradas**. Duas
 * consequencias, as duas de medicao:
 *
 * 1. o numero devolvido contava credenciais que ja nao valiam nada, e a saida da
 *    CLI o chamava de "sessoes" — repetindo exatamente a confusao entre
 *    *registro de refresh* e *sessao* que o GATE S0 obrigou a corrigir no
 *    `S0-FORENSICS`;
 * 2. linha expirada passava a ter `revokedAt` preenchido, e deixava de ser
 *    distinguivel de uma que foi revogada de verdade — apagando evidencia
 *    forense em nome de um numero maior.
 *
 * Agora o filtro e `revokedAt = null AND expiresAt > agora`, e o campo se chama
 * `tokensValidosRevogados`. **O mesmo `agora`** vai na condicao e no valor
 * gravado: com dois `new Date()` existiria uma janela, minuscula porem real, em
 * que um token selecionado como valido receberia um `revokedAt` anterior a
 * propria expiracao considerada.
 */

import type { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';

export const ACAO_ROTACAO = 'SECURITY.PASSWORD_ROTATED';

export interface EntradaDaRotacao {
  readonly email: string;
  readonly senhaNova: string;
  readonly motivo: string;
  /** De onde partiu. Hoje so existe `cli`. */
  readonly origem: string;
}

export interface ResultadoDaRotacao {
  readonly userId: string;
  readonly email: string;
  /**
   * Refresh tokens que **ainda valiam** no instante da rotacao e foram
   * revogados. Nao e contagem de sessoes: um mesmo navegador produz varias
   * linhas ao longo de uma cadeia de rotacao, e linhas expiradas nao entram.
   */
  readonly tokensValidosRevogados: number;
}

/**
 * Ganchos de teste. **Nao sao usados pela CLI** — existem para que o teste de
 * rollback provoque falha na ultima escrita sem simular o Prisma inteiro.
 */
export interface GanchosDaRotacao {
  readonly antesDaTrilha?: () => void | Promise<void>;
}

export const SENHA_MINIMA = 12;

export async function rotacionarSenha(
  prisma: PrismaClient,
  entrada: EntradaDaRotacao,
  ganchos: GanchosDaRotacao = {},
): Promise<ResultadoDaRotacao> {
  const email = entrada.email.trim().toLowerCase();
  const senha = entrada.senhaNova;

  if (senha.trim().length < SENHA_MINIMA) {
    throw new Error(`A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
  }
  if (entrada.motivo.trim().length === 0) {
    throw new Error('O motivo e obrigatorio: e ele que explica a rotacao na trilha.');
  }

  const usuario = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!usuario) throw new Error(`Nenhum usuario com o e-mail ${email}.`);

  // Fora da transacao, de proposito. Ver o cabecalho.
  const passwordHash = await argonHash(senha);

  /**
   * Um unico instante, usado na condicao e no valor gravado. Ver o cabecalho:
   * dois `new Date()` abririam janela entre "considerei valido" e "marquei como
   * revogado neste momento".
   */
  const agora = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: usuario.id },
      data: { passwordHash },
    });

    const revogadas = await tx.refreshToken.updateMany({
      where: { userId: usuario.id, revokedAt: null, expiresAt: { gt: agora } },
      data: { revokedAt: agora },
    });

    await ganchos.antesDaTrilha?.();

    /**
     * **`tenantId: null` — evento global, e nao do primeiro workspace.**
     *
     * Senha pertence ao `User`, que e global: a mesma credencial abre todos os
     * workspaces da pessoa. Carimbar o evento com um tenant qualquer inventaria
     * um vinculo que nao existe.
     *
     * A consequencia esta medida e aceita: a politica de `audit_logs` e
     * `tenantId = current_setting('app.tenant_id')`, e linha com `tenantId`
     * nulo nunca satisfaz essa comparacao. **Este evento e invisivel as trilhas
     * com escopo de tenant** — e um GLOBAL SECURITY AUDIT, lido por quem tem
     * acesso ao banco. A escrita passa porque a CLI conecta pelo
     * `DATABASE_URL_MIGRATOR`, que tem `BYPASSRLS`.
     *
     * **Nada de senha e nada de hash em `before`/`after`.** Nem fragmento, nem
     * comprimento, nem prefixo. A trilha registra que houve rotacao, quando,
     * por que, e quantos refresh tokens ainda validos foram revogados.
     */
    await tx.auditLog.create({
      data: {
        tenantId: null,
        actorId: null,
        action: ACAO_ROTACAO,
        entityType: 'User',
        entityId: usuario.id,
        before: undefined,
        after: {
          motivo: entrada.motivo.trim(),
          origem: entrada.origem,
          tokensValidosRevogados: revogadas.count,
        },
      },
    });

    return { userId: usuario.id, email, tokensValidosRevogados: revogadas.count };
  });
}
