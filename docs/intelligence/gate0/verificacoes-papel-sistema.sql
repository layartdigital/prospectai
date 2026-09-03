-- Verificações do papel `propectai_sistema`.
--
-- Todas são consultas ao catálogo do Postgres: **o resultado não depende de
-- haver dado nas tabelas**. Isso é requisito, não elegância — na verificação do
-- passo 4 duas checagens mediam zero contra tabela vazia e passavam sem provar
-- nada.
--
-- Cada uma tem denominador ou lista explícita, para que "vazio" seja uma
-- resposta distinguível de "não mediu".

\echo '=== 1. O papel existe, e com os atributos certos ==='
-- Esperado: uma linha. bypassrls = t, superusuario = f, cria_papel = f.
-- Superusuário seria pior que BYPASSRLS: ignoraria também os GRANT abaixo,
-- e a enumeração de tabelas viraria decoração.
SELECT rolname          AS papel,
       rolbypassrls     AS bypassrls,
       rolsuper         AS superusuario,
       rolcreaterole    AS cria_papel,
       rolcreatedb      AS cria_banco,
       rolcanlogin      AS pode_logar
  FROM pg_roles
 WHERE rolname IN ('propectai_app', 'propectai_migrator', 'propectai_sistema')
 ORDER BY rolname;

\echo ''
\echo '=== 2. A escalada NAO e alcancavel a partir da aplicacao ==='
-- **A verificacao mais importante do arquivo.**
--
-- Se `propectai_app` for membro de `propectai_sistema`, um `SET ROLE` em
-- qualquer trecho de codigo escala privilegio, e toda a separacao vira
-- convencao. Esperado: ZERO linhas.
--
-- A consulta olha os dois sentidos de propósito: herdar para cima é o risco
-- óbvio, e o inverso indicaria alguém tentando "simplificar" a configuração.
SELECT m.rolname   AS membro,
       g.rolname   AS pertence_a
  FROM pg_auth_members am
  JOIN pg_roles m ON m.oid = am.member
  JOIN pg_roles g ON g.oid = am.roleid
 WHERE (m.rolname = 'propectai_app'      AND g.rolname = 'propectai_sistema')
    OR (m.rolname = 'propectai_sistema'  AND g.rolname = 'propectai_app');

\echo ''
\echo '=== 3. O alcance, com denominador ==='
-- Quantas tabelas o papel enxerga, sobre o total do schema.
--
-- Esperado: **11** para o `propectai_sistema`, e o total do schema para o
-- `propectai_app`. O denominador e o que torna o numero legivel: "11" sozinho
-- nao diz se e pouco.
--
-- O total inclui `_prisma_migrations`, que e tabela de controle do Prisma e nao
-- do modelo — entao ele fica um acima da contagem de modelos do schema. Nao
-- corrijo isso na consulta de proposito: preferir o numero que o banco de fato
-- tem a um numero ajustado para bater com a expectativa.
SELECT grantee                                   AS papel,
       count(DISTINCT table_name)                AS tabelas_alcancadas,
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
                                                 AS tabelas_no_schema
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND grantee IN ('propectai_app', 'propectai_sistema')
 GROUP BY grantee
 ORDER BY grantee;

\echo ''
\echo '=== 4. O que exatamente ele alcanca, e com que operacoes ==='
-- Esperado: 11 linhas. Leitura em todas; escrita apenas em tenants,
-- subscriptions, audit_logs e refresh_tokens. Nenhum DELETE em lugar nenhum.
SELECT table_name                                        AS tabela,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS operacoes
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND grantee = 'propectai_sistema'
 GROUP BY table_name
 ORDER BY table_name;

\echo ''
\echo '=== 5. O dado do cliente esta fora do alcance ==='
-- A afirmacao que justifica enumerar os GRANT em vez de usar ON ALL TABLES.
--
-- Cada tabela aparece com o numero de privilegios que o papel tem sobre ela.
-- Esperado: sete linhas, **todas com zero**.
--
-- A consulta parte da lista de tabelas (LEFT JOIN), e nao dos privilegios: se
-- partisse dos privilegios, zero linhas seria o resultado de sucesso E o
-- resultado de ter escrito o nome da tabela errado. Aqui um nome errado
-- aparece como linha faltando.
SELECT t.tabela,
       count(g.privilege_type) AS privilegios_do_sistema
  FROM (VALUES ('leads'), ('lead_notes'), ('lead_contact_records'),
               ('proposals'), ('contracts'), ('outreach_messages'),
               ('digital_presence_audits')) AS t(tabela)
  LEFT JOIN information_schema.role_table_grants g
         ON g.table_name = t.tabela
        AND g.table_schema = 'public'
        AND g.grantee = 'propectai_sistema'
 GROUP BY t.tabela
 ORDER BY t.tabela;

\echo ''
\echo '=== 6. Ele nao e dono de tabela nenhuma ==='
-- Mesmo cinto e suspensorio do `propectai_app`: dono ignora politica por
-- padrao, independentemente de BYPASSRLS. Esperado: ZERO linhas.
SELECT tablename AS tabela, tableowner AS dono
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tableowner IN ('propectai_app', 'propectai_sistema');

\echo ''
\echo '=== 7. Tabela nova nao entra sozinha ==='
-- Nao ha ALTER DEFAULT PRIVILEGES para o sistema, de proposito: tabela criada
-- por migration futura nasce invisivel a ele, e o sintoma e `permission denied`
-- em vez de alcance crescendo em silencio.
--
-- Lista **todos** os privilegios padrao do schema, sem filtrar. Esperado: os do
-- passo 1 aparecem citando `propectai_app` e `propectai_migrator`, e a coluna
-- `cita_sistema` vem `f` em todas as linhas.
--
-- Sem filtro de proposito. Uma consulta que filtrasse por `propectai_sistema`
-- devolveria zero linhas tanto no caso bom quanto no caso em que a migration do
-- passo 1 nunca rodou — e os dois pareceriam iguais na tela.
SELECT pg_get_userbyid(d.defaclrole)                              AS concedido_por,
       d.defaclobjtype                                            AS tipo,
       array_to_string(d.defaclacl, ' ')                          AS privilegios_padrao,
       array_to_string(d.defaclacl, ' ') LIKE '%propectai_sistema%' AS cita_sistema
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
 WHERE n.nspname = 'public'
 ORDER BY concedido_por, tipo;
