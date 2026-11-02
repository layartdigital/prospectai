-- Dados de TESTE LOCAL para validar o Intelligence Explorer. Nao e producao.
-- Todos os registros de lead/pesquisa levam isDemo = true (CLAUDE.md, regra 7).
BEGIN;
INSERT INTO tenants (id,name,slug,"updatedAt") VALUES
 ('tnt_alfa_0000000001','Agência Alfa (teste)','alfa-teste',now()),
 ('tnt_beta_0000000001','Agência Beta (teste)','beta-teste',now());

INSERT INTO prospecting_searches (id,"tenantId",niche,"stateUf",city,"leadsFound","isDemo","updatedAt") VALUES
 ('srch_alfa_00000001','tnt_alfa_0000000001','Dentista','SP','Campinas',4,true,now()),
 ('srch_beta_00000001','tnt_beta_0000000001','Academia','RJ','Niterói',1,true,now());

INSERT INTO leads (id,"tenantId","searchId",name,category,"addressCity","addressStateUf","phoneRaw",email,website,"websiteStatus","reviewCount","reviewRating",fingerprint,"isDemo","createdAt","updatedAt") VALUES
 ('lead_alfa_0000001','tnt_alfa_0000000001','srch_alfa_00000001','Clínica Sorriso Campinas','Dentista','Campinas','SP','(19) 99999-1234','contato@sorriso.example',NULL,'SEM_SITE',48,4.7,'fp-alfa-1',true,'2026-10-20 10:00','2026-10-20 10:00'),
 ('lead_alfa_0000002','tnt_alfa_0000000001','srch_alfa_00000001','OdontoVida Centro','Dentista','Campinas','SP','(19) 98888-4321',NULL,'https://odontovida.example','SITE_PRECARIO',12,4.1,'fp-alfa-2',true,'2026-10-20 10:05','2026-10-20 10:05'),
 ('lead_alfa_0000003','tnt_alfa_0000000001','srch_alfa_00000001','Dra. Helena Ortodontia','Dentista','Campinas','SP',NULL,NULL,NULL,'SEM_SITE',3,5.0,'fp-alfa-3',true,'2026-10-20 10:10','2026-10-20 10:10'),
 ('lead_alfa_0000004','tnt_alfa_0000000001','srch_alfa_00000001','Implante Prime','Dentista','Valinhos','SP','(19) 97777-1111',NULL,'https://implanteprime.example','DESCONHECIDO',77,4.3,'fp-alfa-4',true,'2026-10-20 10:15','2026-10-20 10:15'),
 ('lead_alfa_0000005','tnt_alfa_0000000001',NULL,'Padaria Pão Quente','Padaria','Campinas','SP',NULL,NULL,NULL,'SEM_SITE',20,4.0,'fp-alfa-5',true,'2026-10-21 09:00','2026-10-21 09:00'),
 ('lead_beta_00000001','tnt_beta_0000000001','srch_beta_00000001','Academia Beta Fit','Academia','Niterói','RJ','(21) 99999-0000',NULL,NULL,'SEM_SITE',9,4.4,'fp-beta-1',true,'2026-10-20 11:00','2026-10-20 11:00'),
 -- intruso: lead do Beta apontando para a pesquisa do Alfa (a FK searchId nao e composta)
 ('lead_beta_intruso1','tnt_beta_0000000001','srch_alfa_00000001','Lead do Beta com searchId do Alfa','Academia','Niterói','RJ',NULL,NULL,NULL,'SEM_SITE',1,3.0,'fp-beta-2',true,'2026-10-20 11:05','2026-10-20 11:05');

INSERT INTO lead_scores (id,"tenantId","leadId",value,level,"updatedAt") VALUES
 ('scr_alfa_000000001','tnt_alfa_0000000001','lead_alfa_0000001',82,'MUITO_ALTA',now()),
 ('scr_alfa_000000002','tnt_alfa_0000000001','lead_alfa_0000002',55,'MEDIA',now());
