-- Fase B, familia 7 — Operacao e registro.
--
-- Seis tabelas: `audit_logs`, `notifications`, `invitations`, `export_jobs`,
-- `app_settings` e `feature_flags`.
--
-- =====================================================================
-- Sao seis, e o plano dizia cinco
-- =====================================================================
--
-- `feature_flags` nao estava na lista, e tem `tenantId` como todas as outras —
-- flag e por workspace, nao global. Entrou.
--
-- E duas suposicoes minhas sobre esta familia estavam erradas, as duas
-- desfeitas ao abrir o schema em vez de repetir o plano:
--
--   - **`app_settings` tem `tenantId`.** Eu esperava configuracao global, como
--     `plans`. E por tenant, com `@@unique([tenantId, key])`.
--   - **`audit_logs.tenantId` e anulavel.** Nenhuma outra tabela do programa e
--     assim, e isso muda o comportamento da politica. Ver a secao propria.
--
-- =====================================================================
-- Varredura de chamadores — 04/09, sobre os arquivos vivos
-- =====================================================================
--
-- **46 acessos em treze arquivos.** Quarenta e quatro `tx.<delegate>.`, dentro
-- de `comTenant`; **dois** `db.<delegate>.`, pelo `propectai_sistema`:
--
--   | arquivo                    | acessos | o que faz                     |
--   |----------------------------|--------:|-------------------------------|
--   | `team.service.ts`          |      11 | 10 `tx.` + **1 `db.`**        |
--   | `notifications.service.ts` |       7 | le e escreve                  |
--   | `proposals.service.ts`     |       5 | so escreve auditoria          |
--   | `account.service.ts`       |       5 | so escreve auditoria          |
--   | `process-scrape-job.ts`    |       4 | notificacoes e auditoria      |
--   | `admin.service.ts`         |       3 | so escreve auditoria          |
--   | `billing.service.ts`       |       3 | so escreve auditoria          |
--   | `audits.service.ts`        |       1 | so escreve auditoria          |
--   | `auth.service.ts`          |       1 | so escreve auditoria          |
--   | `leads.service.ts`         |       1 | so escreve auditoria          |
--   | `process-audit-job.ts`     |       1 | so escreve auditoria          |
--   | `prospecting.service.ts`   |       1 | so escreve auditoria          |
--   | `privacy.service.ts`       |       1 | **`db.` — reescreve o ator**  |
--
-- Os dois caminhos pelo papel do sistema sao os mesmos dois padroes que a
-- familia 6 ja tinha mostrado, e nenhum deles e furo:
--
--   - `team.service.ts:495` le `invitations` **pelo token**, antes de haver
--     sessao. Como o guard: nao ha contexto porque o contexto ainda nao foi
--     estabelecido. A autorizacao ali e o token, que e o segredo.
--   - `privacy.service.ts:59` reescreve o ator em `audit_logs` de **todos** os
--     workspaces. O pedido de eliminacao e da pessoa, e uma pessoa pode ser
--     membro de varios. Este servico ja usava `atravessandoTenants` desde a
--     fatia 8b, e a docstring dele ja previa esta migration por escrito.
--
-- O `propectai_sistema` mantem `SELECT` em `invitations` e `SELECT, UPDATE` em
-- `audit_logs` — conferido contra a
-- `20260903190000_rls_papel_sistema_estreitar`, que revogou o `INSERT` em
-- `audit_logs` e nao tocou no resto. As outras quatro tabelas desta familia nao
-- tem concessao nenhuma para esse papel, e nao precisam: nada as alcanca por
-- ali.
--
-- =====================================================================
-- `audit_logs` e a primeira tabela com `tenantId` anulavel
-- =====================================================================
--
-- A coluna e `String?`, e a relacao com `Tenant` e `onDelete: SetNull`. Apagar
-- um workspace **nao apaga o log dele** — anula o vinculo e deixa o evento.
--
-- Sob a politica isso tem uma consequencia que precisa estar escrita:
-- `NULL = <qualquer coisa>` e `NULL`, e `NULL` nao e `TRUE`. **As linhas orfas
-- ficam invisiveis ao papel da aplicacao em todo contexto**, e nao apenas no
-- contexto errado. Nao ha valor de `app.tenant_id` que as traga de volta.
--
-- Isso e o comportamento certo — nenhum tenant deveria ver o log de um
-- workspace que nao existe mais — mas so e inofensivo por uma razao concreta:
-- **a aplicacao nunca le `audit_logs`.** Foi conferido, e o resultado e
-- categorico: 24 `create`, um `updateMany` pelo papel do sistema, e **zero**
-- `find`, `count`, `aggregate` ou `groupBy` em `apps/api/src` e
-- `apps/worker/src`. Nao existe tela, relatorio ou endpoint que leia esta
-- tabela.
--
-- No dia em que existir — um painel de auditoria e o pedido obvio —, quem o
-- escrever precisa saber de duas coisas ao mesmo tempo: que o `where` por
-- tenant e redundante sob a politica, e que as linhas orfas nao vao aparecer.
-- A segunda e a que surpreende.
--
-- O `WITH CHECK` tambem recusa gravar com `tenantId` nulo, e isso esta certo:
-- os 24 `create` passam `tenantId` sempre, sem excecao — conferido um a um.
-- Auditoria sem dono seria auditoria que ninguem consegue consultar.
--
-- =====================================================================
-- Tres tabelas sem chamador de produto
-- =====================================================================
--
-- `export_jobs` e `feature_flags` nao sao tocadas por nada — nem `src`, nem
-- testes, nem seed. `app_settings` e escrita **so pelo `prisma/seed.ts`**, pelo
-- dono superusuario, e por nenhum caminho de produto.
--
-- Entram pelo mesmo argumento da familia 5: a ordem certa e a tabela estar
-- protegida antes do primeiro chamador existir. E, como la, **a suite verde nao
-- prova nada sobre elas** — nada as exercita. O `rls-operacao.spec.ts` cria uma
-- linha em cada uma justamente porque nada mais cria.
--
-- Uma observacao sobre o seed: `appSetting.upsert` roda pelo `DATABASE_URL`,
-- que e o dono superusuario, e superusuario ignora RLS. **Continua sendo sorte
-- estrutural e nao desenho** — no dia em que o seed rodar por um papel comum,
-- ele precisa do `propectai_migrator`. E o mesmo aviso das familias 2 e 5, e
-- agora vale para uma tabela a mais.
--
-- =====================================================================
-- Fixtures — passo 2 da receita
-- =====================================================================
--
-- **`admin-panel.spec.ts` era o quarto e ultimo `new PrismaClient()`** dos que
-- ficaram para tras — os outros tres sairam na familia 6, e o levantamento que
-- os encontrou esta registrado naquela migration, junto com a correcao da
-- afirmacao errada que a familia 5 tinha feito.
--
-- Ele sobreviveu as familias 3, 5 e 6 porque nao tocava tabela nenhuma delas. A
-- unica linha em risco e `auditLog.findFirst`, no teste que confere se a troca
-- de plano ficou registrada — e sem a troca de cliente ela devolveria `null`, o
-- teste falharia dizendo "nao registrou em auditoria", e a falha apontaria para
-- o `AdminService`, que esta certo.
--
-- Foi conferido por busca no repositorio inteiro, e nao por amostragem: os
-- `new PrismaClient()` que restam sao os das proprias fabricas
-- (`prisma-app.ts`, `prisma-admin.ts`), o do `PrismaSistemaService`, e os dos
-- scripts `seed.ts` e `set-plan.ts` — todos corretos onde estao.
--
-- **`privacy.service.ts` mudou, e so em comentario.** A docstring dele previa
-- esta migration e apontava para um papel chamado `propectai_admin`, que nunca
-- existiu no banco: era rascunho do plano, e o papel se chama
-- `propectai_sistema`. Corrigido, junto com a nota sobre as linhas orfas.
--
-- =====================================================================
-- A politica
-- =====================================================================
--
-- Mesmo molde das familias 1 a 6. Politica primeiro, `ENABLE` depois, e
-- `DROP ... IF EXISTS` na frente: `ENABLE` numa tabela sem politica **nega
-- tudo**, e nao depender do estado anterior custa duas linhas.
--
-- Reverter e `DISABLE ROW LEVEL SECURITY` nas seis. **Nao `NO FORCE`** — ver a
-- correcao no `PLANO-RLS-v1.md`.

