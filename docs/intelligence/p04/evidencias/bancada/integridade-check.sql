-- QA-01 §14 — a FK simples permite referencia entre tenants? Testado no schema REAL (banco LOCAL de bancada).
-- Cada tentativa roda num sub-bloco que SEMPRE e desfeito (nada fica gravado). Papel dono, como uma migration faria.
CREATE OR REPLACE FUNCTION pg_temp.tenta(rotulo text, sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
    RAISE NOTICE '% -> ACEITO (a FK nao impede a referencia entre tenants)', rotulo;
    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN foreign_key_violation THEN RAISE NOTICE '% -> RECUSADO pela FK composta', rotulo;
    WHEN raise_exception THEN NULL;
    WHEN OTHERS THEN RAISE NOTICE '% -> ERRO inesperado: %', rotulo, SQLERRM;
  END;
END $$;

\echo === tenant ALFA referenciando lead do BETA (FK simples em leadId)
SELECT pg_temp.tenta('lead_notes',            $$INSERT INTO lead_notes (id,"tenantId","leadId",content,"updatedAt") VALUES ('qa_nota_cruz001','tnt_alfa_0000000001','lead_beta_00000001','x',now())$$);
SELECT pg_temp.tenta('lead_activities',       $$INSERT INTO lead_activities (id,"tenantId","leadId",type) VALUES ('qa_atv_cruz0001','tnt_alfa_0000000001','lead_beta_00000001','LEAD_CREATED')$$);
SELECT pg_temp.tenta('lead_contact_records',  $$INSERT INTO lead_contact_records (id,"tenantId","leadId",channel,direction,"updatedAt") VALUES ('qa_ctt_cruz0001','tnt_alfa_0000000001','lead_beta_00000001','PHONE','SENT',now())$$);
SELECT pg_temp.tenta('lead_follow_ups',       $$INSERT INTO lead_follow_ups (id,"tenantId","leadId","dueAt","updatedAt") VALUES ('qa_flw_cruz0001','tnt_alfa_0000000001','lead_beta_00000001',now(),now())$$);
SELECT pg_temp.tenta('pipeline_cards',        $$INSERT INTO pipeline_cards (id,"tenantId","leadId","stageId","enteredStageAt","updatedAt") VALUES ('qa_crd_cruz0001','tnt_alfa_0000000001','lead_beta_00000001','stg_alfa_000000001',now(),now())$$);
\echo === lead do BETA apontando para pesquisa do ALFA (leads.searchId simples)
SELECT pg_temp.tenta('leads.searchId',        $$UPDATE leads SET "searchId"='srch_alfa_00000001' WHERE id='lead_beta_00000001'$$);
\echo === controle: FK COMPOSTA (tenantId, leadId) -> deve RECUSAR
SELECT pg_temp.tenta('lead_scores',           $$INSERT INTO lead_scores (id,"tenantId","leadId",value,level,"updatedAt") VALUES ('qa_scr_cruz0001','tnt_alfa_0000000001','lead_beta_00000001',1,'BAIXA',now())$$);
SELECT pg_temp.tenta('lead_digital_presences',$$INSERT INTO lead_digital_presences (id,"tenantId","leadId","updatedAt") VALUES ('qa_prs_cruz0001','tnt_alfa_0000000001','lead_beta_00000001',now())$$);
SELECT pg_temp.tenta('digital_presence_audits',$$INSERT INTO digital_presence_audits (id,"tenantId","leadId","auditVersion",status,"createdAt","updatedAt") VALUES ('qa_aud_cruz0001','tnt_alfa_0000000001','lead_beta_00000001','v1','COMPLETED',now(),now())$$);
\echo === registros ja incompativeis neste banco de bancada (cartao orfao semeado de proposito)
SELECT 'pipeline_cards' tabela, count(*) incompativeis FROM pipeline_cards c JOIN leads l ON l.id=c."leadId" WHERE l."tenantId" <> c."tenantId"
UNION ALL SELECT 'leads.searchId', count(*) FROM leads l JOIN prospecting_searches s ON s.id=l."searchId" WHERE s."tenantId" <> l."tenantId"
UNION ALL SELECT 'lead_notes', count(*) FROM lead_notes n JOIN leads l ON l.id=n."leadId" WHERE l."tenantId" <> n."tenantId";
