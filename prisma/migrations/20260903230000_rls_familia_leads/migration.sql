-- Fase B, familia 5 — Leads nucleo.
--
-- Sete tabelas: `leads`, `lead_source_records`, `lead_scores`,
-- `lead_score_reasons`, `suppression_entries`, `tags` e `lead_tags`.
--
-- **E o alvo real da fase inteira.** As familias 2, 3 e 4 protegem o que
-- orbita o lead; esta protege o lead.
--
-- =====================================================================
-- Varredura de chamadores — 03/09, sobre os arquivos vivos
-- =====================================================================
--
-- **39 acessos diretos em oito arquivos, todos dentro de `comTenant`:**
--
--   | arquivo                    | acessos | o que faz     |
--   |----------------------------|--------:|---------------|
--   | `leads.service.ts`         |      15 | le e escreve  |
--   | `process-scrape-job.ts`    |       8 | le e escreve  |
--   | `dashboard.service.ts`     |       7 | **so le**     |
--   | `account.service.ts`       |       4 | le e escreve  |
--   | `outreach.service.ts`      |       2 | le e escreve  |
--   | `audits.service.ts`        |       1 | **so le**     |
--   | `proposals.service.ts`     |       1 | **so le**     |
--   | `process-audit-job.ts`     |       1 | **so le**     |
--
-- Os 39 aparecem escritos como `tx.<delegate>.` — nenhum `this.prisma.` sobrou.
-- Nenhum `$queryRaw` toca estas tabelas. As duas unicas transacoes cruas do
-- produto (`auth.service.ts:90` e `team.service.ts:288`) declaram contexto por
-- `declararTenant` no meio do bloco, e nenhuma das duas toca esta familia.
--
-- =====================================================================
-- E aqui a varredura por delegate **nao bastava**
-- =====================================================================
--
-- Nas quatro familias anteriores, procurar `tx.<delegate>.` encontrava todo
-- mundo. Nesta, nao encontra: o lead e alcancado por `include` a partir de
-- quase tudo, e um `include` nao escreve o nome do delegate em lugar nenhum.
--
-- **13 caminhos por relacao, em cinco arquivos:**
--
--   | arquivo                  | linha(s)      | caminho                             |
--   |--------------------------|---------------|-------------------------------------|
--   | `pipeline.service.ts`    | 38            | card -> lead -> {score, presenca}    |
--   | `proposals.service.ts`   | 29, 113, 177  | proposta -> lead                    |
--   | `proposals.service.ts`   | 274, 319, 369 | **contrato -> proposta -> lead**    |
--   | `outreach.service.ts`    | 109           | lead -> score -> reasons            |
--   | `leads.service.ts`       | 131,258,349,841 | lead -> score                     |
--   | `dashboard.service.ts`   | 75            | score **filtrado por** lead         |
--
-- Duas coisas valem ser ditas em voz alta:
--
-- 1. **O `pipeline.service.ts` nao tem um unico acesso direto a esta familia.**
--    Ele so alcanca o lead por `include` a partir do card. Uma varredura por
--    delegate o teria declarado nao envolvido — e a tela do funil abriria com
--    card sem nome, sem cidade e sem score.
--
-- 2. **O contrato chega ao lead em dois saltos.** `contract.proposal.lead.name`
--    aparece em tres lugares do `proposals.service.ts`. Dois saltos e o tipo de
--    caminho que ninguem procura, porque o arquivo que o contem fala de
--    contratos.
--
-- Os cinco estao dentro de `comTenant`. O ponto nao e que faltou converter —
-- e que **o metodo de varredura que serviu para quatro familias nao serviria
-- para esta**, e o proximo que varrer precisa saber disso.
--
-- =====================================================================
-- Tres tabelas sem chamador nenhum
-- =====================================================================
--
-- `suppression_entries`, `tags` e `lead_tags` **nao sao tocadas por nada**:
-- nem `apps/api/src`, nem `apps/worker/src`, nem os testes, nem o `seed.ts`.
-- Elas existem no schema e esperam a funcionalidade.
--
-- Entram na familia assim mesmo, e por um motivo so: **a ordem certa e a
-- tabela estar protegida antes do primeiro chamador existir.** Quem escrever
-- o primeiro acesso a `tags` vai escreve-lo contra uma tabela que ja recusa
-- escrita sem contexto — e descobre no primeiro teste, nao em producao.
--
-- O que **nao** se pode concluir e que a suite verde prova algo sobre estas
-- tres. Nada as exercita. Ficam ligadas e nao testadas, de proposito e com
-- isto escrito.
--
-- =====================================================================
-- Fixtures — passo 2 da receita
-- =====================================================================
--
-- Duas correcoes vao junto nesta entrega:
--
-- 1. **`tenant-isolation-http.spec.ts` usava `new PrismaClient()`**, que conecta
--    pelo `DATABASE_URL`. Funcionava porque o dono do banco hoje e superusuario,
--    e superusuario ignora RLS mesmo com `FORCE`. **E o ultimo do repositorio** —
--    `tenant-isolation.spec.ts` e `business-invariants.spec.ts` foram migrados
--    na familia 3, e a varredura de agora nao achou mais nenhum.
--
--    Ele cria o lead do Alfa no `beforeAll` e limpa os dois tenants no
--    `afterAll`: as duas pontas sao montagem de cenario, e montagem de cenario
--    e operacao administrativa.
--
-- 2. **`rls-atividade.spec.ts` tinha um teste que so valia enquanto `leads`
--    estava desprotegida.** O bloco "o include some em silencio" afirmava
--    `expect(lead).not.toBeNull()` — verdadeiro exatamente ate esta migration.
--    Aquele arquivo ja dizia, em comentario, que o sintoma mudaria quando a
--    familia 5 entrasse. Entrou, e o teste foi reescrito junto: agora prova
--    que o lead **some inteiro** (falha barulhenta) e, separadamente, que as
--    filhas dependem do contexto **por conta propria** — lidas direto, sem
--    carona na mae. A segunda metade nao depende mais do estado de `leads`,
--    entao nao volta a vencer.
--
-- O `prisma/seed.ts` continua escrevendo por `prisma.lead.upsert` e afins pelo
-- `DATABASE_URL`, que e o dono superusuario. **Continua sendo sorte estrutural
-- e nao desenho** — no dia em que o seed rodar por um papel comum, ele precisa
-- do `propectai_migrator`.
--
-- =====================================================================
-- A politica
-- =====================================================================
--
-- Mesmo molde das familias 1 a 4. Politica primeiro, `ENABLE` depois, e
-- `DROP ... IF EXISTS` na frente: `ENABLE` numa tabela sem politica **nega
-- tudo**, e nao depender do estado anterior custa duas linhas.
--
-- Reverter e `DISABLE ROW LEVEL SECURITY` nas sete. **Nao `NO FORCE`** —
-- `FORCE` so estende a politica ao dono da tabela, e o `propectai_app` nao e
-- dono, entao tira-lo nao devolve acesso nenhum a ele. Ver a correcao no
-- `PLANO-RLS-v1.md`.