INSERT INTO lead_score_reasons (id,"tenantId","scoreId",code,label,weight,polarity,evidence) VALUES
 ('rsn_alfa_000000001','tnt_alfa_0000000001','scr_alfa_000000001','SEM_SITE','Sem site próprio',30,'POSITIVE','campo website vazio no cadastro do Maps'),
 ('rsn_alfa_000000002','tnt_alfa_0000000001','scr_alfa_000000001','MUITAS_AVALIACOES','Muitas avaliações (48)',18,'POSITIVE','48 avaliações com nota 4,7'),
 ('rsn_alfa_000000003','tnt_alfa_0000000001','scr_alfa_000000001','TEM_TELEFONE','Telefone disponível',14,'POSITIVE','telefone presente no cadastro'),
 ('rsn_alfa_000000004','tnt_alfa_0000000001','scr_alfa_000000001','TEM_EMAIL','E-mail disponível',10,'POSITIVE','e-mail presente no cadastro'),
 ('rsn_alfa_000000005','tnt_alfa_0000000001','scr_alfa_000000001','INSTAGRAM_DESCONHECIDO','Instagram não verificado',0,'POSITIVE','sinal DESCONHECIDO não pontua'),
 ('rsn_alfa_000000006','tnt_alfa_0000000001','scr_alfa_000000002','SITE_PRECARIO','Site em construtor gratuito',22,'POSITIVE','domínio de construtor gratuito');

INSERT INTO lead_digital_presences (id,"tenantId","leadId","hasWebsite","hasEmail","hasPhone","hasInstagram","hasFacebook","hasReviews","websiteHasHttps","whatsappStatus","lastCheckedAt","updatedAt") VALUES
 ('prs_alfa_000000001','tnt_alfa_0000000001','lead_alfa_0000001','AUSENTE','PRESENTE','PRESENTE','DESCONHECIDO','DESCONHECIDO','PRESENTE','DESCONHECIDO','LIKELY','2026-10-21 08:00',now());

INSERT INTO pipeline_stages (id,"tenantId",name,slug,"order","updatedAt") VALUES
 ('stg_alfa_000000001','tnt_alfa_0000000001','Novo','novo',0,now()),
 ('stg_alfa_000000002','tnt_alfa_0000000001','Contato feito','contato-feito',1,now());
INSERT INTO pipeline_cards (id,"tenantId","leadId","stageId","enteredStageAt","updatedAt") VALUES
 ('crd_alfa_000000001','tnt_alfa_0000000001','lead_alfa_0000001','stg_alfa_000000002','2026-10-22 09:00',now());

INSERT INTO digital_presence_audits (id,"tenantId","leadId","auditVersion",status,"finishedAt","createdAt","updatedAt") VALUES
 ('aud_alfa_000000001','tnt_alfa_0000000001','lead_alfa_0000001','audit-v1','COMPLETED','2026-10-21 08:01','2026-10-21 08:00',now());
INSERT INTO digital_presence_checks (id,"tenantId","auditId","check",outcome,"observedAt",confidence,result,"observedUrl") VALUES
 ('chk_alfa_000000001','tnt_alfa_0000000001','aud_alfa_000000001','DNS','FAILED','2026-10-21 08:00:10',1.0,'{"segredo":"nao-deve-sair"}','https://privado.example/x'),
 ('chk_alfa_000000002','tnt_alfa_0000000001','aud_alfa_000000001','HTTP_REACHABLE','SKIPPED',NULL,NULL,NULL,NULL),
 ('chk_alfa_000000003','tnt_alfa_0000000001','aud_alfa_000000001','HTTPS','SKIPPED',NULL,NULL,NULL,NULL);

INSERT INTO lead_notes (id,"tenantId","leadId",content,"createdAt","updatedAt")
 SELECT 'nte_alfa_'||lpad(g::text,9,'0'),'tnt_alfa_0000000001','lead_alfa_0000001','Nota '||g||' — conversa registrada pela equipe comercial. '||repeat('detalhe ',40),timestamp '2026-10-20 10:00' + (g||' hours')::interval,now() FROM generate_series(1,30) g;
