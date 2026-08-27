# CURRENT ARCHITECTURE — estado real do ProspectAI

**Data:** 22/08/2026 · **Fase:** Prompt 01, STEP 3
**Método:** leitura direta de `prisma/schema.prisma` (1.434 linhas), estrutura de `apps/`, `packages/`, e da documentação técnica do projeto
**Marcadores:** `CURRENT / CONFIRMED` salvo indicação contrária

---

## 1. O achado central do STEP 3

> **O ProspectAI já possui uma versão embrionária, de provider único, da arquitetura que o Prompt 02 quer generalizar.**

O pipeline de aquisição existente:

```text
ProspectingSearch     o que buscar (nicho, país, UF, cidade, raio, filtros)
       |
       v
ScrapeJob             execução — status, idempotencyKey, attempts, maxAttempts,
       |                        errorCode, durationMs, queuedAt/startedAt/finishedAt
       v
LeadSourceRecord      resposta bruta — payload Json, source, sourceId, collectedAt
       |
       v
Lead                  entidade normalizada — fingerprint para dedup
       |
       +--> LeadDigitalPresence    sinais em três estados
       +--> LeadScore              valor, nível, algorithmVersion
             +--> LeadScoreReason  code, label, weight, polarity, evidence
```

Comparando com o alvo do Prompt 02 §4:

| Prompt 02 quer | ProspectAI já tem | Diferença |
|---|---|---|
| `IntelligenceRun` | `ScrapeJob` | Existe estado, idempotência, tentativas e duração. Falta capability e provider selecionado |
| `RawSnapshot` | `LeadSourceRecord` | Existe payload, origem e `collectedAt`. Falta `contentHash`, `schemaVersion`, `retentionUntil` |
| `CanonicalIdentity` | `Lead.fingerprint` | Existe dedup determinística. Falta separar identidade canônica de referências externas |
| `NormalizedEvidence` | `LeadScoreReason.evidence` | Existe o conceito — é `String?` livre, não estruturado |
| `Confidence` | `SignalState` de três estados | Mais honesto que número inventado, mas não é escala |
| `UsageMeter` | `PlanUsage` | Conta unidades. Não conta custo em moeda |
| `FeatureFlag` | `FeatureFlag` por tenant | Pronto |
| `Entitlements` | módulo `entitlements` | Pronto |

**Consequência para o Prompt 01:** a foundation não parte do zero. Ela **generaliza** um pipeline que já funciona com um provider, para N providers. Isso reduz risco e reduz escopo, e deve ficar explícito na arquitetura-alvo.

---

## 2. Stack confirmada

| Camada | Tecnologia | Evidência |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | `pnpm-workspace.yaml`, `turbo.json` |
| `apps/web` | Next.js App Router, Tailwind | porta 3100 |
| `apps/api` | NestJS, Prisma, Swagger | porta 3101 |
| `apps/worker` | Node + BullMQ | consome fila do Redis |
| `packages/` | `config`, `types` | apenas dois — `ui` e `sdk` citados no `CLAUDE.md` não existem no disco |
| Banco | PostgreSQL 16 | porta 5434 (deslocada de propósito) |
| Fila | Redis 7 + BullMQ | porta 6381 |
| Coleta | `gosom/google-maps-scraper` em container | porta 8081, só em dev |

**Divergência registrada:** `CLAUDE.md` lista `packages/ui` e `packages/sdk`; o disco tem apenas `config` e `types`. `HYPOTHESIS` — ou foram planejados e não criados, ou removidos sem atualizar a documentação.

---

## 3. Módulos da API

```text
apps/api/src/
  account      admin        auth         billing      common
  dashboard    entitlements leads        notifications outreach
  pipeline     prisma       prospecting  redis        segments
  system       team
```

**Não existe módulo `intelligence`.** Confirma que a foundation do Prompt 02 é construção nova, e indica onde ela entra: ao lado de `prospecting`, não dentro dele.

`prospecting` é o módulo de aquisição atual e é o candidato natural a primeiro consumidor do futuro `ProviderRouter`.

---

## 4. Modelo de dados — 40 modelos, 24 enums

### 4.1 Multi-tenancy

**30 dos 40 modelos carregam `tenantId`.** Os 10 restantes:

| Modelo | Justificativa |
|---|---|
| `User`, `Tenant`, `Plan`, `PlatformAdmin`, `RefreshToken` | Globais por natureza |
| `Segment`, `SegmentLocale` | Taxonomia compartilhada — coerente com a decisão de `lacunas-estruturais.md` §4 |
| `ProposalItem` | Filho de `Proposal`, que é tenant-aware |
| `LeadTag` | Tabela de junção entre `Lead` e `Tag`, ambos tenant-aware |
| `BillingEvent` | `REQUIRES VALIDATION` — herda tenant via `Subscription`? Confirmar antes de tratar como isolado |

