-- `proposal_items` ganha `tenantId`, com FK composta.
--
-- **Esta migration nao liga politica nenhuma.** Ela so muda a forma da tabela,
-- para que a familia 8 possa ligar. Duas migrations separadas de proposito:
-- esta pode falhar por dado preexistente, a outra nao pode falhar por nada.
-- Juntas, uma falha nao diria qual das duas a causou.
--
-- =====================================================================
-- Por que a coluna precisa existir
-- =====================================================================
--
-- Censo das 42 tabelas do schema: **33 tem `tenantId`**. Das nove que nao tem,
-- oito sao assim por motivo declarado —
--
--   - `users`, `tenants`, `plans`, `segments`, `segment_locales`,
--     `platform_admins`: globais por natureza;
--   - `billing_events`: por desenho documentado no proprio schema — o evento do
--     provedor chega antes de sabermos de quem e;
--   - `refresh_tokens`: pertence a uma **pessoa**, nao a um workspace, e a
--     mesma pessoa pode estar em varios.
--
-- **`proposal_items` era a nona, e a unica que era falta.**
--
-- Sem a coluna nao ha politica de RLS a escrever: nao existe o que comparar com
-- `current_setting`. E ligar a politica so em `proposals`, deixando o filho
-- descoberto, entregaria a fase B com um furo conhecido — quem soubesse um
-- `proposalId` leria os itens de qualquer proposta.
--
-- =====================================================================
-- O que a varredura encontrou, e por que ela nao basta como garantia
-- =====================================================================
--
-- A familia inteira tem **11 acessos diretos, todos no `proposals.service.ts`,
-- todos dentro de `comTenant`** — e `proposal_items` nao aparece em nenhum
-- deles. A tabela so e alcancada **aninhada em `proposal`**: um
-- `items: { create: [...] }` na criacao e quatro `include` com `orderBy`.
--
-- Enquanto for so isso, o filho nunca e consultado sem o pai, e a politica de
-- `proposals` ja o protegeria de fato. **Mas isso e propriedade do codigo de
-- hoje, e nao do banco** — exatamente a classe de garantia que este programa
-- inteiro existe para substituir. Um `$queryRaw`, ou um
-- `proposalItem.findMany({ where: { proposalId } })` escrito daqui a seis meses,
-- desfaz a garantia sem tocar em nada que pareca relacionado a seguranca.
--
-- =====================================================================
-- A FK composta faz mais do que a politica
-- =====================================================================
--
-- A politica esconde a linha de quem esta no contexto errado. A FK composta faz
-- com que **item ligado a proposta de outro tenant deixe de ser
-- representavel** — e isso vale mesmo com o RLS desligado, porque integridade
-- referencial roda por fora do RLS por desenho do Postgres.
--
-- As duas garantias sao independentes e nenhuma substitui a outra. Mesmo
-- argumento, e mesmo padrao, de `lead_source_records`, `lead_scores`,
-- `lead_score_reasons` e `lead_tags`, feitos na `20260823131105`.
--
-- =====================================================================
-- Tres passos, e nao um
-- =====================================================================
--
-- A `20260823131105` fez `ADD COLUMN "tenantId" TEXT NOT NULL` direto, gerado
-- pelo Prisma. **Aquilo so funcionou porque as tabelas estavam vazias** — em
-- tabela com linha, o Postgres recusa uma coluna `NOT NULL` sem default.
--
-- Aqui `proposal_items` provavelmente tambem esta vazia: o `seed.ts` nao cria
-- item nenhum e nenhum teste toca a tabela. **"Provavelmente" nao e plano.** Os
-- tres passos abaixo — anulavel, preencher a partir do pai, exigir — chegam ao
-- mesmo estado final tendo dado ou nao, e o Prisma compara **estado**, nao o
-- texto do SQL: para a deteccao de desvio os dois caminhos sao indistinguiveis.
--
-- Reverter: soltar a FK composta, recriar a simples por `proposalId`, soltar as
-- duas colunas de indice e a coluna. Nada aqui apaga linha.

-- =====================================================================
-- 1. A coluna, anulavel por enquanto
-- =====================================================================

ALTER TABLE "proposal_items" ADD COLUMN "tenantId" TEXT;

-- =====================================================================
-- 2. Preencher a partir do pai
-- =====================================================================
--
-- O pai e a unica fonte possivel: e dele que o item herda o tenant, e a FK
-- antiga garante que todo item tem um.

UPDATE "proposal_items" AS i
   SET "tenantId" = p."tenantId"
  FROM "proposals" AS p
 WHERE p."id" = i."proposalId";

-- =====================================================================
-- 3. Exigir
-- =====================================================================
--
-- Se o passo 2 tiver deixado alguma linha para tras, **este comando falha e a
-- migration inteira volta atras** — que e o comportamento certo. Item orfao,
-- sem pai de onde herdar o tenant, nao pode ganhar um valor inventado.

ALTER TABLE "proposal_items" ALTER COLUMN "tenantId" SET NOT NULL;

-- =====================================================================
-- 4. A unicidade que a FK composta exige em `proposals`
-- =====================================================================
--
-- Sem ela o Postgres recusa a FK com ERROR 42830: a referencia precisa apontar
-- para uma chave unica, e `(tenantId, id)` nao era uma.

CREATE UNIQUE INDEX "proposals_tenantId_id_key" ON "proposals"("tenantId", "id");

-- =====================================================================
-- 5. Trocar a FK simples pela composta
-- =====================================================================

ALTER TABLE "proposal_items" DROP CONSTRAINT "proposal_items_proposalId_fkey";

CREATE INDEX "proposal_items_tenantId_proposalId_idx"
  ON "proposal_items"("tenantId", "proposalId");

ALTER TABLE "proposal_items"
  ADD CONSTRAINT "proposal_items_tenantId_proposalId_fkey"
  FOREIGN KEY ("tenantId", "proposalId")
  REFERENCES "proposals"("tenantId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
