-- Passo 6, familia 2 — Pipeline.
--
-- Mesmo molde do canario (`20260827140000_rls_canario_auditoria`), aplicado a
-- tres tabelas. O mecanismo ja foi provado; o que muda aqui e a superficie.
--
-- **Nenhum spec toca estas tabelas hoje** — foi conferido antes de escrever.
-- Isso quer dizer duas coisas: nao ha fixture para migrar (o passo 3 da receita
-- sai de graca nesta familia), e a familia entra em producao sem cobertura
-- nenhuma. O `apps/api/test/rls-pipeline.spec.ts` desta mesma entrega e o
-- primeiro teste que ela ganha.
--
-- O `prisma/seed.ts` escreve em `pipeline_stages` e `pipeline_cards`. Ele roda
-- pelo `DATABASE_URL`, que e o dono superusuario, e superusuario ignora RLS —
-- entao o seed continua funcionando sem mudanca. **Isso e sorte estrutural, nao
-- desenho**: no dia em que o seed rodar por um papel comum, ele precisa do
-- `propectai_migrator`.

-- =====================================================================
-- pipeline_stages
-- =====================================================================

ALTER TABLE "pipeline_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stages" FORCE ROW LEVEL SECURITY;

CREATE POLICY "acesso_base" ON "pipeline_stages"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "pipeline_stages"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- =====================================================================
-- pipeline_cards
-- =====================================================================

ALTER TABLE "pipeline_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_cards" FORCE ROW LEVEL SECURITY;

CREATE POLICY "acesso_base" ON "pipeline_cards"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "pipeline_cards"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- =====================================================================
-- pipeline_transitions
-- =====================================================================

ALTER TABLE "pipeline_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_transitions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "acesso_base" ON "pipeline_transitions"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "pipeline_transitions"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- =====================================================================
-- O que esta migration NAO faz, e por que ficou de fora
-- =====================================================================
--
-- O `PLANO-RLS-PASSO6-v1.md` dizia para fechar, junto com esta familia, as duas
-- FKs sem chave composta: `pipeline_cards.stageId` e
-- `pipeline_transitions.toStageId`, ambas fechaveis com
-- `@@unique([tenantId, id])` em `PipelineStage`.
--
-- **Separei, e o argumento e o mesmo que separou os passos 2 e 4.**
--
-- Aquela mudanca poe `tenantId` em duas relacoes do mesmo modelo — a `tenant`
-- direta e a `stage` composta —, e o Prisma recusa quando duas relacoes que
-- partilham um campo declaram acoes referenciais conflitantes. O padrao ja
-- estabelecido neste schema e outro: `PipelineTransition` e
-- `DigitalPresenceAudit` **abrem mao da relacao `tenant` direta** justamente
-- para poder usar a composta. Ou seja, fechar as FKs mexe na forma do modelo,
-- nao so num indice.
--
-- Alem disso, ela pode falhar por dado: se existir card apontando para etapa de
-- outro tenant, a FK nova nao e criada. Isso precisa de uma consulta de
-- conferencia antes, e a resposta pode ser uma migracao de dado.
--
-- Juntar as duas coisas faria uma falha nao dizer qual das duas a causou. A RLS
-- e mecanismo provado e nao tem risco de dado; a FK tem os dois riscos. Vao em
-- entregas separadas, nesta ordem.
