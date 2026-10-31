# SEC-DATA-01 — Encaminhamento: integridade relacional entre workspaces

**Origem:** P04-QA-01 (achado) e P04-QA-02 item 5 (correção do registro de `pipeline_cards`).
**Estado:** **proposta para decisão do dono. NÃO INICIADA. Não deve começar automaticamente.** Nenhuma migration foi escrita ou executada, `prisma/schema.prisma` não foi alterado, e nenhum comando foi enviado a banco algum além do banco local de bancada (somente leitura e `INSERT` sempre desfeitos por rollback).
**Separação:** este documento é independente da homologação do Intelligence Explorer e do `GATE-DB-42501`. O T1 de 01/11/2026 **não** é antecipado por ele. `F:\drmind` não foi modificado.

## 1. O problema, em uma frase

Seis relações usam FK **simples** (`leadId → leads.id`, `searchId → prospecting_searches.id`). O banco aceita, portanto, que uma linha do workspace A aponte para um registro do workspace B. A RLS impede *ler* o outro workspace, mas não impede *gravar* a referência — e uma linha incoerente depois quebra suposições de qualquer código que faça `JOIN` sem filtrar `tenantId` nos dois lados.

Isto é **integridade de dados**. Não é vazamento pelo Explorer: o Explorer lê dentro de `comTenant` (RLS) e filtra `tenantId` e `lead.deletedAt` em toda consulta (testado: serviço real, HTTP real no CI quando publicado, e bancada).

## 2. As seis relações (conjunto registrado, inalterado)

| # | Tabela.coluna | FK hoje | Cruzamento aceito? | Evidência |
|---|---|---|---|---|
| 1 | `leads.searchId` → `prospecting_searches(id)` | simples, `ON DELETE SET NULL` | sim | `integridade-check.out` |
| 2 | `lead_notes.leadId` → `leads(id)` | simples | sim | idem |
| 3 | `lead_activities.leadId` | simples | sim | idem |
| 4 | `lead_contact_records.leadId` | simples | sim | idem |
| 5 | `lead_follow_ups.leadId` | simples | sim | idem |
| 6 | `pipeline_cards.leadId` | simples + **índice único** em `leadId` | sim | `integridade-pipeline-cards.out`, teste (3) |

**Controles (o padrão seguro já existe):** `lead_scores`, `lead_digital_presences` e `digital_presence_audits` usam FK composta `(tenantId, leadId) → leads(tenantId, id)` e **recusaram** o cruzamento. `pipeline_cards` já usa FK composta para o estágio `(tenantId, stageId)` e recusou estágio de outro tenant.

**Nota sobre `pipeline_cards` (correção da QA-02).** A recusa `duplicate key … pipeline_cards_leadId_key` vista na QA-01 era *unicidade* (um cartão por lead), não proteção de tenant. O cruzamento só foi recusado nesse caso porque o lead escolhido já tinha cartão. Com um lead sem cartão, o cartão cruzado foi **aceito**. O índice único em `leadId` **permanece** na proposta: ele é regra de negócio (um cartão por lead) e é independente do tenant.

## 3. Pré-requisitos antes de qualquer migration

1. **Autorização específica do dono** para este item (nova convocação). Não é herdada de P04, QA-01 ou QA-02.
2. **Medir antes de mudar** — consultas somente leitura, como papel dono ou sistema (a RLS esconderia as linhas procuradas se rodadas como `propectai_app`):

```sql
SELECT 'leads.searchId' AS relacao, count(*) FROM leads l JOIN prospecting_searches s ON s.id = l."searchId" WHERE s."tenantId" <> l."tenantId"
UNION ALL SELECT 'lead_notes',           count(*) FROM lead_notes n           JOIN leads l ON l.id = n."leadId" WHERE l."tenantId" <> n."tenantId"
UNION ALL SELECT 'lead_activities',      count(*) FROM lead_activities a      JOIN leads l ON l.id = a."leadId" WHERE l."tenantId" <> a."tenantId"
UNION ALL SELECT 'lead_contact_records', count(*) FROM lead_contact_records c JOIN leads l ON l.id = c."leadId" WHERE l."tenantId" <> c."tenantId"
UNION ALL SELECT 'lead_follow_ups',      count(*) FROM lead_follow_ups f      JOIN leads l ON l.id = f."leadId" WHERE l."tenantId" <> f."tenantId"
UNION ALL SELECT 'pipeline_cards',       count(*) FROM pipeline_cards p       JOIN leads l ON l.id = p."leadId" WHERE l."tenantId" <> p."tenantId";
```

   Em produção, só com autorização específica e somente leitura. Resultado esperado: zero em todas. Se não for zero, o dono decide **corrigir ou arquivar** cada linha antes do passo 5.
