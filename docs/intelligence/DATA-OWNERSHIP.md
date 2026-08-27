# DATA OWNERSHIP

**Data:** 22/08/2026 · **Fase:** Prompt 01, STEP 7
**Regra:** um dono por dado. Sem exceção não documentada.

---

## 1. System of Record

**PostgreSQL 16 é o System of Record de todo dado do produto.** `CURRENT / CONFIRMED`

Não existe segundo datastore transacional. O Redis é fila e cache — **nada nele é fonte da verdade**, e nada pode passar a ser sem ADR.

Isso é resposta direta ao §10 do Prompt 01, e a decisão é confirmada por ausência de alternativa: não há Neo4j, não há store de documentos, não há data warehouse. A arquitetura é mais simples do que o prompt presume, e isso é uma vantagem a preservar.

Ver ADR-003.

---

## 2. Tabela de ownership

| Entidade | Contexto dono | Escreve | Lê | Store |
|---|---|---|---|---|
| `User`, `Tenant`, `Membership`, `Invitation`, `RefreshToken`, `PlatformAdmin` | Identity & Access | IAM | todos | PG |
| `Plan`, `Subscription`, `Invoice`, `BillingEvent` | Plans & Billing | Billing | Entitlements, Admin | PG |
| `PlanUsage` | Plans & Billing | Billing, Aquisição¹ | Entitlements, Dashboard | PG |
| `FeatureFlag`, `AppSetting` | Plans & Billing | Admin | todos | PG |
| `Segment`, `SegmentLocale` | Taxonomy | Admin de plataforma | Aquisição, Web | PG · **global** |
| `ProspectingSearch`, `ScrapeJob`, `LeadSourceRecord` | Prospecting | Prospecting | Intelligence² | PG |
| `Lead` | Lead / CRM | **CRM** | todos os comerciais | PG |
| `LeadDigitalPresence` | Lead / CRM | CRM via porta³ | CRM, Scoring | PG |
| `LeadScore`, `LeadScoreReason` | Lead / CRM | Scoring | CRM, Web | PG |
| `LeadActivity`, `LeadNote`, `LeadContactRecord`, `LeadFollowUp` | Lead / CRM | CRM | CRM | PG |
| `Tag`, `LeadTag`, `SuppressionEntry` | Lead / CRM | CRM | CRM, Aquisição⁴ | PG |
| `PipelineStage`, `PipelineCard`, `PipelineTransition` | Pipeline | Pipeline | CRM, Dashboard | PG |
| `OutreachMessage` | Outreach | Outreach | CRM | PG |
| `Proposal`, `ProposalItem`, `Contract` | Commercial Docs | Proposals | Pipeline | PG |
| `Notification`, `ExportJob`, `OnboardingState` | Platform Services | respectivos | Web | PG |
| `AuditLog` | Platform Services | **todos, append-only** | Admin | PG |

**Notas:**

1. `PlanUsage` é o único caso de escrita por dois contextos. A Aquisição incrementa contadores de consumo. **Toda escrita deve passar por um serviço do contexto Plans**, nunca por acesso direto à tabela — é a regra que preserva o dono único.
2. Intelligence **lê** `LeadSourceRecord` para reprocessar; não escreve.
3. `LeadDigitalPresence` é onde a Intelligence entrega sinais. A escrita ocorre **através de uma porta do CRM**, não direto — o CRM valida e o sinal nunca vira `AUSENTE` sem verificação.
4. `SuppressionEntry` é lida pela Aquisição para não recoletar lead suprimido.

---

## 3. Regra crítica: `LeadDigitalPresence`

É o ponto onde a Intelligence toca o CRM, e onde o produto pode se corromper.

**Invariante herdada do `scoring.md` §2, elevada a regra de arquitetura:**

> Nenhum contexto pode gravar `AUSENTE` sem evidência de verificação que efetivamente ocorreu.

Consequências:

| Regra | Efeito |
|---|---|
| Escrita só via `DigitalPresencePort` | Nenhum adapter escreve direto na tabela |
| Porta exige evidência para `PRESENTE` e `AUSENTE` | `DESCONHECIDO` é o único estado sem evidência |
| Sem evidência, a escrita é rejeitada | Não é aviso de log — é rejeição |

