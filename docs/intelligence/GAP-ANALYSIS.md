# GAP ANALYSIS

**Data:** 22/08/2026 · **Fase:** Prompt 01, STEP 5
**Entradas:** `CURRENT-ARCHITECTURE.md` (STEP 3), `THIRD_PARTY_FLOWSINT.md` (STEP 4), Prompt 02 v1.1.0, `scope-v0.2.md`, Gate 0

---

## 1. Método

Três eixos comparados contra o estado real:

- **A** — o que a foundation do Prompt 02 exige
- **B** — o que a v0.2 aprovada exige
- **C** — o que os dados medidos revelaram

Cada gap recebe: severidade, esforço relativo, e a fase em que deve ser resolvido. Gaps sem consumidor concreto são marcados para adiar — não para construir.

---

## 2. Gaps estruturais

Alteram a forma do sistema. Custam caro se adiados.

| # | Gap | Estado atual | Severidade | Quando |
|---|---|---|---|---|
| **G1** | `LeadSource` é enum Prisma | Adicionar provider exige migration | **Alta** | Antes do 2º provider |
| **G2** | Sem `ProviderRegistry` / `Router` / `Policy` | Scraper chamado direto pelo `prospecting` | **Alta** | Fase de foundation |
| **G3** | Ids de provider como colunas do `Lead` (`placeId`, `cid`) | Viola Prompt 02 §33 | **Alta** | Antes do 2º provider |
| **G4** | Sem `providerVersion` / `adapterVersion` | Impossível saber que versão produziu um dado | Média | Com o Router |
| **G5** | Sem validação de schema, drift ou quarentena | Payload malformado entraria direto | Média | Com o 1º provider externo |
| **G6** | Sem custo em moeda | `PlanUsage` conta unidades | **Alta** | Antes do 1º provider pago |
| **G7** | Sem lineage estruturado | `LeadScoreReason.evidence` é `String?` livre | Média | Com o 2º provider |
| **G8** | Sem `first_seen` / `last_seen` por campo | Há timestamps por registro | Baixa | Quando houver sinal temporal |

**G1 e G3 formam um par.** Ambos decorrem do sistema ter nascido com um provider. Ambos vencem no mesmo momento — quando entrar o segundo. A auditoria da v0.2 é esse segundo provider.

**G6 é o mais subestimado.** Todo provider externo relevante cobra por chamada. Sem custo em moeda no `PlanUsage`, não há como o `CostGuard` do §25 existir, e a margem só aparece na fatura.

---

## 3. Gaps da v0.2 — a próxima release

| # | Gap | Situação | Prioridade |
|---|---|---|---|
| **V1** | Verificador de site — DNS, HTTP, HTTPS, redirect, viewport, TTFB, meta | Não existe | **P0** — Fase 1 do escopo |
| **V2** | Nove categorias de classificação | Hoje há 3 estados de `WebsiteStatus` | **P0** — Fase 2 |
| **V3** | Links sociais lidos do próprio site | Não existe | **P1** — Fase 3 |
| **V4** | `DigitalPresenceAudit` / `Check` / `AuditReport` | Não existem no schema | **P0** |
| **V5** | Relatório PDF com marca da agência | Não existe | **P1** — Fase 4 |
| **V6** | Entitlements `audit.run` / `audit.export` | `EntitlementsService` existe, capabilities não | **P1** — Fase 5 |
| **V7** | Egress policy para requisição a site de terceiro | Não existe | **P0** — pré-requisito de V1 |

**V7 não está no `scope-v0.2.md` e deveria estar.** O §8 daquele documento trata o risco como etiqueta — User-Agent identificável, timeout, robots.txt. Mas o verificador vai buscar URL vinda de dado de entrada: **isso é SSRF por desenho.** Sem bloqueio de localhost, RFC1918, link-local e endpoint de metadados de cloud, um lead com website apontando para endereço interno faz a própria infraestrutura vazar credencial.

É gap de segurança, não de produto, e é pré-requisito de qualquer coisa na Fase 1.

---

## 4. O que os dados medidos revelaram

