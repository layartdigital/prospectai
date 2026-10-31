-- P04-QA-02 item 5 — pipeline_cards: separar DUAS coisas que o teste da QA-01 misturou.
--   (a) a restricao UNICA pipeline_cards_leadId_key (um cartao por lead) — NAO e protecao de tenant;
--   (b) a ausencia de FK composta (tenantId, leadId) — a protecao de tenant que faltaria.
-- Banco LOCAL de bancada. Tudo dentro de sub-blocos SEMPRE desfeitos. Papel dono (como uma migration).

\echo === (1) catalogo: como a FK de leadId esta definida em pipeline_cards (e a de stageId, que e composta)
SELECT conname, pg_get_constraintdef(oid) AS definicao FROM pg_constraint
WHERE conrelid = 'pipeline_cards'::regclass AND contype IN ('f','u') ORDER BY conname;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'pipeline_cards' AND indexname LIKE '%leadId%';

CREATE OR REPLACE FUNCTION pg_temp.tenta(rotulo text, sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
    RAISE NOTICE '% -> ACEITO', rotulo;
    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN RAISE NOTICE '% -> RECUSADO por UNICIDADE (%): nao e protecao de tenant', rotulo, SQLERRM;
    WHEN foreign_key_violation THEN RAISE NOTICE '% -> RECUSADO por FK (%)', rotulo, SQLERRM;
    WHEN raise_exception THEN NULL;
    WHEN OTHERS THEN RAISE NOTICE '% -> ERRO inesperado: %', rotulo, SQLERRM;
  END;
END $$;

\echo === (2) reproduz o que a QA-01 viu: lead_beta_00000001 JA tem o cartao orfao semeado -> recusa por unicidade
SELECT pg_temp.tenta('cartao do ALFA em lead_beta_00000001 (ja tem cartao)', $$INSERT INTO pipeline_cards (id,"tenantId","leadId","stageId","enteredStageAt","updatedAt") VALUES ('qa_crd_cruz0001','tnt_alfa_0000000001','lead_beta_00000001','stg_alfa_000000001',now(),now())$$);

\echo === (3) o teste CERTO: lead do Beta SEM cartao (lead_beta_intruso1) — so a FK de leadId poderia recusar
SELECT pg_temp.tenta('cartao do ALFA em lead_beta_intruso1 (sem cartao)', $$INSERT INTO pipeline_cards (id,"tenantId","leadId","stageId","enteredStageAt","updatedAt") VALUES ('qa_crd_cruz0002','tnt_alfa_0000000001','lead_beta_intruso1','stg_alfa_000000001',now(),now())$$);

\echo === (4) controle: a FK composta (tenantId, stageId) recusa estagio de OUTRO tenant (o mecanismo funciona onde existe)
-- o Beta nao tem estagio na bancada: cria um DENTRO do sub-bloco desfeito, e tenta usa-lo num cartao do Alfa
SELECT pg_temp.tenta('cartao do ALFA com estagio do BETA',
  $$INSERT INTO pipeline_stages (id,"tenantId",name,slug,"order","updatedAt") VALUES ('qa_stg_beta0001','tnt_beta_0000000001','QA','qa-beta',1,now());
    INSERT INTO pipeline_cards (id,"tenantId","leadId","stageId","enteredStageAt","updatedAt") VALUES ('qa_crd_cruz0003','tnt_alfa_0000000001','lead_alfa_0000002','qa_stg_beta0001',now(),now())$$);
