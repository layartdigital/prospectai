-- Portão de RLS — as mesmas perguntas do `verificacoes-fase-b.sql`, mas que
-- **derrubam o build** em vez de imprimir uma tabela.
--
-- Escrito em 04/09, junto com o primeiro CI do projeto.
--
-- =====================================================================
-- Por que dois arquivos, e não um
-- =====================================================================
--
-- O `verificacoes-fase-b.sql` imprime resultados para uma pessoa ler. Isso é
-- exatamente o que se quer em diagnóstico — as colunas dizem *o que* está no
-- lugar, e não só que algo quebrou.
--
-- E é inútil como gatilho: `psql` sai com código 0 tendo imprimido qualquer
-- coisa, inclusive "34 escopadas, 12 protegidas". Um relatório que ninguém abre
-- é indistinguível de um relatório que passa.
--
-- Este arquivo faz as mesmas perguntas e **lança exceção** quando a resposta é
-- errada. Rodar com `-v ON_ERROR_STOP=1`, senão o `psql` continua depois da
-- exceção e ainda sai com 0.
--
-- Os dois rodam no CI, nesta ordem: primeiro o portão, depois o relatório — e o
-- relatório roda mesmo com o portão vermelho, porque é aí que ele serve.
--
-- =====================================================================
-- O que é gatilho, e o que deliberadamente não é
-- =====================================================================
--
-- **Nenhuma asserção aqui menciona um nome de tabela, nem uma contagem.**
--
-- Um portão que exigisse "34 tabelas escopadas" ficaria vermelho no dia em que
-- alguém acrescentasse uma tabela legítima — e a correção seria editar o número,
-- que é o gesto que ensina a tratar o portão como obstáculo. Pior: passaria a
-- exigir manutenção justamente de quem não conhece o programa de RLS.
--
-- As asserções são estruturais: *toda* tabela com `tenantId` precisa das quatro
-- garantias, *todas* as políticas de isolamento precisam ser o mesmo texto. Uma
-- tabela nova entra na verificação sozinha, e o portão só fica vermelho quando
-- ela está de fato desprotegida.
--
-- Rodar localmente:
--   docker cp docs/intelligence/gate0/gate-rls.sql propectai-postgres:/tmp/
--   docker exec -i propectai-postgres psql -U propectai -d propectai \
--     -v ON_ERROR_STOP=1 -f /tmp/gate-rls.sql

\echo '--- portao de RLS ---'

-- =====================================================================
-- 1. Toda tabela escopada tem as quatro garantias
-- =====================================================================
--
-- RLS ligado, FORCE ligado, `acesso_base` permissiva, `tenant_isolamento`
-- restritiva. A mensagem nomeia as tabelas em falta: um portão que só diz
-- "falhou" transfere o diagnóstico para quem foi interrompido.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO faltando
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
                      AND NOT p.polpermissive));

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'Tabela com tenantId sem protecao completa: %. Faltam RLS, FORCE, acesso_base ou tenant_isolamento — rode verificacoes-fase-b.sql, checagem 3, para ver qual.',
      faltando;
  END IF;
END $$;

\echo 'ok  1. toda tabela escopada tem RLS, FORCE e as duas politicas'

-- =====================================================================
-- 2. Nenhuma tabela escopada tem política a mais
-- =====================================================================
--
-- O inverso da anterior, e o mais silencioso dos dois. **PERMISSIVE combina com
-- OR:** uma política permissiva a mais abre o que a restritiva fechou, sem
-- alterar nenhuma linha do que já estava lá e sem quebrar teste nenhum.
DO $$
DECLARE
  sobrando text;
BEGIN
  SELECT string_agg(nome, ', ' ORDER BY nome)
    INTO sobrando
    FROM (
      SELECT c.relname AS nome, count(p.oid) AS n
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'tenantId'
              AND a.attnum > 0 AND NOT a.attisdropped)
       GROUP BY c.relname
    ) AS contagem
   WHERE n <> 2;

  IF sobrando IS NOT NULL THEN
    RAISE EXCEPTION
      'Tabela escopada com numero de politicas diferente de 2: %. Politica permissiva a mais abre o que a restritiva fechou, em silencio.',
      sobrando;
  END IF;
END $$;

\echo 'ok  2. exatamente duas politicas por tabela escopada'

