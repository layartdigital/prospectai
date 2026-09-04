/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,id]` on the table `pipeline_stages` will be added. If there are existing duplicate values, this will fail.

*/

-- As duas FKs adiadas do Pipeline, mais uma terceira. Fecham a ultima divida
-- estrutural do schema — 04/09/2026.
--
-- =====================================================================
-- O que estava adiado, e por que estava
-- =====================================================================
--
-- A `20260823131105_f0_integridade_tenant` deu chave composta a cinco relacoes
-- e deixou estas de fora. A migration da familia Pipeline registrou o motivo:
-- "elas mudam a forma do modelo (o Prisma obriga a abrir mao da relacao
-- `tenant` direta para usar a composta) e podem falhar por dado preexistente".
--
-- **As duas metades daquela frase estavam erradas.**
--
-- 1. **O Prisma nao obriga a nada disso.** Conferido com `prisma validate`
--    antes de escrever qualquer linha: `PipelineCard` mantem a relacao `tenant`
--    simples **e** ganha a composta com `PipelineStage`, as duas usando
--    `tenantId`. O schema valida. A premissa falsa ajudou a adiar isto duas
--    vezes.
--
-- 2. **Nao pode falhar por dado preexistente.** `id` ja e chave primaria, entao
--    `(tenantId, id)` e trivialmente unico — o aviso do Prisma acima e verdade
--    generica e vazio neste caso. Diferente da migration de `proposal_items`,
--    que precisou de backfill em tres passos porque acrescentava coluna.
--
-- Que a nota estivesse errada nos dois pontos e o registro mais util aqui: **o
-- custo de adiar nao foi o trabalho, foi a razao inventada para adiar.**
--
-- =====================================================================
-- Sao tres, e a terceira muda uma acao referencial
-- =====================================================================
--
-- `pipeline_cards.stageId` e `pipeline_transitions.toStageId` sao as duas do
-- plano, e **nao mudam semantica nenhuma**: as duas ja eram `RESTRICT`.
--
-- `pipeline_transitions.fromStageId` entrou por decisao tomada agora, e ela
-- **muda** a acao referencial. Era `ON DELETE SET NULL`. Numa FK composta o
-- `SET NULL` anula a tupla inteira, `tenantId` incluido — e ele e `NOT NULL`.
-- Manter `SetNull` criaria uma FK que estoura na primeira exclusao de etapa.
--
-- `RESTRICT` grava o invariante que sobra: **etapa que aparece no historico nao
-- pode ser apagada.** Custo hoje: zero. Nada apaga etapa de pipeline — nem o
-- produto, nem o `seed.ts`, nem os testes; foi conferido por busca. Quem
-- implementar essa exclusao encontra a restricao ao escrever, e nao em
-- producao.
--
-- =====================================================================
-- Indice de suporte: de proposito, NAO
-- =====================================================================
--
-- A `20260823131105` criou `lead_score_reasons_tenantId_scoreId_idx` com esta
-- justificativa: "o Postgres nao cria indice para a coluna referenciante, e o
-- Prisma tambem nao: sem ele, apagar um LeadScore faz varredura sequencial".
-- A familia 8 repetiu o padrao em `proposal_items`.
--
-- **Aqui nao, e a diferenca e o padrao de escrita das tabelas.**
--
-- - `pipeline_cards` ja tem `@@index([tenantId, stageId, position])`, e
--   `(tenantId, stageId)` e prefixo dele. A FK nova ja esta coberta.
-- - `pipeline_transitions` tem `@@index([tenantId])`, que da suporte parcial:
--   uma verificacao de FK varre as transicoes **de um tenant**, nao a tabela.
--
-- E `lead_score_reasons` sofre `deleteMany` seguido de `createMany` a cada
-- recalculo de score — o indice ali paga por si mesmo o tempo todo.
-- `pipeline_transitions` e historico **append-only**: nunca apaga, e cada
-- movimento de card insere uma linha. Dois indices compostos a mais custariam
-- duas insercoes de B-tree por movimento, para acelerar uma operacao que nao
-- existe.
--
-- **Seguir o precedente sem olhar o caso seria o erro.** Se um dia existir
-- exclusao de etapa e ela for lenta, o indice entra com medicao na mao.

-- DropForeignKey
ALTER TABLE "pipeline_cards" DROP CONSTRAINT "pipeline_cards_stageId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_transitions" DROP CONSTRAINT "pipeline_transitions_fromStageId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_transitions" DROP CONSTRAINT "pipeline_transitions_toStageId_fkey";

-- CreateIndex
-- Antes das FKs, e nao depois: a referencia precisa apontar para uma chave
-- unica, e sem esta o Postgres recusa com ERROR 42830.
CREATE UNIQUE INDEX "pipeline_stages_tenantId_id_key" ON "pipeline_stages"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_tenantId_stageId_fkey" FOREIGN KEY ("tenantId", "stageId") REFERENCES "pipeline_stages"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_tenantId_fromStageId_fkey" FOREIGN KEY ("tenantId", "fromStageId") REFERENCES "pipeline_stages"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_tenantId_toStageId_fkey" FOREIGN KEY ("tenantId", "toStageId") REFERENCES "pipeline_stages"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- O que isto garante, e o que a politica de RLS nao garantia
-- =====================================================================
--
-- Integridade referencial roda **por fora do RLS**, por desenho do Postgres. As
-- duas garantias sao independentes:
--
-- - A politica esconde do contexto errado a linha que existe.
-- - A FK composta faz a linha errada **deixar de ser representavel** — e isso
--   vale com o RLS desligado, com o papel que o ignora, e no `seed.ts` rodando
--   como superusuario.
--
-- Antes desta migration, um card do tenant A podia apontar para uma etapa do
-- tenant B. A politica escondia o card de quem estivesse no contexto errado,
-- mas o dado divergente cabia no banco. Agora nao cabe.
--
-- Com isto, **todas as relacoes escopadas do schema tem chave composta.** Nao
-- resta nenhuma no formato "coluna solta e disciplina".
