-- DB-REM-06 — auditoria SEC-DB-01, achado .D (30/10/2026).
--
-- As migrations deixam de rodar como superusuário. Esta é a **última** que
-- roda como `propectai`: ela cria o papel `propectai_dono`, passa a ele a posse
-- de tudo no schema `public` e prepara os default privileges dele. Daqui para
-- frente, em produção, o `ops` aplica migration como `propectai_dono`.
--
-- **Nada muda para a aplicação.** `api` e `worker` conectam como
-- `propectai_app` e `propectai_sistema`, cujos grants são preservados — o
-- `ALTER … OWNER` só reescreve o concedente (`propectai_app=arwd/propectai`
-- vira `propectai_app=arwd/propectai_dono`). Medido em protótipo PG 16 em
-- 30/10, com as 33 migrations anteriores; portão de RLS 1–8 inalterado.
--
-- =============================================================================
-- Por que um papel novo, e não rebaixar o `propectai`
-- =============================================================================
--
-- O `propectai` é o superusuário **bootstrap** do cluster (dono de
-- `template0/1`). O PG 16 não deixa tirar o SUPERUSER dele, e `REASSIGN OWNED`
-- falha nos objetos que o sistema exige. Por isso a posse é transferida objeto
-- por objeto, abaixo.
--
-- =============================================================================
-- Os atributos do papel, um por um
-- =============================================================================
--
--   NOSUPERUSER  sem `COPY … TO PROGRAM`, sem `ALTER SYSTEM`, sem ler os outros
--                bancos do cluster — o motivo desta migration.
--   NOCREATEROLE migration que precise criar papel falha **com erro**, e o passo
--                vira operação de emergência pelo superusuário. Precedente: 2
--                das 33 migrations anteriores criaram papel.
--   NOCREATEDB   ninguém cria banco por migration.
--   BYPASSRLS    **obrigatório.** 34 tabelas têm `FORCE ROW LEVEL SECURITY`, que
--                vale também para o dono. Sem isto, uma migration de dado
--                (`UPDATE` sem `app.tenant_id`) afetaria zero linhas **sem
--                erro**. Hoje o dono é superusuário e passa por cima; o dono
--                novo precisa passar também. O migrator já tem o mesmo atributo
--                pelo mesmo motivo (`rls_papeis`).
--
-- O papel nasce **sem senha**: ela é definida na operação, como a dos outros
-- três (`ATUALIZAR-AMBIENTE-ONLINE.md` §4), e nunca passa por arquivo versionado.
--
-- =============================================================================
-- O que fica com o superusuário
-- =============================================================================
--
-- Os default privileges `FOR ROLE propectai` (da `rls_papeis`, estreitados no
-- DB-REM-03) **ficam**: se um dia algo for criado em emergência pelo
-- superusuário, a aplicação continua recebendo grant. A checagem 9 do portão
-- acusa o objeto criado assim, para que a posse seja corrigida.
--
-- Instalação do zero (dev, CI) continua aplicando as migrations anteriores como
-- superusuário — elas criam papéis. O CI aplica esta e as anteriores como
-- `propectai`, e as seguintes como `propectai_dono`, igual à produção.
--
-- ⚠ `GRANT CONNECT ON DATABASE` rodado pelo dono não dá erro, só o aviso "no
-- privileges were granted" (ele não é dono do banco). É inofensivo — `CONNECT` é
-- público neste banco (`=Tc`, medido em 30/10) —, mas não conte com ele.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'propectai_dono') THEN
    EXECUTE 'CREATE ROLE propectai_dono LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS';
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO propectai_dono', current_database());
END $$;

-- O schema `public` é de `pg_database_owner` (PG 15+): só o dono do banco cria
-- nele. O papel novo precisa de CREATE explícito.
GRANT USAGE, CREATE ON SCHEMA public TO propectai_dono;

-- ---------------------------------------------------------------------------
-- Posse — tabelas primeiro: o `ALTER TABLE … OWNER` leva junto os índices e as
-- sequences ligadas por OWNED BY.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS obj
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND c.relowner <> 'propectai_dono'::regrole
  LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO propectai_dono', r.obj);
  END LOOP;
END $$;

-- O resto, consultado de novo depois das tabelas. Em 30/10 não havia nenhum
-- destes (medido em produção: 43 tabelas, 137 índices, 26 enums, 0 funções);
-- os laços existem para a migration não depender dessa contagem.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS obj, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('S', 'v', 'm', 'f', 'c')
       AND c.relowner <> 'propectai_dono'::regrole
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO propectai_dono',
      CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                     WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE'
                     ELSE 'TYPE' END,
      r.obj);
  END LOOP;

  FOR r IN
    SELECT t.oid::regtype AS obj
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
       AND t.typowner <> 'propectai_dono'::regrole
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO propectai_dono', r.obj);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS obj
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proowner <> 'propectai_dono'::regrole
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO propectai_dono', r.obj);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Default privileges do dono novo — os mesmos de hoje para o `propectai`,
-- depois do DB-REM-03: o app ganha DML em tabela nova (quase toda tabela nova é
-- de tenant, protegida pela política; a exceção é a checagem 7 do portão), e o
-- migrator ganha DML **sem** TRUNCATE, TRIGGER e REFERENCES (checagem 8).
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE propectai_dono IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO propectai_app;
ALTER DEFAULT PRIVILEGES FOR ROLE propectai_dono IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO propectai_app;
ALTER DEFAULT PRIVILEGES FOR ROLE propectai_dono IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO propectai_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE propectai_dono IN SCHEMA public
  GRANT ALL ON SEQUENCES TO propectai_migrator;

-- ---------------------------------------------------------------------------
-- Conferência: nada pode sobrar com outro dono. Falhar aqui desfaz a migration
-- inteira, em vez de deixar a posse pela metade.
-- ---------------------------------------------------------------------------
DO $$
DECLARE sobra int;
BEGIN
  SELECT count(*) INTO sobra FROM (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'i', 'I', 'S', 'v', 'm', 'f', 'c')
       AND c.relowner <> 'propectai_dono'::regrole
    UNION ALL
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
       AND t.typowner <> 'propectai_dono'::regrole
    UNION ALL
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proowner <> 'propectai_dono'::regrole
  ) x;
  IF sobra > 0 THEN
    RAISE EXCEPTION 'DB-REM-06: % objeto(s) do schema public ainda com outro dono.', sobra;
  END IF;
END $$;
