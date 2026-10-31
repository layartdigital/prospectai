-- DADOS DE TESTE DE VOLUME (apenas no banco local p04_volume; nao e producao). isDemo = true.
BEGIN;
INSERT INTO prospecting_searches (id,"tenantId",niche,"stateUf",city,"leadsFound","isDemo","updatedAt")
VALUES ('srch_vol_0000000001','tnt_alfa_0000000001','Volume','SP','Teste',3000,true,now());
INSERT INTO leads (id,"tenantId","searchId",name,category,"addressCity","addressStateUf",fingerprint,"isDemo","createdAt","updatedAt")
SELECT 'lead_vol_'||lpad(i::text,8,'0'),'tnt_alfa_0000000001','srch_vol_0000000001','Lead de volume '||i,'Volume','Teste','SP','fp-vol-'||i,true,now()-(i||' minutes')::interval,now()
FROM generate_series(1,3000) i;
INSERT INTO lead_scores (id,"tenantId","leadId",value,level,"updatedAt")
SELECT 'scr_vol_'||lpad(i::text,8,'0'),'tnt_alfa_0000000001','lead_vol_'||lpad(i::text,8,'0'),(i%100),'MEDIA',now() FROM generate_series(1,3000) i;
INSERT INTO lead_digital_presences (id,"tenantId","leadId","hasWebsite","hasEmail","hasPhone","hasInstagram","hasFacebook","hasReviews","websiteHasHttps","whatsappStatus","updatedAt")
SELECT 'prs_vol_'||lpad(i::text,8,'0'),'tnt_alfa_0000000001','lead_vol_'||lpad(i::text,8,'0'),'AUSENTE','DESCONHECIDO','PRESENTE','DESCONHECIDO','DESCONHECIDO','DESCONHECIDO','DESCONHECIDO','UNKNOWN',now() FROM generate_series(1,3000) i;
-- 10 notas por lead
INSERT INTO lead_notes (id,"tenantId","leadId",content,"updatedAt")
SELECT 'nte_vol_'||i||'_'||n,'tnt_alfa_0000000001','lead_vol_'||lpad(i::text,8,'0'),'nota '||n,now() FROM generate_series(1,3000) i, generate_series(1,10) n;
-- um lead com 5000 notas
INSERT INTO lead_notes (id,"tenantId","leadId",content,"updatedAt")
SELECT 'nte_volg_'||n,'tnt_alfa_0000000001','lead_vol_00000001','nota gigante '||n,now() FROM generate_series(1,5000) n;
COMMIT;
ANALYZE;