-- =====================================================================
-- 3. As políticas de isolamento são o mesmo texto
-- =====================================================================
--
-- Uniformidade importa quando o que é uniforme é um controle de segurança: a
-- tabela que divergisse — um `OR` a mais, um `IS NULL` "para resolver um caso" —
-- viraria o lugar onde ninguém procura.
DO $$
DECLARE
  variantes int;
BEGIN
  SELECT count(*) INTO variantes
    FROM (
      SELECT DISTINCT pg_get_expr(p.polqual, p.polrelid),
                      pg_get_expr(p.polwithcheck, p.polrelid)
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND p.polname = 'tenant_isolamento'
    ) AS textos;

  IF variantes <> 1 THEN
    RAISE EXCEPTION
      'Ha % textos diferentes de tenant_isolamento; deveria haver 1. Rode verificacoes-fase-b.sql, checagem 4: a excecao e a linha de menor contagem.',
      variantes;
  END IF;
END $$;

\echo 'ok  3. as politicas de isolamento sao identicas'

-- =====================================================================
-- 4. A aplicação não é dona de tabela nenhuma
-- =====================================================================
--
-- `FORCE ROW LEVEL SECURITY` estende a política ao dono — e é por isso que
-- `NO FORCE` **não** é o jeito de reverter. Mas a garantia de que a aplicação
-- está sujeita à política não vem do FORCE: vem de ela não ser dona. Cinto e
-- suspensório, e esta asserção cobra o suspensório.
DO $$
DECLARE
  proprias text;
BEGIN
  SELECT string_agg(tablename || ' (' || tableowner || ')', ', ' ORDER BY tablename)
    INTO proprias
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tableowner IN ('propectai_app', 'propectai_sistema');

  IF proprias IS NOT NULL THEN
    RAISE EXCEPTION
      'Papel de execucao virou dono de tabela: %. Dono ignora RLS quando o FORCE cai.',
      proprias;
  END IF;
END $$;

\echo 'ok  4. propectai_app e propectai_sistema nao sao donos de nada'

-- =====================================================================
-- 5. A escalada de privilégio não é alcançável
-- =====================================================================
--
-- **A asserção mais importante do arquivo**, e a única que não é sobre
-- políticas.
--
-- Se `propectai_app` for membro de `propectai_sistema`, um `SET ROLE` em
-- qualquer trecho de código escala privilégio e toda a separação vira convenção.
-- Foi por isso que o desenho recusou tanto o `SET ROLE` a partir do papel da
-- aplicação quanto um sentinela no contexto: com papel e credencial próprios,
-- escalar exige ter a outra conexão; com sentinela, exigiria uma string.
--
-- Olha os dois sentidos de propósito. Herdar para cima é o risco óbvio; o
-- inverso indicaria alguém "simplificando" a configuração.
DO $$
DECLARE
  vinculo text;
BEGIN
  SELECT string_agg(m.rolname || ' -> ' || g.rolname, ', ')
    INTO vinculo
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles g ON g.oid = am.roleid
   WHERE (m.rolname = 'propectai_app'     AND g.rolname = 'propectai_sistema')
      OR (m.rolname = 'propectai_sistema' AND g.rolname = 'propectai_app');

  IF vinculo IS NOT NULL THEN
    RAISE EXCEPTION
      'Papeis com vinculo de pertencimento: %. Um SET ROLE passa a escalar privilegio.',
      vinculo;
  END IF;
END $$;

\echo 'ok  5. propectai_app nao alcanca propectai_sistema'

-- =====================================================================
-- 6. O papel da aplicação não ganhou BYPASSRLS
-- =====================================================================
--
-- Um atributo, um `ALTER ROLE`, e a política inteira sai do caminho sem que
-- nenhuma migration de RLS mude. É o jeito mais curto de desfazer o programa
-- inteiro, e não deixa rastro em lugar nenhum que os outros testes olhem.
DO $$
DECLARE
  atributo boolean;
BEGIN
  SELECT rolbypassrls INTO atributo
    FROM pg_roles WHERE rolname = 'propectai_app';

  IF atributo IS NULL THEN
    RAISE EXCEPTION 'Papel propectai_app nao existe.';
  END IF;

  IF atributo THEN
    RAISE EXCEPTION
      'propectai_app tem BYPASSRLS. A politica inteira sai do caminho, e nenhum outro teste percebe.';
  END IF;
END $$;

\echo 'ok  6. propectai_app nao tem BYPASSRLS'
\echo '--- portao de RLS: tudo certo ---'
