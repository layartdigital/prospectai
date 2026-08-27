# PROMPT 01 — Baseline e Gaps (STEP 1–2)

**Data:** 22/08/2026 · **versão 2** — corrige a leitura da versão 1
**Fase:** pré-flight §5 do Prompt 01
**Status:** `APPROVED_WITH_WARNINGS` para prosseguir — revisto após leitura do Prompt 02 v1.1.0

---

## 0. Retratação da versão 1

A versão 1 deste documento afirmou que os artefatos do projeto **contradizem** o Prompt 01, e recomendou parar.

**Estava errado.** O erro foi ler `scope-v0.2.md` e o programa Intelligence como alternativas concorrentes, quando são **horizontes diferentes do mesmo produto**.

O Prompt 02 v1.1.0 deixa isso explícito e o §6 dele traz o princípio que faltava:

> **Feature ≠ Provider.**
> Feature define valor de produto · capability define o que o sistema executa · provider define quem executa · adapter traduz · router decide.

Com esse princípio, o que parecia conflito se resolve:

| Camada | O que é | Documento |
|---|---|---|
| **Feature** | Auditoria de presença digital — o que a agência compra | `scope-v0.2.md` |
| **Capability** | `WEBSITE_HEALTH_AUDIT`, `TECH_STACK_INTELLIGENCE` | Prompt 02 §8 |
| **Provider** | NativeScanner, BuiltWith, Flowsint, Apify | Prompt 02 §5 |
| **Router** | Decide qual provider atende a capability | Prompt 02 §19 |

A v0.2 não compete com o programa Intelligence — **ela é a primeira feature que consumirá a foundation.** "Website Health Audit" está na lista do Prompt 02 §8, e o scraper atual vira `MapsAdapter` no §5.

**Onde a versão 1 acertou:** o pré-flight é obrigatório, os artefatos equivalentes ao Prompt 00 existem, e eu não os havia lido. Isso continua válido.

---

## 1. Artefatos equivalentes ao Prompt 00 — encontrados

| Arquivo | Data | Papel no Prompt 01 |
|---|---|---|
| `docs/technical/environment-audit.md` | 06/08 | Auditoria Fase 0, aprovada — cobre §5.1 |
| `docs/technical/data-model.md` | — | Entidades, dedup, isolamento — insumo do §10 |
| `docs/technical/scoring.md` | — | Score v1, pesos, explicabilidade — insumo do §9.9 |
| `docs/strategic/scope-v0.1.1.md` | — | Escopo aprovado da release atual |
| `docs/strategic/scope-v0.2.md` | 06/08 | Próxima release — **primeira consumidora da foundation** |
| `docs/strategic/lacunas-estruturais.md` | 06 e 13/08 | Decisões de negócio, gateway, taxonomia, cobrança |
| `docs/strategic/parecer-prompt-faro.md` | — | Parecer sobre prompt mestre anterior |
| `docs/audit/CONFERENCIA-V011.md` | — | Conferência da v0.1.1 |

**STEP 2 concluído:** o Prompt 00 não está ausente. Está presente sob outros nomes e será usado como fonte de verdade conforme §4.

---

## 2. O que o Prompt 02 esclarece sobre o alvo do Prompt 01

Ler o Prompt 02 antes de executar o 01 mudou o entendimento de quatro decisões centrais:

### 2.1 O ADR-002 não é "fork vs. serviço isolado"

O Prompt 01 §13 apresenta quatro opções de integração do Flowsint como se ele fosse o eixo. O Prompt 02 §5 mostra que ele é **um adapter entre oito**:

```text
ProviderRouter
  +--> FlowsintAdapter      +--> BuiltWithAdapter
  +--> ApifyAdapter          +--> MapsAdapter
  +--> OfficialApiAdapter    +--> SearchAdapter
  +--> NativeCrawlerAdapter  +--> UniversalWebAgentFallback
```

A pergunta correta do ADR-002 deixa de ser *"como integramos o Flowsint?"* e passa a ser *"quando e se ele entra como provider, e sob que política de seleção?"*.

### 2.2 O grafo é opcional, não pressuposto

O Prompt 02 §8 proíbe Neo4j e Graph nesta fase, e o §54 adia o Signal Engine. A `INTELLIGENCE_GRAPH` fica como capability reservada e `DISABLED` (§13).

Isso confirma a recomendação de tratar grafo como decisão registrada, não como componente obrigatório.

### 2.3 Multi-tenancy e planos já existem — o Prompt 01 documenta, não projeta

