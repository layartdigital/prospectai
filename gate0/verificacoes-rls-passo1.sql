-- Verificação do passo 1 do `PLANO-RLS-v1.md`.
--
-- Rodar DEPOIS da migration. Cada consulta responde a uma pergunta que a
-- migration "aplicada com sucesso" não responde — a migration diz que os
-- comandos rodaram, não que produziram o estado certo.

\echo '=== 1. Os dois papéis existem, e só o de migration ignora RLS? ==='
-- `rolbypassrls` TRUE no `propectai_app` seria o pior resultado possível:
-- o passo 4 ligaria a política e ela não protegeria nada.
SELECT rolname,
       rolcanlogin  AS pode_logar,
       rolbypassrls AS ignora_rls,
       rolsuper     AS superusuario
FROM pg_roles
WHERE rolname IN ('propectai', 'propectai_app', 'propectai_migrator')
ORDER BY rolname;

\echo ''
\echo '=== 2. O papel da aplicação alcança as tabelas? ==='
-- Espera-se o total de tabelas do schema. Menos que isso é tabela que ficou
-- sem grant, e ela só daria "permission denied" quando alguém a usasse.
SELECT count(*) FILTER (WHERE has_table_privilege('propectai_app', c.oid, 'SELECT')) AS pode_ler,
       count(*) FILTER (WHERE has_table_privilege('propectai_app', c.oid, 'INSERT')) AS pode_inserir,
       count(*)                                                                      AS total_tabelas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

\echo ''
\echo '=== 3. E NÃO alcança o que não deve? ==='
-- A aplicação não cria nem altera tabela. Se qualquer uma destas vier `t`,
-- o grant foi largo demais.
SELECT bool_or(has_table_privilege('propectai_app', c.oid, 'TRUNCATE')) AS pode_truncar,
       bool_or(has_table_privilege('propectai_app', c.oid, 'REFERENCES')) AS pode_referenciar,
       has_schema_privilege('propectai_app', 'public', 'CREATE')          AS pode_criar_no_schema
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

\echo ''
\echo '=== 4. Tabela futura já nasce acessível? ==='
-- O privilégio padrão é o que impede a falha mais traiçoeira do conjunto: uma
-- migration futura cria tabela, ninguém repara, e meses depois uma rota nova
-- morre com "permission denied" sem ninguém ligar as duas coisas.
SELECT defaclrole::regrole AS quem_cria,
       defaclobjtype       AS tipo,
       defaclacl           AS privilegios
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public';

\echo ''
\echo '=== 5. Nada está usando os papéis ainda? ==='
-- O passo 1 não muda comportamento. Se houver conexão ativa com os papéis
-- novos, alguém pulou etapa.
SELECT usename, count(*) AS conexoes
FROM pg_stat_activity
WHERE usename IN ('propectai_app', 'propectai_migrator')
GROUP BY usename;
