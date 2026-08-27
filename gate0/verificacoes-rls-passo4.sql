-- Verificação do passo 4 do `PLANO-RLS-v1.md`.
--
-- Rodar como `propectai` (o dono), DEPOIS da migration. A migration diz que os
-- comandos rodaram; estas consultas dizem se produziram o estado certo.
--
--   psql -U propectai -d propectai -f gate0/verificacoes-rls-passo4.sql

\echo '=== 1. As duas tabelas estão com RLS ligado E forçado? ==='
-- `relrowsecurity` sem `relforcerowsecurity` é o pior estado do conjunto:
-- parece protegido, e não protege ninguém que conecte como dono.
SELECT c.relname                AS tabela,
       c.relrowsecurity         AS rls_ligado,
       c.relforcerowsecurity    AS rls_forcado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('digital_presence_audits', 'digital_presence_checks')
ORDER BY c.relname;

\echo ''
\echo '=== 2. Duas políticas por tabela, e a de tenant é RESTRICTIVE? ==='
-- `permissive = 'PERMISSIVE'` na `tenant_isolamento` significa que uma política
-- futura pode anular o isolamento por OR, sem erro e sem sintoma.
SELECT tablename,
       policyname,
       permissive,
       cmd,
       qual        AS clausula_using,
       with_check  AS clausula_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('digital_presence_audits', 'digital_presence_checks')
ORDER BY tablename, policyname;

\echo ''
\echo '=== 3. Nenhuma outra tabela foi ligada por engano ==='
-- O canário são duas tabelas. Qualquer outra aqui é passo 6 acontecendo sem
-- ninguém ter decidido — e sem as fixtures dos testes daquela família terem
-- sido migradas para o papel de migration.
SELECT c.relname AS tabela_com_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity
  AND c.relname NOT IN ('digital_presence_audits', 'digital_presence_checks');

\echo ''
\echo '=== 4. O papel da aplicação continua sem BYPASSRLS ==='
-- Repetido do passo 1 de propósito: é a única linha que, se mudar, faz todo o
-- resto deste arquivo passar sem significar nada.
--
-- Repare no `propectai`: ele é SUPERUSUÁRIO, e superusuário ignora RLS
-- independentemente de `FORCE`. Ou seja, **a proteção inteira depende de a
-- aplicação não conectar com ele** — que é o que o `DATABASE_URL_APP` decide, e
-- o que o primeiro teste do `rls-canario.spec.ts` confere.
SELECT rolname, rolbypassrls AS ignora_rls, rolsuper AS superusuario
FROM pg_roles
WHERE rolname IN ('propectai', 'propectai_app', 'propectai_migrator')
ORDER BY rolname;

\echo ''
\echo '=== 5. A política entra no plano da consulta ==='
-- **Esta é a prova que não depende de haver dado.** As contagens da consulta 6
-- ficam mudas com a tabela vazia — e a tabela fica vazia sempre que a suíte
-- roda, porque ela limpa os tenants no `afterAll`.
--
-- O `EXPLAIN` não tem esse problema: se a política estiver no caminho, ela
-- aparece como `Filter` no plano, com zero linhas ou com um milhão. Se não
-- aparecer, não há política aplicada a este papel — e aí nada mais importa.
--
-- Procure por: Filter: ("tenantId" = current_setting('app.tenant_id'::text, true))
--
-- O `BEGIN` não é decoração: `SET LOCAL` fora de transação explícita **não
-- falha — não faz nada**, e o bloco rodaria como o usuário original.
BEGIN;
SET LOCAL ROLE propectai_app;
EXPLAIN (COSTS OFF) SELECT * FROM digital_presence_audits;
EXPLAIN (COSTS OFF) SELECT * FROM digital_presence_checks;
COMMIT;

\echo ''
\echo '=== 6. E nega de fato — com denominador ==='
-- **A contagem sozinha não prova nada, e foi assim que este arquivo errou na
-- primeira versão.** "Zero visível sem contexto" sai igual com a política
-- ligada e com a tabela vazia. O que separa os dois casos é o denominador: o
-- total real, contado como superusuário, que ignora RLS.
--
--   total_real > 0 e visiveis_sem_contexto = 0  -> a política negou
--   total_real = 0                              -> esta consulta não prova nada
--
-- Com a tabela vazia, quem prova é o `apps/worker/test/rls-canario.spec.ts`:
-- ele monta a linha, vê 1 com contexto e 0 sem, na mesma execução. Rodar um
-- `pnpm audit:e2e` antes daqui também não resolve — ele limpa no `finally`.
BEGIN;
SELECT count(*) AS total_real_auditorias FROM digital_presence_audits;
SELECT count(*) AS total_real_checagens  FROM digital_presence_checks;
SET LOCAL ROLE propectai_app;
SELECT count(*) AS visiveis_sem_contexto_auditorias FROM digital_presence_audits;
SELECT count(*) AS visiveis_sem_contexto_checagens  FROM digital_presence_checks;
COMMIT;

\echo ''
\echo 'Esperado: 5 mostra o Filter da política nos dois planos — e este é o'
\echo 'resultado que vale sempre. Na 6, compare com o total real: os dois zeros'
\echo 'só significam alguma coisa se o total real for maior que zero.'
