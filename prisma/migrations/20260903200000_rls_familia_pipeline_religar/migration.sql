-- Fase B, familia Pipeline — religar.
--
-- Reabilita o que a `20260827200000_rls_pipeline_revertido` desligou em 27/08,
-- depois que a fase A converteu todos os chamadores.
--
-- =====================================================================
-- Por que caiu da primeira vez, e o que mudou
-- =====================================================================
--
-- A familia foi ligada com a varredura de chamadores incompleta: tres modulos
-- escrevem nestas tabelas e so um estava convertido. O registro de conta passou
-- a responder 500 e derrubou 45 testes.
--
-- **A varredura foi refeita em 03/09, sobre os arquivos vivos**, e o resultado
-- e diferente do que aquela nota dizia. Sao **cinco** arquivos e **19** pontos
-- de acesso — nao tres:
--
--   | arquivo                    | acessos | o que faz          |
--   |----------------------------|--------:|--------------------|
--   | `leads.service.ts`         |       5 | le e escreve       |
--   | `pipeline.service.ts`      |       4 | le e escreve       |
--   | `proposals.service.ts`     |       4 | le e escreve       |
--   | `dashboard.service.ts`     |       2 | **so le**          |
--   | `auth.service.ts`          |       1 | escreve no registro|
--
-- O `dashboard.service.ts` nunca apareceu na narrativa dos "tres modulos"
-- porque ele so le — e leitura sob politica sem contexto **nao da erro, da
-- vazio**. Ele teria devolvido KPI zerado no painel, calado, e o defeito seria
-- atribuido a qualquer outra coisa.
--
-- **Os 19 estao dentro de `comTenant`**: a varredura os lista todos escritos
-- como `tx.pipelineX.` — nenhum `this.prisma.pipelineX.` sobrou. Nenhum
-- `$queryRaw` toca estas tabelas.
--
-- =====================================================================
-- As politicas sao reescritas, e nao apenas reabilitadas
-- =====================================================================
--
-- `DISABLE ROW LEVEL SECURITY` deixou as politicas definidas e inertes, entao
-- `ENABLE` + `FORCE` sozinhos bastariam. **Nao e o que esta escrito abaixo**, e
-- por dois motivos:
--
-- 1. **Uma migration que liga protecao deve mostrar a protecao que liga.** Quem
--    revisar isto nao deveria precisar abrir uma migration de uma semana atras
--    para saber o que passa a valer.
-- 2. **Nao depender do estado anterior.** `ENABLE` numa tabela sem politica
--    nenhuma nega tudo — o modo de falha mais destrutivo do RLS. Com
--    `DROP ... IF EXISTS` seguido de `CREATE`, o resultado e o mesmo tendo a
--    politica sobrevivido ou nao.
--
-- O texto e identico ao da `20260827180000_rls_familia_pipeline`, de proposito:
-- reescrever e a mesma politica, nao uma revisao dela.
--
-- A ordem dentro de cada bloco tambem importa: **politica primeiro, `ENABLE`
-- depois.** O intervalo entre soltar e recriar acontece com a tabela ainda
-- desprotegida — que e o estado em que ela ja estava — e nao com ela protegida
-- e sem regra.
--
-- =====================================================================
-- Reverter, se precisar
-- =====================================================================
--
-- `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` nas tres. **Nao `NO FORCE`** —
-- `FORCE` so estende a politica ao dono da tabela, e o `propectai_app` nao e
-- dono, entao tira-lo nao devolve acesso nenhum a ele. Ver a correcao no
-- `PLANO-RLS-v1.md`.

-- =====================================================================
-- pipeline_stages
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "pipeline_stages";
DROP POLICY IF EXISTS "tenant_isolamento" ON "pipeline_stages";

CREATE POLICY "acesso_base" ON "pipeline_stages"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "pipeline_stages"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "pipeline_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stages" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- pipeline_cards
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "pipeline_cards";
DROP POLICY IF EXISTS "tenant_isolamento" ON "pipeline_cards";

CREATE POLICY "acesso_base" ON "pipeline_cards"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "pipeline_cards"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "pipeline_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_cards" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- pipeline_transitions
-- =====================================================================

DROP POLICY IF EXISTS "acesso_base"       ON "pipeline_transitions";
DROP POLICY IF EXISTS "tenant_isolamento" ON "pipeline_transitions";

CREATE POLICY "acesso_base" ON "pipeline_transitions"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "pipeline_transitions"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "pipeline_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_transitions" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- O que continua de fora
-- =====================================================================
--
-- As duas FKs sem chave composta — `pipeline_cards.stageId` e
-- `pipeline_transitions.toStageId` — seguem adiadas, pelo mesmo argumento da
-- migration original: elas mudam a forma do modelo (o Prisma obriga a abrir mao
-- da relacao `tenant` direta para usar a composta) e podem falhar por dado
-- preexistente. Riscos de naturezas diferentes nao entram na mesma entrega,
-- senao uma falha nao diz qual das duas a causou.
--
-- O `prisma/seed.ts` continua escrevendo nestas tabelas pelo `DATABASE_URL`,
-- que e o dono superusuario, e superusuario ignora RLS. **Continua sendo sorte
-- estrutural e nao desenho** — no dia em que o seed rodar por um papel comum,
-- ele precisa do `propectai_migrator`.
