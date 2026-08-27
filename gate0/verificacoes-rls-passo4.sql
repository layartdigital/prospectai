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
\echo '=== 5. A política nega de fato, aqui e agora ==='
-- Prova viva, e não leitura de catálogo. Assume o papel da aplicação sem
-- definir tenant nenhum: o correto é ZERO em ambas.
--
-- O `BEGIN` não é decoração: `SET LOCAL` fora de transação explícita **não
-- falha — não faz nada**, e o bloco inteiro rodaria como o usuário original,
-- devolvendo as contagens completas e parecendo um vazamento.
BEGIN;
SET LOCAL ROLE propectai_app;
SELECT count(*) AS auditorias_visiveis_sem_contexto FROM digital_presence_audits;
SELECT count(*) AS checagens_visiveis_sem_contexto  FROM digital_presence_checks;
COMMIT;

\echo ''
\echo '=== 6. E deixa ver com o contexto certo ==='
-- O contraponto obrigatório: um "zero" na consulta 5 também sairia com a tabela
-- vazia, ou com o banco errado. Esta separa "a política nega" de "não há nada".
--
-- **A ordem importa.** O tenant é escolhido ANTES do `SET LOCAL ROLE`, ainda
-- como superusuário — depois de assumir o papel da aplicação, essa mesma
-- consulta já estaria sob a política e devolveria NULL, e o `set_config`
-- receberia NULL. O resultado seria zero, sempre, e pareceria falha da
-- política.
BEGIN;
SELECT coalesce((SELECT "tenantId" FROM digital_presence_audits LIMIT 1),
                '(nenhuma auditoria no banco)') AS tenant_alvo \gset
SELECT set_config('app.tenant_id', :'tenant_alvo', true) AS contexto_definido;
SET LOCAL ROLE propectai_app;
SELECT count(*) AS auditorias_visiveis_com_contexto FROM digital_presence_audits;
COMMIT;

\echo ''
\echo 'Esperado: 5 devolve 0 e 0; 6 devolve pelo menos 1, desde que exista'
\echo 'auditoria no banco. Se 6 der 0 com "(nenhuma auditoria no banco)" em'
\echo 'tenant_alvo, rode um pnpm audit:e2e antes e repita.'
