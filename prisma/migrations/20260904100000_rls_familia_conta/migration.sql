-- Fase B, familia 6 — Conta e cobranca.
--
-- Cinco tabelas: `memberships`, `subscriptions`, `plan_usages`, `invoices` e
-- `onboarding_states`.
--
-- =====================================================================
-- Sao cinco, e nao seis — `billing_events` nao entra
-- =====================================================================
--
-- O plano contava seis, com `billing_events` na lista. **Ela nao tem coluna
-- `tenantId`**, e nao por esquecimento: o proprio schema explica, na doc do
-- modelo, que o evento chega antes de sabermos de quem e, que descobrir o
-- tenant e parte do processamento, e que evento de preco nao pertence a tenant
-- nenhum. Gravar primeiro e resolver depois e o que permite responder 200
-- rapido ao Stripe, que trata lentidao como falha e reentrega.
--
-- Sem a coluna nao ha politica a escrever — nao ha o que comparar com
-- `current_setting`. `billing_events` e global, como `users`, `tenants`,
-- `plans` e `segments`, e sai da familia por natureza e nao por decisao.
--
-- =====================================================================
-- Varredura de chamadores — 04/09, sobre os arquivos vivos
-- =====================================================================
--
-- **41 acessos em doze arquivos.** Trinta e nove escritos como `tx.<delegate>.`,
-- dentro de `comTenant`; **dois** escritos como `db.<delegate>.`, que e o
-- parametro do `atravessandoTenants` — o papel `propectai_sistema`:
--
--   | arquivo                    | acessos | o que faz                    |
--   |----------------------------|--------:|------------------------------|
--   | `team.service.ts`          |       9 | le e escreve `memberships`   |
--   | `account.service.ts`       |       7 | le e escreve                 |
--   | `billing.service.ts`       |       5 | le e escreve                 |
--   | `process-scrape-job.ts`    |       3 | le e escreve                 |
--   | `auth.service.ts`          |       3 | escreve no registro          |
--   | `admin.service.ts`         |       3 | 2 `tx.` + **1 `db.`**        |
--   | `leads.service.ts`         |       2 | le e escreve                 |
--   | `outreach.service.ts`      |       2 | le e escreve                 |
--   | `audits.service.ts`        |       1 | escreve cota                 |
--   | `entitlements.service.ts`  |       1 | escreve cota                 |
--   | `prospecting.service.ts`   |       1 | escreve cota                 |
--   | `process-audit-job.ts`     |       1 | escreve cota                 |
--   | `tenant.guard.ts`          |       1 | **`db.` — le `memberships`** |
--
-- As duas transacoes cruas do produto (`auth.service.ts:90` e
-- `team.service.ts:288`) escrevem nesta familia — `membership`, `subscription`,
-- `onboardingState` — e as duas declaram contexto por `declararTenant` no meio
-- do bloco, antes da primeira escrita escopada. Ver o comentario longo no
-- `register`: foi a linha que faltou quando a familia Pipeline caiu em 27/08.
--
-- Nenhum `$queryRaw` toca estas tabelas. Nenhum `this.prisma.<delegate>` solto
-- sobrou nas cinco.
--
-- =====================================================================
-- A primeira familia em que o guard nao pode obedecer a politica
-- =====================================================================
--
-- `tenant.guard.ts:75` le `memberships` pelo `propectai_sistema`, e **tem que
-- ser assim**: o guard e o que descobre qual e o tenant. Pedir a ele que leia
-- sob o contexto do tenant seria pedir o contexto antes de existir.
--
-- Isso nao e um furo. A autorizacao ali nunca esteve na politica: esta no
-- `where` sobre o `userId` que veio do JWT. A politica protege o dado de quem
-- ja esta dentro; o guard decide quem entra. Duas perguntas diferentes, e a
-- segunda nao tem como ser respondida pela primeira.
--
-- `admin.service.ts:80` le `plan_usages` pelo mesmo papel, e por motivo
-- parecido: o painel do provedor lista consumo **de todos os tenants**. E o
-- unico lugar do produto que faz isso com esta tabela.
--
-- Os dois caminhos continuam funcionando depois desta migration porque o
-- `propectai_sistema` mantem `SELECT` em `memberships` e `plan_usages` — a
-- migration `20260903190000_rls_papel_sistema_estreitar` revogou escrita em
-- quatro tabelas e as sequencias, e nao tocou nestas duas leituras.
--
-- =====================================================================
-- O `upsert` de fatura muda de comportamento, e para melhor
-- =====================================================================
--
-- `billing.service.ts:508` faz `invoice.upsert` com
-- `where: { provider_externalId }` — uma chave unica que **nao inclui
-- `tenantId`**.
--
-- Sob politica, isso deixa de ser inofensivo por acidente e passa a ser seguro
-- por construcao. Antes: se o tenant fosse resolvido errado, o `upsert`
-- encontraria a fatura do vizinho e a **sobrescreveria em silencio**. Agora a
-- clausula `USING` esconde essa linha, o `upsert` cai no `create`, e a
-- restricao unica — que roda por fora do RLS — recusa com violacao de chave.
--
-- Troca de uma corrupcao silenciosa por um erro barulhento no mesmo ponto. Nao
-- ha nada a mudar no codigo; ha o que registrar, porque quem vir essa violacao
-- no log precisa saber que ela e o sintoma certo de um problema anterior — a
-- resolucao do tenant —, e nao um defeito do `upsert`.
--
-- =====================================================================
-- Fixtures — passo 2 da receita
-- =====================================================================
--
-- **Tres specs montavam cenario com `new PrismaClient()`**, que conecta pelo
-- `DATABASE_URL` e so funciona porque o dono do banco hoje e superusuario:
-- `billing-rules.spec.ts`, `team-rules.spec.ts` e `suspension-rules.spec.ts`.
-- As tres escrevem `subscriptions` no cenario. Passaram para
-- `criarPrismaAdmin()`.
--
-- **Correcao registrada:** a entrega da familia 5 afirmou, na migration e na
-- mensagem de commit, que o `tenant-isolation-http.spec.ts` era "o ultimo
-- `new PrismaClient()` do repositorio". **Era falso — havia quatro.** A
-- afirmacao veio de ter conferido tres arquivos suspeitos e generalizado para o
-- repositorio inteiro, sem nunca ter rodado a busca. E o mesmo erro de metodo
-- que classificou o `admin.service.ts` inteiro como cross-tenant quando so um
-- metodo cruza: **conferir a instancia a mao e afirmar sobre a populacao.**
--
-- O `billing-rules.spec.ts` mostra por que isso sobreviveu: o cabecalho dele
-- dizia "e a mesma separacao de `criarPrismaAdmin` nos outros arquivos" tres
-- linhas acima de um `new PrismaClient()`. O comentario descrevia o desenho
-- certo sobre o codigo errado, e por isso ninguem releu a linha.
--
-- O quarto, `admin-panel.spec.ts`, **fica de fora desta entrega de proposito**:
-- ele nao toca nenhuma das cinco tabelas daqui. Toca `audit_logs`, que e da
-- familia 7. Corrigi-lo agora seria mexer num arquivo que esta entrega nao tem
-- como testar, e o lugar dele e a proxima familia. Ate la ele passa por
-- superusuario, e isso esta escrito aqui para nao ser redescoberto.
--
-- O `prisma/seed.ts` e o `prisma/set-plan.ts` continuam pelo `DATABASE_URL`, e
-- continuam certos: sao scripts administrativos, nao testes.
--
-- =====================================================================
-- A politica
-- =====================================================================
--
-- Mesmo molde das familias 1 a 5. Politica primeiro, `ENABLE` depois, e
-- `DROP ... IF EXISTS` na frente: `ENABLE` numa tabela sem politica **nega
-- tudo**, e nao depender do estado anterior custa duas linhas.
--
-- Reverter e `DISABLE ROW LEVEL SECURITY` nas cinco. **Nao `NO FORCE`** — ver a
-- correcao no `PLANO-RLS-v1.md`.

