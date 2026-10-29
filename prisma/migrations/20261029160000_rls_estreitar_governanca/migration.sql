-- DB-REM-02 e DB-REM-03 — auditoria SEC-DB-01 (28–29/10/2026).
--
-- Estreita o que a `20260826230000_rls_papeis` concedeu de forma ampla. Aquela
-- migration deu ao `propectai_app` DML em **todas** as tabelas e ao
-- `propectai_migrator` **ALL** — inclusive para as tabelas futuras, via
-- `ALTER DEFAULT PRIVILEGES`. As duas decisões estavam certas para o que se
-- sabia então; esta corrige só o que a auditoria mediu como sem uso.
--
-- **Nada muda para quem usa estes privilégios hoje.** Medido em `bbf977f`:
--
--   * nenhuma escrita em `platform_admins`, `segments` ou `_prisma_migrations`
--     a partir de `apps/*/src`, nem aninhada;
--   * nenhum `TRUNCATE`, `CREATE TRIGGER` ou `REFERENCES` em SQL fora das
--     migrations — as fixtures limpam com `deleteMany`, que é `DELETE`.
--
-- Quem escreve nessas três tabelas continua escrevendo: os scripts
-- `set-platform-admin` e `import-segments` conectam pelo migrator, que mantém
-- DML, e o `prisma migrate` conecta como dono.
--
-- As duas regras ficam guardadas pelo portão de CI
-- (`docs/intelligence/gate0/gate-rls.sql`, checagens 7 e 8), e não por esta
-- migration: uma tabela nova sem RLS que nasça gravável pelo runtime, ou um
-- `GRANT` que devolva o TRUNCATE, derruba o build.

-- ---------------------------------------------------------------------------
-- DB-REM-02 — o runtime não escreve nas tabelas de governança
-- ---------------------------------------------------------------------------
--
-- `SELECT` permanece: o `PlatformAdminGuard` lê `platform_admins`, e a
-- aplicação lê `segments`.
--
-- **Os default privileges do runtime não mudam**, por decisão de 29/10 (opção
-- a): tabela nova continua nascendo com DML para a aplicação, porque quase toda
-- tabela nova é de tenant e fica protegida pela política. A exceção — tabela
-- sem RLS — é o que a checagem 7 do portão obriga alguém a decidir.
REVOKE INSERT, UPDATE, DELETE ON TABLE platform_admins, segments, _prisma_migrations FROM propectai_app;

-- ---------------------------------------------------------------------------
-- DB-REM-03 — o migrator não precisa truncar, nem criar trigger ou FK
-- ---------------------------------------------------------------------------
--
-- Ele mantém SELECT, INSERT, UPDATE, DELETE e `BYPASSRLS`: o seed, os scripts,
-- as fixtures e as migrations de dado sob `FORCE` dependem disso (motivo na
-- própria `rls_papeis`).
--
-- **Aqui o default privilege precisa mudar junto.** Revogar só nas tabelas
-- existentes não basta: a próxima tabela criada pelo dono receberia de volta
-- o `ALL`, e com ele o TRUNCATE.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM propectai_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE propectai IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM propectai_migrator;
