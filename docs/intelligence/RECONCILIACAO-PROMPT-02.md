# RECONCILIAÇÃO — Prompt 02, roadmap e código

**Data:** 09/09/2026
**Tipo:** medição e confronto de fontes. **Não decide nada.**
**Fontes confrontadas:** `PROMPT 02 v1.0.0`, `PROMPT 02 v1.1.0`, `IMPLEMENTATION-ROADMAP.md`, `PROVIDER-CONTRACT-v5.md` §13, e o código do repositório.

---

## 0. Por que este documento existe

Há quatro textos descrevendo a mesma fase, e **eles não se conhecem**:

- o **Prompt 02 v1.0.0**, que pede uma Foundation com mocks;
- o **Prompt 02 v1.1.0**, que o declara `SUPERSEDED` e acrescenta ProviderRouter, CostGuard, RawSnapshot, lineage e quarentena;
- o **`IMPLEMENTATION-ROADMAP.md`**, que quebra tudo em F0…F8 e cita os parágrafos do Prompt 02 como origem de cada item;
- o **`PROVIDER-CONTRACT-v5.md` §13**, que **revisa o roadmap** e extingue fases inteiras dele.

Nenhum dos quatro sabe o que o código faz hoje. Este documento mede o código e diz, para cada capacidade, onde ela está prevista, se existe e com que evidência.

**O que ele não faz:** não aprova, não reprova, não altera decisão registrada e não escolhe entre as fontes quando elas divergem. Divergência vira item da §7, com as opções e o texto de cada lado.

---

## 1. Hierarquia de fontes

Aplicada a ordem que o próprio Prompt 01 §4 estabelece:

```
código real
  > schema real
  > migrations reais
  > testes reais
  > documentação do projeto
  > prompts
```

Toda linha das tabelas abaixo marcada `medido` vem de comando executado contra o repositório em 09/09/2026, não de leitura de documento.

---

## 2. Uma correção de leitura, e ela é minha

Lendo o `IMPLEMENTATION-ROADMAP.md` isoladamente, a conclusão é que **F1 e F2 foram pulados**: o F3 está entregue, e o Router e o Snapshot que vinham antes dele não existem. O grafo de dependências do documento diz `F0 → F1 → F2 → F3`, e o critério de pronto do F3 diz *"atravessando Router"*.

**Essa conclusão está errada.** O `PROVIDER-CONTRACT-v5.md` §13 revisa o roadmap e registra:

| Fase | v1 (roadmap) | v5 (vigente) |
|---|---|---|
| **F1** | Contrato, registry, router, adapter · M | **"Deixa de existir.** Registry e router adiados; o provider pertence a F3" |
| **F2** | Snapshot e normalização | **"Absorvida por F3** — sem consumidor antes dela" |

A razão está na §3.2 do mesmo documento: *"Não há provider pago. Seleção de provider por tenant só vira requisito quando existir um provider que só alguns planos alcancem — o mesmo gatilho do `CostGuard`."*

O F3 sem Router **é o plano vigente**, não um desvio. Fica registrado aqui porque foi o meu erro de leitura antes de abrir o v5, e porque qualquer pessoa que leia o roadmap sem ele chegará à mesma conclusão errada.

> **Consequência prática:** o `IMPLEMENTATION-ROADMAP.md` deveria trazer um aviso apontando para o v5 §13. Hoje ele não traz, e é o documento com nome mais óbvio para quem procura o plano.

---

## 3. Estado medido, capacidade por capacidade

A coluna "capacidade" usa a lista do Prompt 02 v1.1.0 §7.2.

### 3.1 Execution Core

| Capacidade | Previsto em | Existe? | Evidência |
|---|---|---|---|
| `IntelligenceRun` | Prompt 02 §14 | ❌ | `medido` — nenhum dos 42 modelos do schema |
| `IntelligenceJob` | Prompt 02 §14 | ❌ | idem |
| State machine do Run | Prompt 02 §15 | ❌ | idem |
| `TenantContext` | Prompt 02 §12.1 | ✅ **equivalente** | `comTenant` na API e no worker + `set_config` por transação |
| Idempotência | Prompt 02 §45 | ✅ **parcial** | `DigitalPresenceAudit.idempotencyKey` com `@@unique([tenantId, idempotencyKey])`; não há estratégia genérica |
| Feature flags / entitlements | Prompt 02 §13 | ✅ **equivalente** | `EntitlementsService`, `@ConsomeRecurso()`, `PlanUsage` |
| Quotas | Prompt 02 §13 | ✅ | `PlanUsage.auditsCount` — `medido` |
| Event envelope | Prompt 02 §22 | ❌ | não há catálogo de eventos nem envelope |
| Audit | Prompt 02 §27 | ✅ | `AuditLog`, append-only, com lápide de ator (D4) |
| Observabilidade | Prompt 02 §43 | ✅ **parcial** | `pino` estruturado no worker, logs Nest na API; sem métricas nem tracing |
| Async / queue | Prompt 02 §47 | ✅ | BullMQ, prefixo `propectai`, filas `scrape`/`audit`/`notify` |