-- =====================================================================
-- leads
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "leads";
DROP POLICY IF EXISTS "tenant_isolamento" ON "leads";

CREATE POLICY "acesso_base" ON "leads"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "leads"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- lead_source_records
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "lead_source_records";
DROP POLICY IF EXISTS "tenant_isolamento" ON "lead_source_records";

CREATE POLICY "acesso_base" ON "lead_source_records"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "lead_source_records"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lead_source_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_source_records" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- lead_scores
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "lead_scores";
DROP POLICY IF EXISTS "tenant_isolamento" ON "lead_scores";

CREATE POLICY "acesso_base" ON "lead_scores"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "lead_scores"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lead_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_scores" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- lead_score_reasons
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "lead_score_reasons";
DROP POLICY IF EXISTS "tenant_isolamento" ON "lead_score_reasons";

CREATE POLICY "acesso_base" ON "lead_score_reasons"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "lead_score_reasons"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lead_score_reasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_score_reasons" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- suppression_entries  — sem chamador hoje
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "suppression_entries";
DROP POLICY IF EXISTS "tenant_isolamento" ON "suppression_entries";

CREATE POLICY "acesso_base" ON "suppression_entries"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "suppression_entries"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "suppression_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppression_entries" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- tags  — sem chamador hoje
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "tags";
DROP POLICY IF EXISTS "tenant_isolamento" ON "tags";

CREATE POLICY "acesso_base" ON "tags"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "tags"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- lead_tags  — sem chamador hoje
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "lead_tags";
DROP POLICY IF EXISTS "tenant_isolamento" ON "lead_tags";

CREATE POLICY "acesso_base" ON "lead_tags"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "lead_tags"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lead_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_tags" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- O que muda de natureza a partir daqui
-- =====================================================================
--
-- **Ate esta migration, um `include` errado devolvia lista vazia. A partir
-- dela, devolve `null` na raiz.**
--
-- E uma melhora. Lista vazia e indistinguivel de "nao tem nada", e passa por
-- tela sem que ninguem repare; `null` na raiz quebra a renderizacao ou vira
-- 404, e alguem repara no mesmo dia. O modo de falha ficou mais barulhento
-- exatamente onde o dado e mais sensivel.
--
-- **As chaves compostas continuam valendo por fora.** `lead_scores`,
-- `lead_source_records` e `lead_tags` apontam para `leads(tenantId, id)`, e
-- integridade referencial roda fora do RLS por desenho do Postgres. As duas
-- garantias sao independentes: a FK impede ligar linha ao lead do vizinho
-- mesmo com a politica desligada, e a politica esconde a linha mesmo com a FK
-- ausente. Nenhuma substitui a outra.
--
-- **`@@unique([tenantId, fingerprint])` tambem continua por fora**, e isso
-- importa para a deduplicacao do `processScrapeJob`: dois tenants coletando o
-- mesmo estabelecimento continuam gerando duas linhas legitimas, e o mesmo
-- tenant coletando duas vezes continua recusado. O `tenant-isolation.spec.ts`
-- prova as duas coisas pelo papel que ignora a politica — de proposito, porque
-- o que ele testa e a restricao do banco e nao o isolamento.