**Conclusão:** a multi-tenancy é row-level, aplicada de forma consistente. O Prompt 01 §8.1 deve **documentar essa estratégia**, não projetá-la.

### 4.2 O ponto de atenção mais relevante

O modelo `Lead` carrega **identificadores específicos de provider como colunas diretas**:

```prisma
placeId   String?   // Google Maps
cid       String?   // Google Maps
sourceUrl String?
source    LeadSource   // enum
```

O Prompt 02 §33 é explícito sobre isso:

> `google_place_id != company primary identity`

Hoje não é defeito — há um provider só, e `fingerprint` já faz o papel de chave canônica. **Vira dívida no momento em que existir um segundo provider**, porque não há onde pendurar `builtwith_id`, `linkedin_id` ou `flowsint_node_id` sem adicionar coluna a cada novo provider.

É o candidato mais claro a `ExternalReference` (Prompt 02 §34), e deve entrar no roadmap como pré-requisito do segundo provider — não antes.

### 4.3 `source` é enum, não registry

`LeadSource` é um enum Prisma. Adicionar um provider exige migration.

O Prompt 02 §18 pede `ProviderRegistry` com descoberta de capability e lookup de versão. **Esse é um gap estrutural real**, não cosmético: enum e registry são modelos incompatíveis de extensibilidade.

---

## 5. O que já está alinhado com a foundation

Registrado porque reduz o escopo do Prompt 02:

| Requisito do Prompt 02 | Situação |
|---|---|
| §12 TenantContext propagado | Row-level em 30 modelos, `TenantGuard` no NestJS a confirmar em código |
| §13 Plans/entitlements/quotas | `Plan`, `Subscription`, `PlanUsage`, módulo `entitlements` |
| §45 Idempotência | `ScrapeJob.idempotencyKey` existe |
| §47 Async/queue | BullMQ operante, worker separado |
| §42 Usage metering | `PlanUsage` conta leads, buscas, exports, gerações de IA |
| §51 Feature flags | `FeatureFlag` por tenant, com payload Json |
| §31 Temporal | `collectedAt`, `lastCheckedAt`, `lastEnrichedAt`, `calculatedAt` |
| §76 Privacy | Regra 6 do `CLAUDE.md` descarta PII de terceiros na normalização |

---

## 6. O que falta para a foundation

| Componente do Prompt 02 | Estado |
|---|---|
| `ProviderRegistry` | `TARGET` — hoje é enum |
| `ProviderRouter` | `TARGET` |
| `ProviderSelectionPolicy` | `TARGET` |
| `ProviderHealth` | `TARGET` |
| `CostGuard` / `TenantBudget` | `TARGET` — `PlanUsage` conta unidades, não moeda |
| Schema validation / drift / quarantine | `TARGET` |
| `contentHash`, `schemaVersion`, `retentionUntil` no snapshot | `TARGET` |
| `providerVersion` / `adapterVersion` | `TARGET` |
| Field-level lineage estruturado | `TARGET` — `evidence:String?` é o embrião |
| `first_seen` / `last_seen` por campo | `TARGET` |
| `ExternalReference` / `CanonicalIdentity` explícita | `TARGET` |
| Confidence numérica | `TARGET` — hoje três estados, decisão a registrar |

---

## 7. Decisão de arquitetura que este mapeamento sugere

`HYPOTHESIS / REQUIRES VALIDATION` — a ser confirmada no STEP 6

O caminho de menor risco não é criar um `IntelligenceModule` paralelo ao `prospecting`, mas **extrair de `prospecting` o que já é genérico** e deixá-lo como primeiro adapter:

```text
hoje                          alvo
────                          ────
prospecting                   intelligence/
  └── scraper direto            ├── core        (run, state machine, tenant, idempotência)
                                ├── acquisition (registry, router, policy, health)
                                └── adapters/
                                     └── maps   (o scraper atual, encapsulado)
```

Isso satisfaz o Prompt 02 §5 sem reescrever o que funciona, e dá ao Router um segundo provider real para exercitar assim que a auditoria da v0.2 existir.

---

## 8. Pendências do baseline

| # | Item | Efeito |
|---|---|---|
| W3 | Baseline de testes não executado | Não há linha de base para provar ausência de regressão |
| W4 | `git status`, branch e commit não coletados | Baseline do §5.1 incompleto |
| — | `TenantGuard` / `TenantContext` não lidos em código | A afirmação de propagação segue `HYPOTHESIS` até verificação |
| — | `BillingEvent` sem `tenantId` | Confirmar herança via `Subscription` |
| — | `packages/ui` e `packages/sdk` documentados e ausentes | Corrigir `CLAUDE.md` ou criar |