### 3.2 Data Acquisition Core

**Nenhum item desta seção existe no código.**

`medido` — o comando abaixo retornou **vazio**:

```powershell
Get-ChildItem -Recurse apps,packages -Include *.ts |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Select-String -Pattern "IntelligenceRun|ProviderRouter|ProviderRegistry|RawSnapshot|CostGuard|EntityResolution|FieldLineage|SchemaDrift|Quarantine|IntelligenceProvider" -List
```

| Capacidade | Previsto em | Estado |
|---|---|---|
| `ProviderRegistry` | roadmap F1 | **adiado por decisão** — v5 §3.2 |
| `ProviderRouter` | roadmap F1 | **adiado por decisão** — v5 §3.2 |
| `ProviderSelectionPolicy` | Prompt 02 §20 | não previsto fora do F1 |
| `ProviderHealth` | Prompt 02 §23 | não previsto fora do F1 |
| Waterfall / Fallback | Prompt 02 §21–22 | não previsto fora do F1 |
| `RawSnapshot` | roadmap F2 | **absorvido por F3** — v5 §13. Não entregue |
| Contract validation / `SCHEMA_DRIFT` | roadmap F2, Prompt 02 §35–36 | idem |
| Quarentena | roadmap F2, Prompt 02 §37 | idem |
| `CanonicalIdentity` | roadmap F4, Prompt 02 §33 | previsto, não iniciado |
| `ExternalReferences` | Prompt 02 §34 | previsto, não iniciado |
| `CostGuard` / `TenantBudget` | roadmap F6, Prompt 02 §25 | previsto, não iniciado. Gatilho declarado: primeiro provider pago |
| `FieldLineage` | roadmap F8, Prompt 02 §30 | previsto, não iniciado |
| `EntityResolution` | Prompt 02 §32 | **explicitamente fora** — roadmap §3: *"`fingerprint` resolve na escala atual"* |

**O que existe no lugar:** duas abstrações de provider, ambas por variável de ambiente e sem seleção dinâmica — `LeadSourceProvider` (regra 3 do projeto, com `gosom/google-maps-scraper` por trás) e `SiteAuditProvider` (`mock` / `native`). Fábrica, não registry.

### 3.3 Evidência

O Prompt 02 §29 pede um `NormalizedEvidence` genérico. **O projeto decidiu o contrário, e está escrito no schema:**

> *"Uma medicao. É a evidência — não existe modelo `Evidence` separado."* — `DigitalPresenceCheck`

Cada checagem carrega `observedUrl` e `observedAt` **por medição, não por execução**, com a razão registrada: *"com até três saltos de redirect, DNS e TITLE_META não olham a mesma URL, e o `scope-v0.2.md` §4 exige evidência e data em cada afirmação"*.

**Isto é divergência de desenho, não lacuna.** Implementar o `NormalizedEvidence` do Prompt 02 criaria uma segunda camada de evidência ao lado de uma que funciona e tem 42 testes.

---

## 4. Onde as fontes divergem

### 4.1 Mocks contra providers reais

**Prompt 02 v1.1.0 §7.3 e §40:** exige `MockProviderA` e `MockProviderB`, `ZERO network`, fixtures determinísticos.

**`IMPLEMENTATION-ROADMAP.md` §7:** *"Não é o Prompt 02 como está escrito — ele pressupõe Flowsint e mocks. Recomendação: um Prompt 02 revisado cobrindo F0 e F1, com o `MapsAdapter` real em vez de mock. O provider real já existe e funciona; usá-lo prova mais que um mock, e evita construir duas vezes."*

Os dois argumentos são bons e incompatíveis. O mock prova o Router sem tocar a rede; o provider real prova o Router **e** não vira código descartável. Existe hoje um `MockSiteAuditProvider` e um `mock-ai.provider`, então a casa não é avessa a mocks — a objeção é a mocks **como entrega principal de uma fase**.

### 4.2 Registry e Router: obrigatórios ou adiados

**Prompt 02 §18–19:** componente central, obrigatório.

**`PROVIDER-CONTRACT-v5.md` §3.2:** adiados, com gatilho nomeado — *"quando existir um provider que só alguns planos alcancem"*.

