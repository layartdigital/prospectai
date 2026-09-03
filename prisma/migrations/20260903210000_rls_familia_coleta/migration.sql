-- Fase B, familia 3 — Coleta.
--
-- `prospecting_searches` e `scrape_jobs`: a busca que o cliente pede e o job
-- que a executa.
--
-- =====================================================================
-- Varredura de chamadores — 03/09, sobre os arquivos vivos
-- =====================================================================
--
-- **12 acessos em quatro arquivos, todos dentro de `comTenant`:**
--
--   | arquivo                    | acessos | o que faz     |
--   |----------------------------|--------:|---------------|
--   | `process-scrape-job.ts`    |       5 | le e escreve  |
--   | `prospecting.service.ts`   |       5 | le e escreve  |
--   | `pipeline.service.ts`      |       1 | **so le**     |
--   | `dashboard.service.ts`     |       1 | **so le**     |
--
-- Os 12 aparecem escritos como `tx.prospectingSearch.` ou `tx.scrapeJob.` —
-- nenhum `this.prisma.` sobrou. Nenhum `$queryRaw` toca estas tabelas, e
-- nenhuma outra tabela as alcanca por `include`.
--
-- **Dois leitores puros de novo**, e pelo mesmo motivo que na familia Pipeline
-- eles sao o risco escondido: leitura sob politica sem contexto **nao da erro,
-- da vazio**. O `pipeline.service.ts` e o `dashboard.service.ts` teriam
-- devolvido listas vazias sem nada quebrar.
--
-- =====================================================================
-- Fixtures — passo 2 da receita
-- =====================================================================
--
-- Tres specs tocam estas tabelas:
--
--   - `scrape-pipeline.spec.ts` — ja usa `admin` desde a separacao dos dois
--     clientes, feita em 03/09 justamente antes desta familia;
--   - `tenant-isolation.spec.ts` e `business-invariants.spec.ts` — usavam
--     `new PrismaClient()`, que conecta pelo `DATABASE_URL`. Funcionava porque
--     o dono do banco **hoje** e superusuario, e superusuario ignora RLS mesmo
--     com `FORCE`. Isso e consequencia da configuracao, nao escolha. Os dois
--     passaram para `criarPrismaAdmin()` nesta mesma entrega.
--
-- =====================================================================
-- A politica
-- =====================================================================
--
-- Mesmo molde das familias 1 e 2. As politicas sao escritas antes do `ENABLE`,
-- e com `DROP ... IF EXISTS` na frente: `ENABLE` numa tabela sem politica
-- **nega tudo**, e nao depender do estado anterior custa duas linhas.
--
-- Reverter e `DISABLE ROW LEVEL SECURITY` nas duas. **Nao `NO FORCE`** — ver a
-- correcao no `PLANO-RLS-v1.md`.

-- =====================================================================
-- prospecting_searches
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "prospecting_searches";
DROP POLICY IF EXISTS "tenant_isolamento" ON "prospecting_searches";

CREATE POLICY "acesso_base" ON "prospecting_searches"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "prospecting_searches"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "prospecting_searches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospecting_searches" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- scrape_jobs
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "scrape_jobs";
DROP POLICY IF EXISTS "tenant_isolamento" ON "scrape_jobs";

CREATE POLICY "acesso_base" ON "scrape_jobs"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "scrape_jobs"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "scrape_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scrape_jobs" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- O que esta familia expoe pela primeira vez
-- =====================================================================
--
-- **E a primeira familia em que o worker escreve sob politica.** As familias 1
-- e 2 tinham escrita do worker so na auditoria (`processAuditJob`, ja
-- convertido em 27/08); aqui o `processScrapeJob` escreve nas duas tabelas ao
-- longo de um ciclo que dura minutos, em nove blocos separados por sondagem da
-- fonte.
--
-- Isso importa porque o `set_config` e **por transacao**: cada um dos nove
-- blocos declara o tenant de novo, e um bloco que esquecesse de declarar
-- falharia sozinho, sem derrubar os outros. O `scrape-pipeline.spec.ts` roda o
-- ciclo inteiro pelo papel da aplicacao e e o que cobre isso.
--
-- A chave de idempotencia `(tenantId, idempotencyKey)` continua unica por
-- tenant, e a politica nao a afeta: **integridade referencial e restricao
-- unica rodam por fora do RLS, por desenho do Postgres.** Duas buscas iguais em
-- tenants diferentes continuam legitimas, e repetir dentro do mesmo tenant
-- continua recusado — o `tenant-isolation.spec.ts` prova as duas coisas, e
-- prova pelo papel que ignora a politica, de proposito: o que ele testa e a
-- restricao do banco, nao o isolamento.
