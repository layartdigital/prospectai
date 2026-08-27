-- ============================================================================
-- PropectAI · Verificações que precedem qualquer migration da auditoria
-- Referência: docs/intelligence/PROVIDER-CONTRACT-v5.md §7.3
-- Data: 22/08/2026
--
-- Somente SELECT. Nenhuma escrita. Rodar contra a base de desenvolvimento.
--
-- No PowerShell (o operador `<` não existe lá, e o usuário é propectai,
-- não postgres — ver docker-compose.yml:24-26):
--
--   docker cp .\gate0\verificacoes-f0.sql propectai-postgres:/tmp/v.sql
--   docker exec propectai-postgres psql -U propectai -d propectai -f /tmp/v.sql
--
-- Se o .env sobrescrever POSTGRES_USER ou POSTGRES_DB, ajustar os dois flags.
--
-- Colunas em camelCase e entre aspas: o schema tem 40 @@map de tabela e
-- zero @map de campo, então os nomes no PostgreSQL são os do Prisma.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A PERGUNTA MAIS IMPORTANTE
--
-- Existe presença digital gravada com tenant diferente do lead a que pertence?
--
-- Se o resultado for diferente de zero, existe vazamento entre tenants em dado
-- já gravado — e isso muda a prioridade de tudo o que está no documento.
-- Também impede criar a FK composta antes de corrigir o dado.
-- ----------------------------------------------------------------------------
SELECT 'lead_digital_presences' AS tabela, count(*) AS divergentes
FROM lead_digital_presences p
JOIN leads l ON l.id = p."leadId"
WHERE p."tenantId" <> l."tenantId";


-- ----------------------------------------------------------------------------
-- 2. O mesmo, nas outras tabelas com tenantId solto
-- ----------------------------------------------------------------------------
SELECT 'lead_source_records' AS tabela, count(*) AS divergentes
FROM lead_source_records r
JOIN leads l ON l.id = r."leadId"
WHERE r."tenantId" <> l."tenantId";

SELECT 'lead_scores' AS tabela, count(*) AS divergentes
FROM lead_scores s
JOIN leads l ON l.id = s."leadId"
WHERE s."tenantId" <> l."tenantId";


-- ----------------------------------------------------------------------------
-- 3. LeadScoreReason NÃO é "idem": não tem leadId, só scoreId.
--    Precisa passar por lead_scores.
-- ----------------------------------------------------------------------------
SELECT 'lead_score_reasons' AS tabela, count(*) AS divergentes
FROM lead_score_reasons rz
JOIN lead_scores s ON s.id = rz."scoreId"
WHERE rz."tenantId" <> s."tenantId";


-- ----------------------------------------------------------------------------
-- 4. Algum sinal social já foi gravado diferente de DESCONHECIDO?
--
-- O comentário do schema afirma que na v0.1.1 hasInstagram e hasFacebook são
-- SEMPRE DESCONHECIDO. Comentário não é restrição — esta consulta é a prova.
--
-- Se for diferente de zero, o CHECK da F5 precisa de NOT VALID + backfill,
-- e não de ADD CONSTRAINT direto.
-- ----------------------------------------------------------------------------
SELECT count(*) AS sinais_sociais_ja_gravados
FROM lead_digital_presences
WHERE "hasInstagram" <> 'DESCONHECIDO'
   OR "hasFacebook"  <> 'DESCONHECIDO';


-- ----------------------------------------------------------------------------
-- 5. websiteHasHttps: quantas linhas têm valor?
--
-- Hoje é Boolean?, e NULL não é DESCONHECIDO — é ausência de valor.
-- "não medido" e "medido como falso" são indistinguíveis, que é o que a
-- regra 4 do CLAUDE.md proíbe. Este número dimensiona a migração para
-- SignalState, que é pré-requisito da F3.
-- ----------------------------------------------------------------------------
SELECT
  count(*)                                     AS total,
  count(*) FILTER (WHERE "websiteHasHttps" IS NULL)  AS nulos,
  count(*) FILTER (WHERE "websiteHasHttps" IS TRUE)  AS verdadeiros,
  count(*) FILTER (WHERE "websiteHasHttps" IS FALSE) AS falsos
FROM lead_digital_presences;


-- ----------------------------------------------------------------------------
-- 6. As tabelas-pai têm UNIQUE (tenantId, id)?
--
-- Sem isso NENHUMA FK composta pode ser criada:
--   ERROR 42830: there is no unique constraint matching given keys
--
-- O schema tem @@unique([tenantId, fingerprint]) e ([tenantId, placeId])
-- em leads, mas não ([tenantId, id]). Esta consulta confirma contra o banco.
-- ----------------------------------------------------------------------------
SELECT
  c.relname AS tabela,
  i.relname AS indice,
  pg_get_indexdef(i.oid) AS definicao
FROM pg_class c
JOIN pg_index x ON x.indrelid = c.oid
JOIN pg_class i ON i.oid = x.indexrelid
WHERE c.relname IN ('leads', 'lead_scores', 'prospecting_searches', 'tenants')
  AND x.indisunique
ORDER BY c.relname, i.relname;


-- ----------------------------------------------------------------------------
-- 7. LeadTag e ProposalItem têm tenantId?
--
-- A egress policy §5 registra que não têm. Para essas duas, FK composta não é
-- a correção — acrescentar a coluna é o primeiro passo.
-- ----------------------------------------------------------------------------
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_name IN ('lead_tags', 'proposal_items')
  AND column_name = 'tenantId';
-- Zero linhas = confirma o buraco.


-- ============================================================================
-- Fora do SQL, no repositório:
--
--   pnpm typecheck    O CHANGELOG declara dois erros de tipo conhecidos.
--                     É o item 1 da sequência do PROMPT-01-ADENDO.
--
--   pnpm prisma validate
--                     Decide se as FKs compostas podem morar no schema.prisma
--                     ou se ficam só na migration — e, nesse caso, entram no
--                     runbook, porque o diff remove o que ele não conhece.
-- ============================================================================
