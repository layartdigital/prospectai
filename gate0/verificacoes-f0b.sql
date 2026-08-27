-- ============================================================================
-- PropectAI · Verificações que faltaram na primeira rodada
-- Referência: F0-MIGRATION-INTEGRIDADE-TENANT.md §6.1
-- Data: 23/08/2026
--
-- Somente SELECT. Nenhuma escrita.
--
--   docker cp .\gate0\verificacoes-f0b.sql propectai-postgres:/tmp/v2.sql
--   docker exec propectai-postgres psql -U propectai -d propectai -f /tmp/v2.sql
--
-- Por que existe: a primeira rodada mediu 4 tabelas e o plano de migration
-- incluía 5. pipeline_transitions entrou sem nunca ter sido olhado, e
-- lead_tags foi tratado com um count(*) que não responde a pergunta certa.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. pipeline_transitions — a tabela que faltou medir
--
-- tenantId é coluna solta. O pai é o card. Se divergir, a FK composta aborta.
-- ----------------------------------------------------------------------------
SELECT 'transition vs card' AS verificacao, count(*) AS divergentes
FROM pipeline_transitions t
JOIN pipeline_cards c ON c.id = t."cardId"
WHERE t."tenantId" <> c."tenantId";


-- ----------------------------------------------------------------------------
-- 2. pipeline_transitions vs as etapas
--
-- Não entra na migration desta fatia, mas mede o vazamento:
-- uma transição do Tenant A apontando para etapa do Tenant B faz o nome do
-- funil do concorrente aparecer no histórico do card.
-- ----------------------------------------------------------------------------
SELECT 'transition vs toStage' AS verificacao, count(*) AS divergentes
FROM pipeline_transitions t
JOIN pipeline_stages s ON s.id = t."toStageId"
WHERE t."tenantId" <> s."tenantId";

SELECT 'transition vs fromStage' AS verificacao, count(*) AS divergentes
FROM pipeline_transitions t
JOIN pipeline_stages s ON s.id = t."fromStageId"
WHERE t."fromStageId" IS NOT NULL AND t."tenantId" <> s."tenantId";

-- Card vivendo numa coluna de outro tenant.
SELECT 'card vs stage' AS verificacao, count(*) AS divergentes
FROM pipeline_cards c
JOIN pipeline_stages s ON s.id = c."stageId"
WHERE c."tenantId" <> s."tenantId";


-- ----------------------------------------------------------------------------
-- 3. lead_tags — a pergunta certa
--
-- count(*) responde "o backfill tem trabalho?". A pergunta é outra:
-- se lead.tenantId <> tag.tenantId, NENHUM valor de tenantId satisfaz as duas
-- FKs compostas. A linha precisa ser removida, não preenchida.
-- ----------------------------------------------------------------------------
SELECT count(*) AS total_lead_tags FROM lead_tags;

SELECT lt."leadId", lt."tagId",
       l."tenantId" AS tenant_do_lead,
       t."tenantId" AS tenant_da_tag
FROM lead_tags lt
JOIN leads l ON l.id = lt."leadId"
JOIN tags  t ON t.id = lt."tagId"
WHERE l."tenantId" <> t."tenantId";
-- Zero linhas = o backfill a partir do lead é seguro.
-- Qualquer linha = decidir remoção ou reatribuição ANTES de gerar a migration.


-- ----------------------------------------------------------------------------
-- 4. lead_source_records vs scrape_jobs
--
-- Segundo pai que a fatia 1 não fecha. Mede o que fica aberto.
-- ----------------------------------------------------------------------------
SELECT 'source_record vs scrape_job' AS verificacao, count(*) AS divergentes
FROM lead_source_records r
JOIN scrape_jobs j ON j.id = r."scrapeJobId"
WHERE r."scrapeJobId" IS NOT NULL AND r."tenantId" <> j."tenantId";


-- ----------------------------------------------------------------------------
-- 5. proposals vs leads — vazamento encontrado na revisão, fora do plano
--
-- Proposal.leadId é FK simples com onDelete: SetNull. Nada obriga
-- proposal.tenantId = lead.tenantId, e a tela de proposta renderiza o lead.
-- ----------------------------------------------------------------------------
SELECT 'proposal vs lead' AS verificacao, count(*) AS divergentes
FROM proposals p
JOIN leads l ON l.id = p."leadId"
WHERE p."leadId" IS NOT NULL AND p."tenantId" <> l."tenantId";

SELECT 'contract vs proposal' AS verificacao, count(*) AS divergentes
FROM contracts c
JOIN proposals p ON p.id = c."proposalId"
WHERE c."proposalId" IS NOT NULL AND c."tenantId" <> p."tenantId";


-- ----------------------------------------------------------------------------
-- 6. Os nomes reais das constraints que a migration vai derrubar
--
-- O plano supôs a convenção <tabela>_<coluna>_fkey. O CHANGELOG registra ao
-- menos uma migration com SQL escrito à mão, então o histórico não é 100%
-- gerado — e um DROP CONSTRAINT com nome errado aborta a migration.
-- ----------------------------------------------------------------------------
SELECT conrelid::regclass AS tabela, conname AS constraint_name,
       pg_get_constraintdef(oid) AS definicao
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid::regclass::text IN (
    'lead_source_records', 'lead_digital_presences', 'lead_scores',
    'lead_score_reasons', 'pipeline_transitions', 'lead_tags'
  )
ORDER BY tabela, conname;


-- ============================================================================
-- Antes de gerar qualquer migration, no repositório:
--
--   1. Editar o schema.prisma
--   2. pnpm prisma validate      ← decide se as relações compostas são aceitas
--   3. pnpm prisma generate      ← regenera o client SEM tocar no banco
--   4. pnpm typecheck && pnpm typecheck:tests && pnpm typecheck:scripts
--
-- O passo 4 é onde a mudança aparece: escrita aninhada perde tenantId, e
-- connect passa a exigir a chave composta. Descobrir isso antes de aplicar
-- é a diferença entre corrigir com calma e corrigir com o banco já mudado.
-- ============================================================================