O v5 acrescenta uma ressalva sobre a própria justificativa: *"A v4 apoiou isto citando `scope-v0.2.md` §6 como se fosse aprovado. Não é... O argumento vale pelo mérito, não pela autoridade."*

### 4.3 RLS: o repositório fez o contrário do recomendado — e para o lado seguro

**`PROVIDER-CONTRACT-v5.md` §3.1** recomendou **adiar** RLS: *"Recomendo a segunda [extensão do Prisma exigindo `tenantId`] com as FKs juntas, registrando que ela não fecha T2"*, e pediu erratum na egress policy assumindo o T2 aberto.

**O repositório implementou RLS completo:** `FORCE ROW LEVEL SECURITY`, três papéis (`propectai_migrator`, `propectai_app`, `propectai_sistema`), 34 políticas, `comTenant` com `set_config` amarrado à transação, e suítes de isolamento na API e no worker.

**Consequência:** o T2 — vazamento entre tenants, severidade Alta — está fechado por mecanismo, não documentado como aberto. Nenhum documento registra essa mudança de rumo, e o erratum que o v5 pediu perdeu o objeto.

### 4.4 As subfases 03A–03D

**Prompt 02 v1.1.0 §96** propõe `03A → 03B → 03C → 03D`.

**`IMPLEMENTATION-ROADMAP.md` §5:** *"As quatro subfases deixam de existir pelo ADR-002. O 03A foi absorvido pelo STEP 4 deste Prompt 01 — licença verificada, versão pinada, decisão registrada."*

---

## 5. O que mudou depois que os documentos foram escritos

| Fato | Data | Efeito sobre os documentos |
|---|---|---|
| `PROMPT_01_GATE = FAIL` | 22/08 | Continua sendo o veredito de registro. Pelo §1.3 do Prompt 02, produz `BLOCKED_BY_PROMPT_01` |
| Adendo ao relatório corrige o achado F1 | 22/08 | `FAIL` mantido; F2–F5 e furos de egress permanecem |
| **D1 decidida** — coleta só da URL, sem pontuar, `NAO_CLASSIFICADO` | 27/08 | **Pode destravar o F5**, que o v5 §13 declara bloqueado *"pela reclassificação de privacidade"*. Com F5, o F7 |
| D6 decidida — 180 dias, quatro peças | 27/08 | Peças 1 a 4 entregues entre 08 e 09/09 |
| Egress policy v3, com IPv6 ULA, mapped, NAT64 e limite por streaming | ago/set | Endereça furos listados no `FAIL` do Gate 01 |
| RLS completo, passos 1 a 6 | ago/set | Endereça o caminho de vazamento entre tenants do `FAIL` |
| CI criado, Node 24, proteção de branch | 04–09/09 | Baseline e gates que o Prompt 02 §6 e §51 pedem |

**Nenhuma dessas mudanças foi refletida nos documentos de fase.** O `FAIL` do Gate 01 é de 22/08 e não conhece nada do que veio depois.

---

## 6. Lacunas medidas dentro do que se declarou pronto

Estas não são fases futuras. São itens que o v5 §13 lista como **entrega do F3**, e que o F3 não entregou.

### 6.1 `websiteHasHttps` continua `Boolean?`

`medido`:

```
hasWebsite     SignalState  @default(DESCONHECIDO)
hasEmail       SignalState  @default(DESCONHECIDO)
hasPhone       SignalState  @default(DESCONHECIDO)
hasInstagram   SignalState  @default(DESCONHECIDO)
hasFacebook    SignalState  @default(DESCONHECIDO)
hasReviews     SignalState  @default(DESCONHECIDO)
websiteHasHttps Boolean?
```

O v5 §13 declara *"migração de `websiteHasHttps` para `SignalState`"* como parte do F3. Seis irmãos migraram; este não.

**Isto é a regra 4 do projeto** — *ausência de sinal é `DESCONHECIDO`, nunca `AUSENTE`*. Um `Boolean?` não carrega a distinção que os outros seis carregam, e é o único sinal que a fase liberada de fato escreve, segundo o próprio v5 §0.

E com ele fica pendente a invariante que o v5 moveu para o F3 justamente por isso.

### 6.2 `LeadSourceRecord.payload` sem política de retenção

O schema anota o defeito com todas as letras — *"o defeito que o `LeadSourceRecord.payload` já tem e que este modelo existe para não repetir"* — e a tabela de riscos do roadmap o lista com gatilho **"Já ocorre"** e mitigação **"Política de retenção em F2"**.

