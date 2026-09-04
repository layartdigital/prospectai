-- Fase B, familia 8 — Comercial. **A ultima.**
--
-- Tres tabelas: `proposals`, `contracts` e `proposal_items` — esta ultima so
-- protegivel depois da `20260904160000_proposal_items_tenant`, que lhe deu a
-- coluna.
--
-- =====================================================================
-- Varredura de chamadores — 04/09, sobre os arquivos vivos
-- =====================================================================
--
-- **11 acessos, todos num arquivo so**, e todos dentro de `comTenant`:
--
--   | arquivo                  | acessos | o que faz    |
--   |--------------------------|--------:|--------------|
--   | `proposals.service.ts`   |      11 | le e escreve |
--
-- E a familia mais concentrada do programa. Nenhum outro modulo toca estas
-- tabelas, nenhum `$queryRaw` as alcanca, e o papel `propectai_sistema` nao tem
-- concessao em nenhuma das tres — nada precisa atravessar tenants aqui.
--
-- **`proposal_items` nao aparece na varredura por delegate**, e nao por
-- descuido: ela e alcancada exclusivamente aninhada em `proposal` — um
-- `items: { create: [...] }` na criacao e quatro `include` com `orderBy`. E o
-- mesmo formato do `pipeline.service.ts` na familia 5, que chegava aos leads so
-- por `include` e teria passado batido numa varredura por delegate.
--
-- =====================================================================
-- Esta familia nao tinha teste nenhum
-- =====================================================================
--
-- Foi conferido: nenhum spec da API ou do worker toca `proposal`,
-- `proposalItem` ou `contract`, e o `seed.ts` tambem nao cria nenhum dos tres.
--
-- Entao o `rls-comercial.spec.ts` **nao esta cobrindo a politica em cima de
-- algo ja testado** — ele e a primeira cobertura que a familia recebe, e a
-- politica veio junto. Mesma situacao do `rls-pipeline.spec.ts` em 27/08.
--
-- Vale dizer com todas as letras porque muda como ler um verde: a suite passar
-- nao prova que o fluxo de propostas funciona, prova que ele isola. Quem quiser
-- a primeira garantia precisa escrever os testes de regra de negocio, que nao
-- existem.
--
-- =====================================================================
-- A politica
-- =====================================================================
--
-- Mesmo molde das familias 1 a 7 — inclusive em `proposal_items`, e esse era o
-- ponto de lhe dar a coluna. **As 34 tabelas escopadas do sistema passam a ter
-- a mesma politica, palavra por palavra.** Uniformidade importa quando o que e
-- uniforme e um controle de seguranca: qualquer uma que divergisse viraria o
-- lugar onde ninguem procura.
--
-- Politica primeiro, `ENABLE` depois, e `DROP ... IF EXISTS` na frente:
-- `ENABLE` numa tabela sem politica **nega tudo**, e nao depender do estado
-- anterior custa duas linhas.
--
-- Reverter e `DISABLE ROW LEVEL SECURITY` nas tres. **Nao `NO FORCE`** — ver a
-- correcao no `PLANO-RLS-v1.md`.

-- =====================================================================
-- proposals
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "proposals";
DROP POLICY IF EXISTS "tenant_isolamento" ON "proposals";

CREATE POLICY "acesso_base" ON "proposals"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "proposals"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proposals" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- proposal_items
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "proposal_items";
DROP POLICY IF EXISTS "tenant_isolamento" ON "proposal_items";

CREATE POLICY "acesso_base" ON "proposal_items"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "proposal_items"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "proposal_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proposal_items" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- contracts
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "contracts";
DROP POLICY IF EXISTS "tenant_isolamento" ON "contracts";

CREATE POLICY "acesso_base" ON "contracts"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "contracts"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- Fim da fase B — e o que ela nao fecha
-- =====================================================================
--
-- **34 tabelas sob politica**, das 42 do schema. As oito de fora sao globais
-- por natureza ou por desenho declarado, e estao enumeradas na
-- `20260904160000_proposal_items_tenant`.
--
-- O que **nao** esta fechado, e precisa estar escrito em algum lugar que nao
-- seja uma conversa:
--
-- 1. **As duas FKs compostas adiadas da familia Pipeline** —
--    `pipeline_cards.stageId` e `pipeline_transitions.toStageId`. Fechaveis com
--    `@@unique([tenantId, id])` em `PipelineStage`, pelo mesmo padrao que esta
--    entrega acabou de aplicar em `Proposal`. Continuam adiadas por escolha, e
--    agora com um precedente a mais de que o padrao funciona.
--
-- 2. **O `prisma/seed.ts` escreve pelo `DATABASE_URL`**, que e o dono
--    superusuario, e superusuario ignora RLS mesmo com `FORCE`. Isso vale para
--    todas as tabelas que ele toca, e continua sendo **sorte estrutural e nao
--    desenho**: no dia em que o dono deixar de ser superusuario, ou o seed rodar
--    por um papel comum, ele precisa do `propectai_migrator`.
--
-- 3. **Tres credenciais a provisionar no primeiro deploy** —
--    `propectai_migrator`, `propectai_app` e `propectai_sistema`. Nenhuma delas
--    entra sem senha: o `pg_hba.conf` do container so confia no socket local e
--    no `127.0.0.1` de dentro; conexao vinda de fora chega pelo gateway da
--    ponte Docker e cai em `scram-sha-256`. **Isso inclui o dono.** A primeira
--    migration nao roda antes disso.
--
-- 4. **`typecheck:all` antes de `test` no CI.** Sete ocorrencias ao longo do
--    programa em que o typecheck teria pego o defeito primeiro. Continua sem
--    dono.