Esta invariante é testável, e deve virar teste unitário e fitness function.

---

## 4. Multi-tenancy

**Row-level, com `tenantId` em 30 dos 40 modelos.** `CURRENT / CONFIRMED`

### Os 10 sem `tenantId`

| Modelo | Classificação |
|---|---|
| `User`, `Tenant`, `Plan`, `PlatformAdmin`, `RefreshToken` | Global por natureza — correto |
| `Segment`, `SegmentLocale` | Catálogo global compartilhado — correto e decidido |
| `ProposalItem` | Herda de `Proposal` por FK |
| `LeadTag` | Junção entre dois modelos tenant-aware |
| `BillingEvent` | **`REQUIRES VALIDATION`** — confirmar herança via `Subscription` antes de tratar como isolado |

### Mecanismo de aplicação

`HYPOTHESIS / REQUIRES VALIDATION` — o `TenantGuard` não foi lido em código

O que a arquitetura-alvo exige, independente do que exista hoje:

1. `TenantContext` resolvido no middleware e propagado por toda a cadeia
2. **Nenhum job assíncrono sem `tenantId` no envelope** — o worker não deve conseguir executar sem ele
3. Chave de cache inclui tenant
4. Teste de isolamento no CI que falhe se alguma query escapar do filtro

O item 4 é o que transforma disciplina em estrutura. Sem ele, é questão de tempo até uma query esquecer o filtro.

---

## 5. Retenção e classificação

| Dado | Classificação | Retenção |
|---|---|---|
| `LeadSourceRecord.payload` | Público corporativo, já filtrado de PII | **Indefinida hoje** — ver risco abaixo |
| `Lead` — dados de negócio | Público corporativo | Vida do tenant |
| `Lead.email`, `phoneE164` | Contato corporativo | Vida do tenant |
| Avaliações individuais | **PROIBIDO** — descartado na normalização | Nunca persistido |
| `AuditLog` | Metadado operacional | A definir |
| Snapshot bruto futuro | A classificar por provider | **Curta**, conforme Prompt 02 §27 |

**Risco aberto:** `LeadSourceRecord.payload` é `Json` sem política de retenção nem limite de tamanho. Cresce indefinidamente e é o candidato natural a virar o `RawSnapshot` do Prompt 02 §27 — com `contentHash`, `retentionUntil` e limite.

**Ponto forte a preservar:** a regra 6 do `CLAUDE.md` descarta `user_reviews`, `user_reviews_extended` e `owner` **na normalização, antes de gravar**. PII de terceiro nunca entra no banco. Isso resolve boa parte do §19 do Prompt 01 antes de ele ser feito.

---

## 6. O que muda com a foundation

| Entidade nova | Dono | Observação |
|---|---|---|
| `IntelligenceRun` | Intelligence Core | Ou evolução do `ScrapeJob` — ver ADR-003 |
| `RawSnapshot` | Intelligence Evidence | Evolução do `LeadSourceRecord` |
| `Evidence` / `FieldLineage` | Intelligence Evidence | Novo |
| `ExternalReference` | Lead / CRM | **Dono é o CRM**, não a Intelligence — é atributo da entidade canônica |
| `ProviderHealth` | Intelligence Acquisition | Pode ser global, não por tenant |
| `Quarantine` | Intelligence Acquisition | Nunca exposto ao usuário final |

**`ExternalReference` pertencer ao CRM é a decisão menos óbvia e a mais importante.** O `placeId` é atributo do lead, não da execução que o descobriu. Colocá-lo na Intelligence criaria dependência do CRM para a Intelligence — exatamente a direção proibida no `BOUNDED-CONTEXTS.md` §1.

---

## 7. Riscos de ownership

| Risco | Situação | Mitigação |
|---|---|---|
| `PlanUsage` escrito por dois contextos | Real | Serviço único do contexto Plans |
| `payload` sem retenção nem limite | Real | Política com o `RawSnapshot` |
| `BillingEvent` sem tenant | A confirmar | Validar herança |
| Intelligence escrever direto em `LeadDigitalPresence` | Se ocorrer, quebra a invariante | Porta obrigatória + fitness function |
| Ids de provider como coluna do `Lead` | Real (G3) | `ExternalReference` antes do 2º provider |
