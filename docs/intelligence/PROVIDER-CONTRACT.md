# PROVIDER CONTRACT e EVIDENCE MODEL

**Data:** 22/08/2026 · **Fase:** Prompt 01, STEP 10
**Cobre:** contrato de provider, pipeline de enrichment, evidência, lineage e confiança

---

## 1. Princípio

Do Prompt 02 §6, e é o que organiza tudo aqui:

> **Feature** define valor · **capability** define o que executar · **provider** define quem executa · **adapter** traduz · **router** decide.

Aplicado ao caso concreto:

```text
Feature:     "Auditoria de presença digital"          (o que a agência compra)
Capability:  WEBSITE_HEALTH_AUDIT                     (o que o sistema executa)
Provider:    NativeSiteAuditor                        (quem executa)
Adapter:     site-audit-adapter v1                    (traduz para contrato interno)
Router:      escolhe entre providers disponíveis      (decide)
```

---

## 2. Capabilities

Catálogo inicial, derivado do que tem consumidor real — não da lista completa do Prompt 02 §8.

| Capability | Consumidor | Estado |
|---|---|---|
| `LEAD_DISCOVERY` | Busca de prospects | `CURRENT` — scraper de Maps |
| `WEBSITE_HEALTH_AUDIT` | v0.2 Fase 1 | `TARGET` — próximo |
| `SITE_CLASSIFICATION` | v0.2 Fase 2 | `TARGET` |
| `SOCIAL_LINK_DISCOVERY` | v0.2 Fase 3 | `TARGET` — 69% de cobertura medida |
| `TECH_STACK_DETECTION` | Futuro | `DEFERRED` — licenciar, não construir |

**Regra:** capability sem consumidor identificado não entra no registry. É a aplicação do §48 do Prompt 01.

---

## 3. O contrato

```typescript
interface IntelligenceProvider {
  readonly id: string;              // 'native-site-auditor'
  readonly version: string;         // '1.0.0' — semver
  readonly capabilities: Capability[];
  readonly privacyClass: PrivacyClassification;   // §4 do SECURITY

  supports(capability: Capability, subject: SubjectType): boolean;
  validateInput(input: unknown): ValidationResult;
  estimateCost(input: Input, ctx: TenantContext): Promise<CostEstimate>;
  health(): Promise<ProviderHealth>;
  execute(input: Input, ctx: ExecutionContext): Promise<RawResult>;
}

interface ProviderAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly providerId: string;
  readonly rawSchemaVersion: string;
  readonly normalizedSchemaVersion: string;

  validate(raw: RawResult): ContractValidation;   // VALID | INVALID | SCHEMA_DRIFT
  normalize(raw: RawResult): NormalizedResult;
  produceEvidence(normalized: NormalizedResult): Evidence[];
}
```

**Separar provider de adapter** permite versionar a tradução independentemente da fonte: quando o Google Maps muda um campo, muda o adapter, não o provider.

### Regras

1. Nenhum tipo de provider externo cruza a fronteira do adapter
2. `execute` devolve dado bruto — normalizar é do adapter
3. Todo provider tem par mock, e **teste não pode chamar provider real** — é proteção de orçamento, não higiene
4. `health()` não faz requisição externa em caminho crítico; lê estado agregado

---

## 4. Pipeline

```text
Request
  → Authorize Tenant          TenantContext obrigatório
  → Check Entitlement         EntitlementsService, já existe
  → Check Quota               PlanUsage, já existe
  → Estimate Cost             CostEstimate
  → CostGuard                 ALLOW | ALLOW_CHEAPER | BLOCK
  → Route                     Router escolhe provider + fallback chain
  → Execute                   provider, com egress policy aplicada
  → Snapshot                  RawSnapshot com contentHash
  → Validate                  VALID | INVALID | SCHEMA_DRIFT
  → [drift] → Quarantine      não contamina o store normalizado
  → Normalize                 adapter traduz
  → Resolve Entity            fingerprint hoje; ExternalReference depois
  → Persist Evidence          com lineage
  → Project to CRM            via porta, nunca direto
  → Meter Usage               unidades + custo
  → Audit                     AuditLog
```

Estados do run: `REQUESTED` · `AUTHORIZED` · `ROUTING` · `QUEUED` · `RUNNING` · `COMPLETED` · `PARTIAL` · `FAILED` · `CANCELLED`

**`PARTIAL` é o mais importante e o mais esquecido.** Três de cinco verificações concluíram: o que o usuário vê, o que é cobrado, o que é reprocessado. Sem resposta explícita, o comportamento vira acidente de implementação.

**Decisão:** `PARTIAL` persiste o que obteve, com evidência do que falhou. Cobra pelo que executou. Reprocessável apenas nas verificações que falharam.

### Sobre o `ScrapeJob`

`ScrapeJob` já tem estado, `idempotencyKey`, `attempts`, `maxAttempts`, `errorCode` e `durationMs`.

**Recomendação: estender, não criar `IntelligenceRun` paralelo.** Adicionar `capability`, `providerId`, `adapterVersion`, `estimatedCost`, `actualCost`. É migration aditiva, preserva histórico e evita dois modelos concorrentes para a mesma coisa.

---

## 5. Evidência

Toda conclusão exibida ao usuário aponta para uma evidência. É o que o `scope-v0.2.md` §4 exige do relatório: *"evidência e data em cada afirmação — o prospect precisa poder conferir"*.

