\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'

\echo === CASO 1: Alfa le o que e dele (papel propectai_app, tenant declarado) ===
BEGIN READ ONLY;
SELECT set_config('app.tenant_id','tnt_alfa_0000000001',true);
SELECT 'ALFA lead',        count(*) FROM leads WHERE id='lead_alfa_0000001' AND "tenantId"='tnt_alfa_0000000001' AND "deletedAt" IS NULL;
SELECT 'ALFA score',       count(*) FROM lead_scores WHERE "leadId"='lead_alfa_0000001' AND "tenantId"='tnt_alfa_0000000001';
SELECT 'ALFA motivos',     count(*) FROM lead_score_reasons WHERE "scoreId"='scr_alfa_000000001' AND "tenantId"='tnt_alfa_0000000001';
SELECT 'ALFA presenca',    count(*) FROM lead_digital_presences WHERE "leadId"='lead_alfa_0000001' AND "tenantId"='tnt_alfa_0000000001';
SELECT 'ALFA cartao',      count(*) FROM pipeline_cards WHERE "leadId"='lead_alfa_0000001' AND "tenantId"='tnt_alfa_0000000001';
SELECT 'ALFA notas',       count(*) FROM lead_notes WHERE "leadId"='lead_alfa_0000001' AND "tenantId"='tnt_alfa_0000000001' AND "deletedAt" IS NULL;
SELECT 'ALFA atividades',  count(*) FROM lead_activities WHERE "leadId"='lead_alfa_0000001' AND "tenantId"='tnt_alfa_0000000001';
SELECT 'ALFA auditorias',  count(*) FROM digital_presence_audits WHERE "leadId"='lead_alfa_0000001' AND "tenantId"='tnt_alfa_0000000001';
SELECT 'ALFA checagens',   count(*) FROM digital_presence_checks WHERE "auditId"='aud_alfa_000000001' AND "tenantId"='tnt_alfa_0000000001';
SELECT 'ALFA leads da pesquisa (com tenantId no where)', count(*) FROM leads WHERE "searchId"='srch_alfa_00000001' AND "tenantId"='tnt_alfa_0000000001' AND "deletedAt" IS NULL;
SELECT 'ALFA leads da pesquisa (SEM tenantId no where; so RLS)', count(*) FROM leads WHERE "searchId"='srch_alfa_00000001' AND "deletedAt" IS NULL;
ROLLBACK;

\echo === CASO 2: Beta, com os ids do Alfa, nao le NADA (com tenantId do Beta no where) ===
BEGIN READ ONLY;
SELECT set_config('app.tenant_id','tnt_beta_0000000001',true);
SELECT 'BETA lead do alfa',        count(*) FROM leads WHERE id='lead_alfa_0000001' AND "tenantId"='tnt_beta_0000000001' AND "deletedAt" IS NULL;
SELECT 'BETA pesquisa do alfa',    count(*) FROM prospecting_searches WHERE id='srch_alfa_00000001' AND "tenantId"='tnt_beta_0000000001' AND "deletedAt" IS NULL;
SELECT 'BETA score do alfa',       count(*) FROM lead_scores WHERE id='scr_alfa_000000001' AND "tenantId"='tnt_beta_0000000001';
SELECT 'BETA presenca do alfa',    count(*) FROM lead_digital_presences WHERE id='prs_alfa_000000001' AND "tenantId"='tnt_beta_0000000001';
SELECT 'BETA cartao do alfa',      count(*) FROM pipeline_cards WHERE id='crd_alfa_000000001' AND "tenantId"='tnt_beta_0000000001';
SELECT 'BETA auditoria do alfa',   count(*) FROM digital_presence_audits WHERE id='aud_alfa_000000001' AND "tenantId"='tnt_beta_0000000001';
SELECT 'BETA notas do alfa',       count(*) FROM lead_notes WHERE "leadId"='lead_alfa_0000001' AND "tenantId"='tnt_beta_0000000001';
SELECT 'BETA leads da pesquisa do alfa', count(*) FROM leads WHERE "searchId"='srch_alfa_00000001' AND "tenantId"='tnt_beta_0000000001' AND "deletedAt" IS NULL;
ROLLBACK;

\echo === CASO 3: defesa em camadas: Beta SEM filtro de tenantId no where (so a RLS segura) ===
BEGIN READ ONLY;
SELECT set_config('app.tenant_id','tnt_beta_0000000001',true);
SELECT 'RLS-ONLY lead do alfa',     count(*) FROM leads WHERE id='lead_alfa_0000001';
SELECT 'RLS-ONLY pesquisa do alfa', count(*) FROM prospecting_searches WHERE id='srch_alfa_00000001';
SELECT 'RLS-ONLY score do alfa',    count(*) FROM lead_scores WHERE id='scr_alfa_000000001';
SELECT 'RLS-ONLY notas do alfa',    count(*) FROM lead_notes WHERE "leadId"='lead_alfa_0000001';
SELECT 'RLS-ONLY cartao do alfa',   count(*) FROM pipeline_cards WHERE id='crd_alfa_000000001';
SELECT 'RLS-ONLY auditoria do alfa',count(*) FROM digital_presence_audits WHERE id='aud_alfa_000000001';
SELECT 'RLS-ONLY checagem do alfa', count(*) FROM digital_presence_checks WHERE id='chk_alfa_000000001';
ROLLBACK;

\echo === CASO 4: sem contexto de tenant (contexto nao declarado) = negacao total ===
BEGIN READ ONLY;
SELECT 'SEM-CONTEXTO leads', count(*) FROM leads;
SELECT 'SEM-CONTEXTO notas', count(*) FROM lead_notes;
ROLLBACK;

\echo === CASO 5: o intruso do Beta que aponta para a pesquisa do Alfa ===
BEGIN READ ONLY;
SELECT set_config('app.tenant_id','tnt_beta_0000000001',true);
SELECT 'BETA ve o proprio intruso', count(*) FROM leads WHERE id='lead_beta_intruso1' AND "tenantId"='tnt_beta_0000000001';
SELECT 'BETA ve a pesquisa que o intruso aponta', count(*) FROM prospecting_searches WHERE id='srch_alfa_00000001' AND "tenantId"='tnt_beta_0000000001';
ROLLBACK;