INSERT INTO lead_activities (id,"tenantId","leadId",type,metadata,"createdAt") VALUES
 ('act_alfa_000000001','tnt_alfa_0000000001','lead_alfa_0000001','LEAD_CREATED','{"interno":"nao-deve-sair"}','2026-10-20 10:00'),
 ('act_alfa_000000002','tnt_alfa_0000000001','lead_alfa_0000001','SCORE_RECALCULATED','{}','2026-10-21 08:05'),
 ('act_alfa_000000003','tnt_alfa_0000000001','lead_alfa_0000001','STAGE_CHANGED','{}','2026-10-22 09:00');
INSERT INTO lead_contact_records (id,"tenantId","leadId",channel,direction,outcome,"occurredAt","updatedAt") VALUES
 ('cnt_alfa_000000001','tnt_alfa_0000000001','lead_alfa_0000001','WHATSAPP','SENT','sem resposta','2026-10-22 09:30',now());
INSERT INTO lead_follow_ups (id,"tenantId","leadId","dueAt","updatedAt") VALUES
 ('flw_alfa_000000001','tnt_alfa_0000000001','lead_alfa_0000001','2026-11-03 14:00',now());
COMMIT;

-- soft delete: nao pode aparecer no grafo
INSERT INTO lead_notes (id,"tenantId","leadId",content,"deletedAt","updatedAt") VALUES ('nte_alfa_apagada01','tnt_alfa_0000000001','lead_alfa_0000001','NOTA APAGADA nao deve aparecer',now(),now());
INSERT INTO leads (id,"tenantId",name,fingerprint,"isDemo","deletedAt","updatedAt") VALUES ('lead_alfa_apagado1','tnt_alfa_0000000001','Lead apagado do Alfa','fp-alfa-del',true,now(),now());

-- QA-01: filhos de um lead EXCLUIDO LOGICAMENTE (score, presenca, auditoria, cartao + filhos)
-- e um cartao "orfao": tenant Alfa apontando para lead do Beta (as FKs simples permitem).
BEGIN;
INSERT INTO lead_scores (id,"tenantId","leadId",value,level,"updatedAt") VALUES ('scr_alfa_apagado01','tnt_alfa_0000000001','lead_alfa_apagado1',40,'MEDIA',now());
INSERT INTO lead_score_reasons (id,"tenantId","scoreId",code,label,weight,polarity,evidence) VALUES ('rsn_alfa_apagado01','tnt_alfa_0000000001','scr_alfa_apagado01','SEM_SITE','MOTIVO DO LEAD APAGADO',30,'POSITIVE','x');
INSERT INTO lead_digital_presences (id,"tenantId","leadId","hasWebsite","hasEmail","hasPhone","hasInstagram","hasFacebook","hasReviews","websiteHasHttps","whatsappStatus","updatedAt") VALUES ('prs_alfa_apagado01','tnt_alfa_0000000001','lead_alfa_apagado1','AUSENTE','DESCONHECIDO','DESCONHECIDO','DESCONHECIDO','DESCONHECIDO','DESCONHECIDO','DESCONHECIDO','UNKNOWN',now());
INSERT INTO digital_presence_audits (id,"tenantId","leadId","auditVersion",status,"createdAt","updatedAt") VALUES ('aud_alfa_apagado01','tnt_alfa_0000000001','lead_alfa_apagado1','audit-v1','COMPLETED',now(),now());
INSERT INTO digital_presence_checks (id,"tenantId","auditId","check",outcome) VALUES ('chk_alfa_apagado01','tnt_alfa_0000000001','aud_alfa_apagado01','DNS','FAILED');
INSERT INTO pipeline_cards (id,"tenantId","leadId","stageId","enteredStageAt","updatedAt") VALUES ('crd_alfa_apagado01','tnt_alfa_0000000001','lead_alfa_apagado1','stg_alfa_000000001',now(),now());
-- orfao entre tenants
INSERT INTO pipeline_cards (id,"tenantId","leadId","stageId","enteredStageAt","updatedAt") VALUES ('crd_alfa_orfao00001','tnt_alfa_0000000001','lead_beta_00000001','stg_alfa_000000001',now(),now());
COMMIT;