```typescript
interface Evidence {
  id: string;
  tenantId: string;
  runId: string;

  subjectType: 'LEAD' | 'COMPANY';
  subjectId: string;
  field: string;              // 'website.hasHttps'
  value: unknown;
  dataType: string;

  providerId: string;
  providerVersion: string;
  adapterVersion: string;
  sourceReference: string;    // URL exata verificada

  collectedAt: Date;          // quando o sistema coletou
  observedAt?: Date;          // quando o fato ocorreu, se conhecido
  firstSeen: Date;
  lastSeen: Date;

  confidence?: number;        // 0..1, apenas se o provider fornecer
  classification: PrivacyClassification;
  status: 'ACTIVE' | 'SUPERSEDED' | 'EXPIRED';
}
```

### Duas regras que evitam corrupção

**Nunca inventar confiança.** Se o provider não fornece, o campo fica ausente. Um número inventado com aparência de dado é pior que a ausência — e contradiz a regra fundadora do `scoring.md` §2.

**`sourceReference` é a URL exata**, não o domínio. É o que permite ao prospect conferir, e é o que torna o relatório defensável.

---

## 6. Lineage

`LeadScoreReason.evidence` já é o embrião — um `String?` livre. O passo é torná-lo estruturado.

Cada campo normalizado responde: **de onde veio esse valor?**

```text
lead.digitalPresence.hasInstagram = PRESENTE

  evidenceId:      ev_01H...
  provider:        native-site-auditor@1.0.0
  adapter:         site-audit@1
  sourceReference: https://clinica.com.br/  (rodapé)
  method:          LINK_EXTRACTION
  collectedAt:     2026-08-22T14:32:00Z
  firstSeen:       2026-08-22T14:32:00Z
  confidence:      —  (determinístico)
```

Quando dois providers divergirem sobre o mesmo campo, o lineage é o que permite decidir — e explicar a decisão.

---

## 7. Confiança

Cinco números que **nunca** se somam nem se misturam:

| Tipo | Origem | Escala |
|---|---|---|
| Confiança do provider | O provider fornece | 0..1 ou ausente |
| Confiança de resolução de entidade | Matching | 0..1 |
| Confiança de sinal | Método de descoberta | **três estados** |
| Confiança de score | Cobertura dos fatores | derivada |
| Confiança de inferência de IA | Fora de escopo | — |

**Decisão sobre sinais: manter os três estados, não migrar para 0..1.**

`PRESENTE` / `AUSENTE` / `DESCONHECIDO` é mais honesto que um número, e a regra "`DESCONHECIDO` nunca pontua" é mais forte que qualquer limiar. Só reabrir se um provider passar a fornecer confiança real e contínua.

### Apresentação

`0.73` não significa nada para um vendedor. A tradução acontece na borda:

| Interno | Interface |
|---|---|
| Determinístico, com evidência | "Verificado em 22/08 às 14h32" |
| Confiança alta | "Provável" |
| Confiança baixa | não exibir |
| `DESCONHECIDO` | "Não verificado" — cinza neutro |

Coerente com `scoring.md` §2, que já determina o cinza neutro para não verificado.

---

## 8. Custo — o gap G6

**Nenhum modelo tem campo de custo em moeda.** `PlanUsage` conta `leadsReserved`, `searchesCount`, `aiGenerationsCount` — nada em reais.

Sem isso, o `CostGuard` do Prompt 02 §25 não tem onde se apoiar, e a margem só aparece na fatura.

```typescript
interface UsageEvent {
  tenantId: string; userId?: string;
  runId: string; capability: Capability;
  providerId: string; providerVersion: string;
  units: number;
  estimatedCostCents: number;   // antes de executar
  actualCostCents: number;      // depois
  currency: 'BRL';
  success: boolean; emptyResult: boolean;
  occurredAt: Date;
}
```

**`emptyResult` separado de `success`** é a distinção que revela provider ruim: executou, cobrou, não trouxe nada.

**Quando resolver:** antes do primeiro provider pago. Enquanto tudo é nativo, o custo é infraestrutura, não por chamada — e a urgência é menor. **Mas a coluna deve nascer com o modelo**, porque adicioná-la depois exige migration em tabela com volume.

---

## 9. Router e seleção

O Router é o único componente que escolhe provider. Nenhum controller, service ou adapter escolhe.

Critérios, em ordem: capability suportada → provider habilitado no ambiente → entitlement do tenant → health ≠ `UNAVAILABLE` → custo dentro do budget → prioridade da política.

**A decisão é auditável:**

```text
Selected:  native-site-auditor@1.0.0
Reason:    ONLY_HEALTHY_PROVIDER_FOR_CAPABILITY
Fallback:  (nenhum)
Cost:      R$ 0,00 (nativo)
```

### Health conhecido antes de existir

O Gate 0 já mediu dois providers hipotéticos:

| Provider hipotético | Health | Evidência |
|---|---|---|
| Descoberta de Instagram por nome | `UNAVAILABLE` | Login wall com HTTP 200 |
| Ads Intelligence via Meta Ad Library | `UNAVAILABLE` no Brasil | API só cobre anúncio político fora da UE |
| Extração de link social do site | `HEALTHY` | 69% de sucesso em 77 sites |

Isso entra na `ProviderSelectionPolicy` como estado inicial, não como descoberta futura.

---

## 10. Resumo de decisões

| # | Decisão |
|---|---|
| D1 | Provider e adapter são contratos separados, versionados independentemente |
| D2 | Capability sem consumidor não entra no registry |
| D3 | `ScrapeJob` é estendido; não se cria `IntelligenceRun` paralelo |
| D4 | `PARTIAL` persiste o obtido, cobra o executado, reprocessa só o que falhou |
| D5 | Confiança nunca é inventada — ausente quando o provider não fornece |
| D6 | Sinais permanecem em três estados; não migram para 0..1 |
| D7 | `sourceReference` é a URL exata, para o prospect poder conferir |
| D8 | Custo em moeda nasce com o modelo, mesmo antes do primeiro provider pago |
| D9 | Router é o único seletor de provider |
| D10 | Todo provider tem mock, e teste não chama provider real |
