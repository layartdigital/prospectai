-- Plano deixa de ser enum e passa a ser dado.
--
-- Ver `docs/strategic/lacunas-estruturais.md` §11.1. O Master precisa criar e
-- desativar plano; enum do Postgres transformaria cada plano novo em migration
-- mais deploy, o que torna a tela de planos impossivel de escrever.
--
-- ---------------------------------------------------------------------------
-- Por que este arquivo foi escrito a mao
-- ---------------------------------------------------------------------------
--
-- O Prisma gerou `DROP COLUMN "code"` seguido de `ADD COLUMN "code" TEXT NOT
-- NULL`, que e a unica coisa que ele sabe fazer quando nao conhece um cast. A
-- versao dele falha com 23502 em tabela populada — e falhar foi sorte: se a
-- tabela estivesse vazia, teria passado limpo e apagado o `code` de todos os
-- planos, desligando cada assinatura da sua linha.
--
-- O cast enum -> text existe no Postgres desde sempre. So precisa ser dito.
--
-- O indice unico e recriado por seguranca: o DROP COLUMN da tentativa anterior
-- o teria levado junto, e `CREATE UNIQUE INDEX` sem `IF NOT EXISTS` falharia
-- se ele tivesse sobrevivido.
--
-- Nao ha `DROP TYPE "PlanCode"` aqui. O enum continua declarado no schema,
-- orfao, enquanto as assinaturas de metodo migram para `string`. Sai no passo
-- 5 do §11.1.

ALTER TABLE "plans"
  ALTER COLUMN "code" SET DATA TYPE TEXT USING "code"::text;

DROP INDEX IF EXISTS "plans_code_key";
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");
