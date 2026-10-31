# P04-QA-01 — Integridade relacional: referência entre workspaces

**Estado:** achado registrado para decisão do dono. **Nenhuma migration foi escrita ou executada.** `F:\drmind` não foi modificado.

## Condição atual (medida no schema real, banco local de bancada)

Teste `integridade-check.sql` (desfeito por rollback; papel dono, como uma migration faria):

| Tabela / coluna | FK | Referência cruzada (tenant A → registro do tenant B) |
|---|---|---|
| `leads.searchId` → `prospecting_searches` | simples | **ACEITA** |
| `lead_notes.leadId` → `leads` | simples | **ACEITA** |
| `lead_activities.leadId` | simples | **ACEITA** |
| `lead_contact_records.leadId` | simples | **ACEITA** |
| `lead_follow_ups.leadId` | simples | **ACEITA** |
| `pipeline_cards.leadId` | simples | **ACEITA** (um cartão cruzado já existe no banco de bancada: o INSERT de semente foi aceito) |
| `lead_scores`, `lead_digital_presences`, `digital_presence_audits` | **composta** `(tenantId, leadId)` | RECUSADA |

O padrão seguro já existe no schema (`@@unique([tenantId, id])` em `Lead` e FKs compostas nos três filhos acima). As seis relações simples são a exceção.

## Impacto no Explorer

Nenhum vazamento: o serviço lê dentro de `comTenant` (RLS), põe `tenantId` em todo `where` e agora exige `lead: { tenantId, deletedAt: null }` para score/presença/auditoria/cartão. Os testes do serviço real e o spec HTTP cobrem o cartão cruzado (404 para os dois workspaces) e o lead do Beta com `searchId` do Alfa (sem nó de pesquisa). O risco restante é de **integridade de dados** (linhas incoerentes poderem existir), não de leitura pelo Explorer. Outros módulos que leiam essas colunas sem o mesmo cuidado não foram auditados nesta ordem.

## Registros possivelmente incompatíveis (consultas somente leitura, para o dono rodar quando autorizar)

```sql
SELECT 'leads.searchId' AS relacao, count(*) FROM leads l JOIN prospecting_searches s ON s.id = l."searchId" WHERE s."tenantId" <> l."tenantId"
UNION ALL SELECT 'lead_notes',            count(*) FROM lead_notes n            JOIN leads l ON l.id = n."leadId" WHERE l."tenantId" <> n."tenantId"
UNION ALL SELECT 'lead_activities',       count(*) FROM lead_activities a       JOIN leads l ON l.id = a."leadId" WHERE l."tenantId" <> a."tenantId"
UNION ALL SELECT 'lead_contact_records',  count(*) FROM lead_contact_records c  JOIN leads l ON l.id = c."leadId" WHERE l."tenantId" <> c."tenantId"
UNION ALL SELECT 'lead_follow_ups',       count(*) FROM lead_follow_ups f       JOIN leads l ON l.id = f."leadId" WHERE l."tenantId" <> f."tenantId"
UNION ALL SELECT 'pipeline_cards',        count(*) FROM pipeline_cards p        JOIN leads l ON l.id = p."leadId" WHERE l."tenantId" <> p."tenantId";
```

Executar como papel dono ou sistema, **não** como `propectai_app` (a RLS esconderia exatamente as linhas procuradas). Em produção, somente com autorização específica.

## Alternativa proposta

Para cada relação: trocar a FK simples por FK composta `(tenantId, leadId) → leads(tenantId, id)` (e `(tenantId, searchId) → prospecting_searches(tenantId, id)`), seguindo o padrão já adotado em score/presença/auditoria. Estratégia em quatro passos, cada um em migration própria: (1) adicionar `@@unique([tenantId, id])` em `ProspectingSearch`, se faltar; (2) rodar as consultas acima e **corrigir ou arquivar** as linhas incompatíveis, por decisão do dono; (3) criar a FK composta `NOT VALID` (não bloqueia escrita nem valida o legado); (4) `VALIDATE CONSTRAINT` depois da limpeza e só então remover a FK simples. `searchId` tem `onDelete: SetNull`: a FK composta exige `SET NULL (searchId)` (PostgreSQL 15+) para não anular `tenantId` (o Prisma não modela essa cláusula: exigiria SQL manual na migration).

## Rollback

Cada migration é reversível isoladamente: recriar a FK simples e descartar a composta (a simples é um superconjunto das linhas válidas, então o retorno nunca falha). Passo (2) não tem rollback automático — fazer backup lógico das linhas alteradas antes.

## Encaminhamento

Pedir autorização específica ao dono. Não misturar com a homologação do Explorer nem com GATE-DB-42501.