O produto já tem `Tenant`, `Plan`, `Subscription`, `PlanUsage`, `EntitlementsService`, `FeatureFlag` e `AppSetting` no schema. O Prompt 02 §12 e §13 mandam **reutilizar o sistema real**, não criar paralelo.

O Prompt 01 §8.1 e §8.2 devem então descrever o que existe e definir apenas como Intelligence se encaixa.

### 2.4 A v0.2 é a validação da foundation

Se a arquitetura do Prompt 01 não permitir servir a auditoria de presença digital do `scope-v0.2.md` através do Router com um provider nativo, ela está errada. Esse é o teste de aderência mais concreto disponível.

---

## 3. O que o Gate 0 aporta ao Prompt 01

O trabalho empírico feito antes desta leitura ganha significado dentro da arquitetura correta:

| Achado | Onde entra |
|---|---|
| Instagram serve login wall com HTTP 200 | `ProviderHealth` = `UNAVAILABLE` para um `SocialAdapter` por scraping. Alimenta a `ProviderSelectionPolicy` (§20) |
| 69% dos sites próprios trazem link social (53/77) | Taxa de sucesso esperada de um `NativeCrawlerAdapter` para a capability de descoberta social |
| 25% de `SEM_SITE` na amostra | Dimensiona a fatia que exigirá provider alternativo ou permanecerá `DESCONHECIDO` |
| Dispersão de 25 pontos do `score-v1` nos `SEM_SITE` | Entrada para scoring futuro — fora do escopo do 01 e do 02 |

O teste de descoberta social por nome confirmou empiricamente uma decisão já registrada em `scope-v0.2.md` §7. Validação redundante, mas o dado de health do provider é reaproveitável.

---

## 4. Warnings que permanecem

| # | Warning | Classificação |
|---|---|---|
| W1 | **A Matriz Técnica de Features v1.0 (21/08) não está no repositório.** O Prompt 02 §2 a lista como fonte de requisitos de prioridade 9 | `BLOCKING_FOR_PROMPT_02`, não para o 01 |
| W2 | Volume: Prompt 01 pede ~40 documentos e 12 ADRs; Prompt 02 pede mais 44 e a implementação | `NON_BLOCKING` — mitigado por execução em blocos com report parcial |
| W3 | Baseline de testes (§5.3) não executado — o workspace Linux do device não sobe, e não há shell no repositório | `NON_BLOCKING` — registrar como pendência e obter na próxima execução local |
| W4 | `git branch`/`rev-parse`/`status` não coletados pelo mesmo motivo | `NON_BLOCKING` — o repositório foi inspecionado por leitura de arquivos |
| W5 | Flowsint não aparece em nenhum documento estratégico do projeto. A decisão de adotá-lo vive só nos prompts | `NON_BLOCKING` — é exatamente o que o ADR-002 deve resolver |

Nenhum warning afeta os itens que o Prompt 02 §3.2 classifica como bloqueantes: multi-tenancy, data ownership, provider boundary, System of Record, feature flags, entitlement, security, data model.

---

## 5. Gate revisado

```text
PROMPT_01_PREFLIGHT = APPROVED_WITH_WARNINGS
```

Autorizado a prosseguir para STEP 3 (mapear sistema atual) com as seguintes correções de rumo, derivadas do Prompt 02:

1. Tratar Flowsint como **um provider entre vários**, não como eixo da arquitetura
2. Escrever o Provider Contract e o Router como componentes centrais, com Flowsint fora do caminho crítico
3. Documentar multi-tenancy, planos e entitlements **existentes** em vez de projetá-los do zero
4. Manter grafo como decisão registrada, com `INTELLIGENCE_GRAPH` reservada e desabilitada
5. Usar a auditoria de presença digital do `scope-v0.2.md` como caso de aderência da arquitetura
6. Registrar a ausência da Matriz Técnica como decisão aberta com impacto no Prompt 02

---

## 6. Pendências para o Product Owner

| # | Item | Impacto |
|---|---|---|
| P1 | Fornecer a **Matriz Técnica de Features v1.0** ou confirmar que não existe | Bloqueia o Prompt 02, não o 01 |
| P2 | Confirmar se o `scope-v0.2.md` permanece a próxima release, ou se o programa Intelligence a antecede | Define a ordem do roadmap no §43 |
| P3 | Rodar `git branch --show-current`, `git rev-parse HEAD`, `git status` e os scripts de teste, e colar a saída | Fecha os warnings W3 e W4 |