-- =====================================================================
-- audit_logs  — tenantId anulavel, ver a secao acima
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "audit_logs";
DROP POLICY IF EXISTS "tenant_isolamento" ON "audit_logs";

CREATE POLICY "acesso_base" ON "audit_logs"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

-- Sem tratamento especial para `NULL`, de proposito. Escrever
-- `("tenantId" IS NULL OR "tenantId" = current_setting(...))` abriria as linhas
-- orfas para **todo mundo** — o oposto do que se quer.
CREATE POLICY "tenant_isolamento" ON "audit_logs"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- notifications
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "notifications";
DROP POLICY IF EXISTS "tenant_isolamento" ON "notifications";

CREATE POLICY "acesso_base" ON "notifications"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "notifications"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- invitations
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "invitations";
DROP POLICY IF EXISTS "tenant_isolamento" ON "invitations";

CREATE POLICY "acesso_base" ON "invitations"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "invitations"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- export_jobs  — sem chamador hoje
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "export_jobs";
DROP POLICY IF EXISTS "tenant_isolamento" ON "export_jobs";

CREATE POLICY "acesso_base" ON "export_jobs"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "export_jobs"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "export_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "export_jobs" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- app_settings  — so o seed escreve, pelo dono superusuario
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "app_settings";
DROP POLICY IF EXISTS "tenant_isolamento" ON "app_settings";

CREATE POLICY "acesso_base" ON "app_settings"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "app_settings"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_settings" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- feature_flags  — sem chamador hoje
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "feature_flags";
DROP POLICY IF EXISTS "tenant_isolamento" ON "feature_flags";

CREATE POLICY "acesso_base" ON "feature_flags"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "feature_flags"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flags" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- O que sobra
-- =====================================================================
--
-- **Uma familia.** A 8, Comercial: `proposals` e `contracts`, mais o problema
-- que esta anotado desde o plano — `proposal_items` **nao tem `tenantId`**, e
-- ligar a politica so no pai deixaria o filho desprotegido: quem soubesse o
-- `proposalId` leria os itens de qualquer proposta.
--
-- E o mesmo formato de `billing_events` e nenhum dos dois: la a ausencia da
-- coluna e desenho (evento chega antes de haver tenant), aqui e falta. A
-- decisao entre acrescentar a coluna com FK composta, como fizeram
-- `lead_source_records` e `lead_tags`, ou escrever uma politica que verifica o
-- pai por subconsulta, e o que fecha a fase B.
