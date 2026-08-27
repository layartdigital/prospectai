# ADENDO ao Execution Report — correção do achado F1

**Data:** 22/08/2026
**Motivo:** o `CHANGELOG.md` foi lido depois do relatório e desmente parte dele.

---

## O que estava errado no meu relatório

O achado **F1** afirmou que o roadmap construía "o item que o projeto rebaixou para sexto lugar", tratando isso como erro fatal.

O fato citado está correto: `lacunas-estruturais.md` §7 coloca a auditoria de presença digital em sexto. **A implicação estava errada.**

Os cinco itens anteriores **já foram executados**, entre 06/08 e 13/08. O `CHANGELOG.md` registra cada um:

| # | Item da sequência §7 | Estado | Evidência |
|---|---|---|---|
| 1 | Schema internacional | ✅ **Feito** | `### Alcance internacional — schema · 06/08` · `Tenant.country/currency/taxId/customerType` e `Lead.country` no schema |
| 2 | Gestão de usuários | ✅ **Feito** | `### Gestão de equipe · 06/08` · 7 endpoints em `team.controller.ts`: convite, aceite, revogação, papel, remoção |
| 3 | Painel do provedor | ✅ **Feito** | `### Painel do provedor · 06/08` · 4 endpoints em `admin.controller.ts`: listar, trocar plano, suspender, reativar |
| 4 | Taxonomia + locale | ✅ **Feito** | `### Taxonomia de segmentos · 06/08` e `### Gemini e termos por locale · 13/08` · `Segment` + `SegmentLocale` com `status`, `resultCount` |
| 5 | Cobrança com Stripe | 🟡 **~80%** | `### Cobrança — provedor, webhooks e suspensão · 13/08` · `Subscription.stripeSubscriptionId`, `Invoice`, `BillingEvent`, `Plan.pricesByCurrency` |
| 6 | Auditoria de presença digital | ⬜ **Não começou** | — |

**Conclusão corrigida: a auditoria de presença digital é, de fato, a próxima etapa** — não porque o roadmap acertou, mas porque os cinco anteriores foram concluídos.

Eu cheguei ao alvo certo sem verificar o estado. Isso não é acertar; é coincidir.

---

## O mesmo erro, dos dois lados

O reviewer leu `lacunas-estruturais.md` §7, viu "sexto lugar" e concluiu que o roadmap estava errado. **Ele também não abriu o `CHANGELOG.md`.**

Nós dois paramos na documentação estratégica sem confrontá-la com o registro de execução. A ordem de fontes de verdade do §4 do Prompt 01 coloca *código real* acima de *documentação* — e o CHANGELOG é o registro do que o código fez.

---

## O que continua valendo do relatório

Os outros quatro achados fatais **não são afetados** por esta correção:

| Achado | Situação |
|---|---|
| **F2** — `LeadSourceProvider` já existe e é regra inviolável | Mantido |
| **F3** — PII entra no banco antes do filtro | Mantido |
| **F4** — invariante do `LeadDigitalPresence` é irrealizável onde foi colocada | Mantido |
| **F5** — o produto se chama PropectAI | Mantido |
| Furos de egress (IPv6 ULA, mapped, NAT64, gzip bomb) | Mantidos |
| Erros factuais (`proposals`, `WebsiteStatus`, `SEM_SITE`, currency, AppSetting) | Mantidos |

```text
PROMPT_01_GATE = FAIL   (inalterado)
```

---

## Três pendências que o próprio CHANGELOG declara

Encontradas na leitura, e nenhuma estava nos meus documentos:

**1. Passos 4 a 6 do "plano vira dado" estão abertos.** `enum PlanCode` segue declarado e órfão no schema; `AGENCY → SCALE` não aconteceu; o cast em `tenant.guard.ts` é o marcador de que o passo 4 não terminou.

**2. Um risco de migration declarado e não fechado.** Palavras do CHANGELOG:

> *"o `ALTER TABLE` rodou contra tabela vazia, então **o cast não foi exercitado contra dado real**. Vale confirmar numa cópia da base antes de produção."*

**3. `pnpm typecheck` está quebrado.** Também do CHANGELOG:

> *"`ts-jest` transpila sem checar tipos: os 59 testes passaram com **dois erros de tipo** no repositório. Verde na suíte não substitui `pnpm typecheck`."*

Isso responde o warning W3 do meu baseline, que ficou como pendência por eu não conseguir executar comandos: **a linha de base existe e tem dois defeitos conhecidos.**

---

## Sequência recomendada

Antes de qualquer código da auditoria:

| Ordem | O quê | Tamanho |
|---:|---|---|
| 1 | Corrigir os dois erros de tipo — baseline limpo antes de construir sobre ele | P |
| 2 | Fechar passos 4 a 6 do "plano vira dado" — está pela metade e o enum órfão vira permanente | P |
| 3 | Exercitar o cast da migration contra cópia da base | P |
| 4 | **Egress policy** — com a tabela corrigida (IPv6 ULA, mapped, NAT64) e o processo de fetch separado do worker | M |
| 5 | Corrigir os defeitos F2 a F5 nos documentos de arquitetura | M |
| 6 | **Fase 1 da auditoria** — verificador de site | G |

Os itens 1 a 3 são dívida declarada pelo próprio projeto e cabem em pouco tempo. O item 4 é o único achado do meu trabalho que sobrevive integralmente, e é pré-requisito técnico do item 6.
