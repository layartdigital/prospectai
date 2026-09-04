-- Verificações de fechamento da fase B do RLS.
--
-- Escritas em 04/09, depois da família 8. Mesmo princípio do
-- `verificacoes-papel-sistema.sql`: **todas são consultas ao catálogo do
-- Postgres, e o resultado não depende de haver dado nas tabelas.**
--
-- Cada uma tem denominador ou lista explícita, para que "vazio" seja uma
-- resposta distinguível de "não mediu". Isso é requisito e não elegância: na
-- verificação do passo 4, duas checagens mediam zero contra tabela vazia e
-- passavam sem provar coisa nenhuma.
--
-- ---
--
-- **A checagem 3 arma-se sozinha, e é a razão deste arquivo existir.**
--
-- Ela não pergunta "as 34 tabelas conhecidas estão protegidas" — pergunta
-- "existe alguma tabela com coluna `tenantId` que não esteja". Uma tabela nova,
-- criada daqui a seis meses por alguém que nunca leu o plano, aparece nela sem
-- que ninguém precise se lembrar de acrescentá-la a uma lista.
--
-- Uma verificação que enumera o que ela mesma espera só prova que a lista foi
-- copiada corretamente.
--
-- Rodar com:
--   docker exec -i propectai-postgres psql -U propectai -d propectai \
--     -f /tmp/verificacoes-fase-b.sql
--
-- (`docker cp` primeiro. Nunca aninhar SQL com espaços através de
-- PowerShell -> docker -> sh: as aspas não sobrevivem. Sexta ocorrência.)

\echo '=== 1. Quantas tabelas tem politica, e quantas deveriam ter ==='
-- Esperado hoje: escopadas = 34, protegidas = 34, desprotegidas = 0.
--
-- As duas primeiras colunas vêm de fontes independentes — uma conta colunas,
-- a outra conta tabelas com RLS ligado. Se divergirem, a terceira diz o
-- tamanho do buraco sem precisar de interpretação.
WITH escopadas AS (
  SELECT c.relname AS tabela
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND a.attname = 'tenantId'
     AND a.attnum > 0
     AND NOT a.attisdropped
),
protegidas AS (
  SELECT c.relname AS tabela
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relrowsecurity
)
SELECT (SELECT count(*) FROM escopadas)                             AS escopadas,
       (SELECT count(*) FROM protegidas)                            AS com_rls_ligado,
       (SELECT count(*) FROM escopadas
         WHERE tabela NOT IN (SELECT tabela FROM protegidas))        AS escopadas_sem_rls,
       (SELECT count(*) FROM protegidas
         WHERE tabela NOT IN (SELECT tabela FROM escopadas))         AS com_rls_sem_tenantid;

\echo ''
\echo '=== 2. As 8 tabelas sem tenantId, nomeadas ==='
-- Não é decoração: é a lista que alguém precisa reconhecer para saber se uma
-- tabela nova pertence legitimamente a ela. Esperado: exatamente estas oito.
--
--   users, refresh_tokens  -> a pessoa existe antes e fora do workspace
--   tenants                -> é o próprio sujeito da política
--   plans, billing_events  -> catálogo e eventos do provedor, globais
--   segments, segment_locales -> taxonomia compartilhada
--   platform_admins        -> quem administra a plataforma não pertence a tenant
SELECT c.relname AS tabela_global
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND c.relname <> '_prisma_migrations'
   AND NOT EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'tenantId'
        AND a.attnum > 0 AND NOT a.attisdropped)
 ORDER BY c.relname;

\echo ''
\echo '=== 3. Tabela escopada mal configurada — a checagem que se arma sozinha ==='
-- **Esperado: ZERO linhas.**
--
-- Ela não conhece nome de tabela nenhum. Parte de "tem coluna tenantId" e
-- cobra as quatro coisas que a fase B garantiu: RLS ligado, FORCE ligado,
-- política permissiva de base, política restritiva de isolamento.
--
-- Cada coluna diz o que falta, para que a saída seja o diagnóstico e não o
-- começo de uma investigação.
SELECT c.relname                                          AS tabela,
       c.relrowsecurity                                   AS rls_ligado,
       c.relforcerowsecurity                              AS force_ligado,
       EXISTS (SELECT 1 FROM pg_policy p
                WHERE p.polrelid = c.oid
                  AND p.polname = 'acesso_base'
                  AND p.polpermissive)                    AS tem_acesso_base,
       EXISTS (SELECT 1 FROM pg_policy p
                WHERE p.polrelid = c.oid
                  AND p.polname = 'tenant_isolamento'
                  AND NOT p.polpermissive)                AS tem_isolamento_restritivo
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'tenantId'
        AND a.attnum > 0 AND NOT a.attisdropped)
   AND NOT (
     c.relrowsecurity
     AND c.relforcerowsecurity
     AND EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = c.oid AND p.polname = 'acesso_base'
                    AND p.polpermissive)
     AND EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolamento'
                    AND NOT p.polpermissive))
 ORDER BY c.relname;