O F2 foi absorvido pelo F3. **A política não veio junto.** O `DigitalPresenceCheck` ganhou `retentionUntil` e agora, com a D6, ganhou aviso e expurgo; o `LeadSourceRecord` continua sem nada.

### 6.3 `audit.export` sem capacidade — **a verificar**

O v5 §3.2 afirma que `audit.run` e `audit.export` são entrega do F3. O `auditsCount` existe. O `GET /audits/:id/export` foi entregue **sem** cota e sem `@ConsomeRecurso()`, por decisão registrada de portabilidade — mesmo argumento que mantém `/leads/export` liberado sob suspensão (§10.4).

Não medi se `audit.export` existe como capacidade no `EntitlementsService`. Comando:

```powershell
Get-ChildItem -Recurse apps\api\src -Include *.ts |
  Select-String -Pattern "audit\.export|audit\.run" -List |
  Select-Object -ExpandProperty Path
```

---

## 7. O que precisa de decisão

Cada item traz as opções e o argumento de cada lado. Nenhum é decidido aqui.

**D-R1 — Reavaliar o Gate 01.**
O `FAIL` é de 22/08 e a remediação veio depois. Ou se reavalia achado por achado — F2, F3, F4, F5 e cada furo de egress, com o commit que fechou cada um — ou o Prompt 02 permanece formalmente bloqueado pelo §1.3 dele mesmo. **Sem isso, qualquer execução do Prompt 02 viola a regra de entrada do próprio Prompt 02.**

**D-R2 — Qual roadmap vale.**
`IMPLEMENTATION-ROADMAP.md` (F0–F8) e `PROVIDER-CONTRACT-v5.md` §13 divergem, e o segundo é mais novo mas **não foi revisado** — a §15 dele diz: *"Esta versão não foi revisada. As quatro anteriores foram, e cada uma introduziu defeitos novos ao corrigir os antigos."* Decidir qual é o documento vigente, e anotar no outro.

**D-R3 — Mock ou provider real na fase de Router.**
Ver §4.1. Se a resposta for "provider real", o Prompt 02 v1.1.0 precisa de uma v1.2 antes de virar código, porque §7.3 e §40 exigem o contrário.

**D-R4 — F5 está destravada?**
O v5 a bloqueia por decisão de privacidade pendente. A D1 foi decidida em 27/08 e a Etapa 1 é explícita: coletar só a URL, não pontuar, `NAO_CLASSIFICADO`. `medido`: o enum `SiteCheck` tem sete valores e nenhum social, e a D1 diz que *"o enum só ganha os valores novos com esta decisão escrita"* — ela está escrita. Se F5 destravou, F7 destravou junto.

**D-R5 — `websiteHasHttps`.**
Item declarado do F3, não entregue, e é a regra 4. Fechar como correção do F3 ou registrar como dívida com dono e prazo.

**D-R6 — Retenção do `LeadSourceRecord.payload`.**
Defeito conhecido, com gatilho "Já ocorre", cuja mitigação sumiu quando o F2 foi absorvido. A D6 resolveu o mesmo problema para as checagens e o mecanismo é reaproveitável.

---

## 8. O que este documento não estabelece

Não reavalia o Gate 01. Não escolhe entre roadmap e v5. Não aprova nem reprova o Prompt 02 em nenhuma versão. Não altera ADR, decisão registrada ou escopo.

Ele existe para que essas escolhas sejam feitas sobre o estado real do código, e não sobre quatro textos que descrevem estados diferentes do mesmo projeto em momentos diferentes.

---

## Anexo — comandos usados

```powershell
# Modelos do schema
Select-String -Path prisma\schema.prisma -Pattern "^model " | Measure-Object
# → 42

# Nenhum modelo do Prompt 02
Select-String -Path prisma\schema.prisma -Pattern "^model (Intelligence|Provider|RawSnapshot|Evidence|Lineage|Quarantine|Canonical|External)"
# → vazio

# Nenhum componente do Prompt 02 no código
Get-ChildItem -Recurse apps,packages -Include *.ts |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Select-String -Pattern "IntelligenceRun|ProviderRouter|ProviderRegistry|RawSnapshot|CostGuard|EntityResolution|FieldLineage|SchemaDrift|Quarantine|IntelligenceProvider" -List
# → vazio

# Contador de auditoria, sinais e enums
Select-String -Path prisma\schema.prisma -Pattern "auditsCount|SignalState|websiteHasHttps"
Select-String -Path prisma\schema.prisma -Pattern "enum SiteCheck" -Context 0,10
Select-String -Path prisma\schema.prisma -Pattern "enum LeadSource" -Context 0,6
```