3. Backup lógico das tabelas afetadas e janela combinada. Nenhuma execução no servidor sem o dono.
4. Revisar outros módulos que façam `JOIN` por essas colunas sem filtrar `tenantId` nos dois lados (não auditado nas ordens QA-01/QA-02).

## 4. Estratégia proposta (cada passo em migration própria, reversível isoladamente)

> Os trechos abaixo são **ilustrativos e não foram executados**. O Prisma não modela algumas cláusulas; a migration precisaria de SQL manual e de revisão do dono.

| Passo | O quê | Observação |
|---|---|---|
| 1 | `@@unique([tenantId, id])` em `ProspectingSearch` | Hoje ausente (`Lead` já tem). Necessário como alvo da FK composta de `leads.searchId`. Índice novo; não bloqueia leitura |
| 2 | Rodar as consultas da seção 3 e **resolver** linhas incompatíveis | Decisão do dono; backup antes. Sem rollback automático |
| 3 | Criar as FKs compostas **`NOT VALID`**: `(tenantId, leadId) → leads(tenantId, id)` nas cinco tabelas por lead e `(tenantId, searchId) → prospecting_searches(tenantId, id)` em `leads` | `NOT VALID` não valida o legado e não bloqueia escrita; já faz valer a regra para linhas novas |
| 4 | `VALIDATE CONSTRAINT` em cada FK nova, depois da limpeza | Pega o legado sem travar escritas |
| 5 | Remover as FKs simples antigas | Só depois do passo 4 de cada relação |

**Pontos de atenção técnicos:**

- `leads.searchId` hoje é `ON DELETE SET NULL`. Em FK composta, `SET NULL` anularia também `tenantId` (NOT NULL → erro). É preciso `ON DELETE SET NULL ("searchId")` (PostgreSQL 15+; produção é 16). O Prisma não expressa essa lista de colunas: SQL manual na migration, e o `schema.prisma` precisaria continuar descrevendo a relação sem divergir do banco (verificar com `prisma migrate diff` quando houver ambiente).
- As relações por lead hoje têm `ON DELETE CASCADE`; a FK composta com `CASCADE` mantém o comportamento.
- O índice único `pipeline_cards_leadId_key` permanece.
- Em tabelas grandes, `CREATE INDEX CONCURRENTLY` para os índices de apoio (fora de transação).
- O papel que roda a migration é `propectai_dono` (não superusuário), como no DB-REM-06; o CI já exercita os dois estágios de migration.

## 5. Rollback

Por migration: recriar a FK simples (superconjunto das linhas válidas, portanto o retorno nunca falha) e descartar a composta. O passo 2 (correção de dados) não tem rollback automático — daí o backup lógico prévio.

## 6. Como provar depois (critérios de aceite sugeridos)

1. O mesmo teste `integridade-check.sql` + `integridade-pipeline-cards.sql`, com as seis tentativas de cruzamento **recusadas por FK** (nenhuma por unicidade).
2. `gate-rls.sql` e a suíte completa verdes no CI.
3. Consulta da seção 3 retornando zero **antes** do `VALIDATE`.
4. Nenhum `DROP`/`TRUNCATE`/`DELETE` fora do passo 2 aprovado.

## 7. O que NÃO está autorizado por este documento

Escrever ou rodar migration, alterar `schema.prisma`, tocar produção, corrigir dados, antecipar o `GATE-DB-42501` T1, ou iniciar o `SEC-DB-02`. A decisão de abrir o `SEC-DATA-01` é do dono.