\echo ''
\echo '=== 4. As 34 politicas de isolamento sao identicas, palavra por palavra ==='
-- Esperado: **uma linha só**, com `tabelas = 34`.
--
-- Uniformidade importa quando o que é uniforme é um controle de segurança: a
-- tabela que divergisse viraria o lugar onde ninguém procura. Agrupar pelo
-- texto da expressão transforma "são todas iguais" numa contagem de linhas, e
-- não numa leitura de 34 definições.
--
-- Se aparecer mais de uma linha, a coluna `tabelas` diz de imediato qual é a
-- exceção — será a de contagem menor.
SELECT pg_get_expr(p.polqual, p.polrelid)       AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid)  AS with_check_expr,
       count(*)                                 AS tabelas
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND p.polname = 'tenant_isolamento'
 GROUP BY 1, 2
 ORDER BY tabelas DESC;

\echo ''
\echo '=== 5. A aplicacao continua nao sendo dona de tabela nenhuma ==='
-- Esperado: ZERO linhas.
--
-- `FORCE ROW LEVEL SECURITY` estende a política ao dono da tabela — e é por
-- isso que `NO FORCE` **não** é o jeito de reverter. Mas a garantia de que a
-- aplicação está sujeita à política não vem do FORCE: vem de ela não ser dona.
-- Esta checagem cobra a premissa em vez de assumi-la.
SELECT tablename AS tabela, tableowner AS dono
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tableowner IN ('propectai_app', 'propectai_sistema');

\echo ''
\echo '=== 6. proposal_items ganhou a coluna e a FK composta ==='
-- A única tabela cuja falta de `tenantId` era buraco e não desenho. Esperado:
-- uma linha, com `nao_nula = t` e a FK apontando para `(tenantId, id)`.
--
-- A FK é uma garantia **separada** da política: ela vale com o RLS desligado,
-- porque integridade referencial roda por fora do RLS por desenho do Postgres.
SELECT a.attname                                   AS coluna,
       a.attnotnull                                AS nao_nula,
       con.conname                                 AS fk,
       pg_get_constraintdef(con.oid)               AS definicao
  FROM pg_class c
  JOIN pg_namespace n   ON n.oid = c.relnamespace
  JOIN pg_attribute a   ON a.attrelid = c.oid AND a.attname = 'tenantId'
  LEFT JOIN pg_constraint con
         ON con.conrelid = c.oid
        AND con.contype = 'f'
        AND a.attnum = ANY (con.conkey)
 WHERE n.nspname = 'public'
   AND c.relname = 'proposal_items';

\echo ''
\echo '=== 7. Quantas migrations de RLS foram aplicadas ==='
-- Denominador do histórico. **Esperado hoje: 13.** Enumeradas em vez de
-- afirmadas, porque um número solto num arquivo de verificação é uma asserção
-- que ninguém consegue conferir sem refazer a contagem:
--
--    1. rls_papeis                     7. rls_familia_pipeline_religar
--    2. rls_canario_auditoria          8. rls_familia_coleta
--    3. rls_familia_pipeline           9. rls_familia_atividade
--    4. rls_pipeline_revertido        10. rls_familia_leads
--    5. rls_papel_sistema             11. rls_familia_conta
--    6. rls_papel_sistema_estreitar   12. rls_familia_operacao
--                                     13. rls_familia_comercial
--
-- A migration da coluna de `proposal_items` **não** conta aqui: ela não liga
-- política nenhuma, e é por isso que ficou num arquivo separado. O `LIKE
-- '%rls%'` a exclui pelo nome, o que é acidente feliz e não desenho — a
-- listagem acima é a garantia de verdade.
SELECT count(*) AS migrations_de_rls
  FROM _prisma_migrations
 WHERE migration_name LIKE '%rls%'
   AND finished_at IS NOT NULL;

\echo ''
\echo '=== 8. E as duas politicas por tabela, sem sobra nem falta ==='
-- Esperado: **uma linha só**, com `politicas = 2` e `tabelas = 34`.
--
-- A checagem 3 cobra que as duas existam; esta cobra que não exista uma
-- terceira. Política extra numa tabela é a forma mais silenciosa de afrouxar
-- o conjunto: PERMISSIVE combina com OR, então uma permissiva a mais abre o
-- que a restritiva fechou, sem alterar nenhuma linha do que já estava lá.
SELECT n_politicas AS politicas, count(*) AS tabelas
  FROM (
    SELECT c.oid, count(p.oid) AS n_politicas
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'tenantId'
            AND a.attnum > 0 AND NOT a.attisdropped)
     GROUP BY c.oid
  ) AS contagem
 GROUP BY n_politicas
 ORDER BY n_politicas;
