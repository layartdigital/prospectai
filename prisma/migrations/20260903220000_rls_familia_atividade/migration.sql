-- Fase B, familia 4 — Atividade do lead.
--
-- Seis tabelas: tudo o que a equipe registra sobre um lead ao longo do tempo, e
-- os sinais que o produto coleta sobre ele.
--
-- =====================================================================
-- Varredura de chamadores — 03/09, sobre os arquivos vivos
-- =====================================================================
--
-- **21 acessos em sete arquivos** — o plano previa dois (`LeadsService` e
-- `OutreachService`). Os outros cinco aparecem porque estas tabelas sao lidas
-- de todo lado, e nao so escritas por quem as gerencia:
--
--   | arquivo                    | acessos | o que faz     |
--   |----------------------------|--------:|---------------|
--   | `outreach.service.ts`      |       9 | le e escreve  |
--   | `leads.service.ts`         |       6 | le e escreve  |
--   | `dashboard.service.ts`     |       2 | **so le**     |
--   | `admin.service.ts`         |       1 | **atravessa** |
--   | `pipeline.service.ts`      |       1 | **so le**     |
--   | `proposals.service.ts`     |       1 | escreve       |
--   | `process-scrape-job.ts`    |       1 | escreve       |
--
-- **20 estao em `comTenant`.** O 21o e o `db.leadActivity.groupBy` do
-- `admin.service.ts`, dentro de `atravessandoTenants` — o painel do provedor
-- agrega atividade de todos os tenants, e isso e a funcionalidade.
--
-- Esse 21o so funciona porque `lead_activities` e uma das 10 tabelas que
-- sobreviveram ao estreitamento do papel do sistema, na
-- `20260903190000_rls_papel_sistema_estreitar`. **Nao foi previsao**: a lista
-- de la saiu do que o codigo de fato usa. Se tivesse saido de intuicao, o
-- painel quebraria agora.
--
-- =====================================================================
-- Os `include` sao metade do risco desta familia
-- =====================================================================
--
-- Quatro destas seis tabelas nunca sao consultadas diretamente na tela de
-- detalhe do lead: elas chegam por `include` a partir de `lead`. O `findOne` do
-- `leads.service.ts` traz `notes`, `contactRecords`, `followUps` e `activities`
-- **numa consulta so**.
--
-- Sob politica sem contexto, essa consulta **nao falha**: devolve o lead com
-- quatro listas vazias. A tela abriria mostrando um lead sem historico nenhum,
-- e ninguem associaria isso a RLS.
--
-- Os quatro pontos de `include` a partir de `lead` — em `account`, `pipeline`,
-- `dashboard` e no worker — foram conferidos um a um: **os quatro estao dentro
-- de blocos.**
--
-- =====================================================================
-- Fixtures — passo 2 da receita
-- =====================================================================
--
-- **Nenhum spec toca estas seis tabelas diretamente.** Nao ha fixture para
-- migrar, e a familia entra com a cobertura que o `rls-atividade.spec.ts` desta
-- mesma entrega traz — mais o `leads`/`outreach` exercitados de lado pelos
-- specs de isolamento HTTP.
--
-- =====================================================================
-- A politica
-- =====================================================================
--
-- Mesmo molde das familias 1, 2 e 3. Politica escrita antes do `ENABLE`, com
-- `DROP ... IF EXISTS` na frente: `ENABLE` numa tabela sem politica **nega
-- tudo**, e nao depender do estado anterior custa duas linhas.
--
-- Reverter e `DISABLE ROW LEVEL SECURITY` nas seis. **Nao `NO FORCE`** — ver a
-- correcao no `PLANO-RLS-v1.md`.

-- =====================================================================
-- lead_activities  —  trilha de acoes no lead
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "lead_activities";
DROP POLICY IF EXISTS "tenant_isolamento" ON "lead_activities";

CREATE POLICY "acesso_base" ON "lead_activities"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "lead_activities"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lead_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_activities" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- lead_contact_records  —  registro de contato feito
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "lead_contact_records";
DROP POLICY IF EXISTS "tenant_isolamento" ON "lead_contact_records";

CREATE POLICY "acesso_base" ON "lead_contact_records"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "lead_contact_records"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lead_contact_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_contact_records" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- lead_follow_ups  —  lembretes de retorno
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "lead_follow_ups";
DROP POLICY IF EXISTS "tenant_isolamento" ON "lead_follow_ups";

CREATE POLICY "acesso_base" ON "lead_follow_ups"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "lead_follow_ups"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lead_follow_ups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_follow_ups" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- lead_notes  —  anotacoes da equipe
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "lead_notes";
DROP POLICY IF EXISTS "tenant_isolamento" ON "lead_notes";

CREATE POLICY "acesso_base" ON "lead_notes"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "lead_notes"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lead_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_notes" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- lead_digital_presences  —  sinais de presenca digital
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "lead_digital_presences";
DROP POLICY IF EXISTS "tenant_isolamento" ON "lead_digital_presences";

CREATE POLICY "acesso_base" ON "lead_digital_presences"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "lead_digital_presences"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lead_digital_presences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_digital_presences" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- outreach_messages  —  rascunhos de abordagem gerados por IA
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "outreach_messages";
DROP POLICY IF EXISTS "tenant_isolamento" ON "outreach_messages";

CREATE POLICY "acesso_base" ON "outreach_messages"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "outreach_messages"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "outreach_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_messages" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- Uma nota sobre `lead_digital_presences`
-- =====================================================================
--
-- E a unica das seis com relacao **um-para-um** com `lead`, e a unica escrita
-- pelo worker no momento em que o lead nasce. Um lead sem a linha de presenca
-- digital passa pelo `scoreLead` com `digitalPresence` nulo e recebe um score
-- calculado sobre dados que existem mas nao foram lidos — numero errado, sem
-- erro nenhum para indica-lo.
--
-- Por isso as duas escritas vivem no mesmo bloco desde a fase A (fatia 7). A
-- politica nao muda essa exigencia; so a torna mais visivel, porque agora as
-- duas tambem precisam do mesmo contexto declarado.