| # | Achado | Efeito |
|---|---|---|
| **M1** | Instagram serve login wall com HTTP 200 | Descoberta social por nome é inviável. Confirma `scope-v0.2.md` §7 |
| **M2** | 69% dos sites próprios trazem link social (53/77) | Taxa esperada da Fase 3 da v0.2 |
| **M3** | 25% de `SEM_SITE` na amostra | Fatia que permanece `DESCONHECIDO` |
| **M4** | `score-v1` varia só 25 pontos nos `SEM_SITE`; 22 de 28 na mesma faixa | Priorização quase plana onde mais importa |
| **M5** | 870 avaliações sem site pontua abaixo de 5 avaliações | `review_count` mede porte e maturidade ao mesmo tempo |
| **M6** | Meta Ad Library não cobre anúncio comercial fora da UE | `Ads Intelligence` sem fonte legítima no Brasil |

**M4 e M5 estão fora do escopo do Prompt 01 e do 02** — ambos adiam scoring. Ficam registrados como entrada para quando o scoring for reaberto.

**M1 e M6 pertencem à `ProviderSelectionPolicy`**: são health conhecido de providers antes mesmo de existirem.

---

## 5. Gaps que NÃO devem ser fechados agora

Registrar a decisão de não construir é tão importante quanto listar o que falta.

| Item | Por que adiar |
|---|---|
| Neo4j / Graph | Nenhuma pergunta de produto identificada exige travessia acima de profundidade 2 |
| Entity Resolution probabilística | `Lead.fingerprint` resolve com um provider. Reabrir com o segundo |
| Signal Engine | Exige duas observações no tempo. Não há histórico ainda |
| IA de análise | Prompt 02 §53 proíbe. E `scope-v0.2.md` §7 exclui análise de conteúdo por IA do relatório |
| Confidence numérica | Os três estados são mais honestos que um número inventado. Só mudar se um provider fornecer confiança real |
| Flowsint | Ver `THIRD_PARTY_FLOWSINT.md` §7 |
| Fila nova, observabilidade nova | BullMQ e logs atuais atendem a escala atual |

---

## 6. Convergência: um gap serve a dois horizontes

O ponto que organiza o roadmap:

```text
v0.2 precisa de:              A foundation precisa de:
─────────────────             ────────────────────────
verificador de site      ──►  primeiro provider nativo não-Maps
classificação de site    ──►  primeira normalização com schema
links sociais do site    ──►  primeira evidência com lineage
audit entitlements       ──►  primeira capability sob entitlement
egress policy            ──►  controle de saída do acquisition core
```

**A auditoria de presença digital é o caso de uso que valida a foundation.** Construí-la como provider através do Router, em vez de código direto, custa pouco a mais e prova a arquitetura com um consumidor real.

Se a foundation não conseguir servir a auditoria da v0.2, ela está errada — e é melhor descobrir com uma feature aprovada do que com um mock.

---

## 7. Sequência derivada

Por dependência, não por data:

```text
F0  Egress policy + baseline de testes         (V7, W3)
      pré-requisito de qualquer coleta externa

F1  Provider contract + Registry + Router       (G1, G2)
      MapsAdapter encapsula o scraper atual
      mock provider prova o Router

F2  Snapshot + validação + normalização         (G4, G5)
      versionamento de provider e adapter

F3  Auditoria de site como 2º provider          (V1, V2, V4)
      valida o Router com consumidor real
      entrega a Fase 1 da v0.2

F4  ExternalReference + CanonicalIdentity       (G3)
      vence junto com o 2º provider

F5  Custo em moeda + CostGuard                  (G6)
      antes do 1º provider pago

F6  Lineage estruturado + evidência             (G7)
      quando houver 2 fontes para o mesmo campo

F7  Relatório e entitlements da v0.2            (V5, V6)
      fecha a release comercial
```

**F0 vem antes de tudo** e é pequeno. **F3 é onde a arquitetura se prova.** F5 vem antes de qualquer provider pago, não depois.

---

## 8. Riscos que este gap analysis levanta

| Risco | Gatilho | Mitigação |
|---|---|---|
| SSRF pelo verificador de site | Primeira coleta com URL de terceiro | F0 antes de F3 |
| Margem negativa em provider pago | Custo/lead acima do teto do plano | F5 antes do primeiro provider pago |
| Foundation virar overengineering | Mais de 2 componentes sem consumidor | Regra: só construir com consumidor identificado |
| `packages/ui` e `sdk` documentados e ausentes | Já ocorre | Corrigir `CLAUDE.md` |
| Baseline de testes desconhecido | Já ocorre | Bloqueia prova de não-regressão |