-- =====================================================================
-- memberships
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "memberships";
DROP POLICY IF EXISTS "tenant_isolamento" ON "memberships";

CREATE POLICY "acesso_base" ON "memberships"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "memberships"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- subscriptions
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "subscriptions";
DROP POLICY IF EXISTS "tenant_isolamento" ON "subscriptions";

CREATE POLICY "acesso_base" ON "subscriptions"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "subscriptions"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- plan_usages
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "plan_usages";
DROP POLICY IF EXISTS "tenant_isolamento" ON "plan_usages";

CREATE POLICY "acesso_base" ON "plan_usages"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "plan_usages"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "plan_usages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_usages" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- invoices
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "invoices";
DROP POLICY IF EXISTS "tenant_isolamento" ON "invoices";

CREATE POLICY "acesso_base" ON "invoices"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "invoices"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- onboarding_states
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "onboarding_states";
DROP POLICY IF EXISTS "tenant_isolamento" ON "onboarding_states";

CREATE POLICY "acesso_base" ON "onboarding_states"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "onboarding_states"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "onboarding_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_states" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- O que continua de fora, e o que sobra
-- =====================================================================
--
-- `plans` fica de fora: catalogo global, igual para todo mundo, sem `tenantId`.
-- `billing_events` fica de fora pelo motivo do topo. As duas seguem legiveis e
-- escreviveis pelo papel da aplicacao sem contexto nenhum, o que e o desenho.
--
-- **Restam duas familias**: 7 (Operacao e registro — `audit_logs`,
-- `notifications`, `export_jobs`, `invitations`, `app_settings`) e 8
-- (Comercial — `proposals`, `contracts` e o problema do `proposal_items`, que
-- nao tem `tenantId` e cujo pai teria politica enquanto o filho nao).
