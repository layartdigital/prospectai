# PROSPECTAI — PROMPT 04 v1.0.0 — Relatório final

**Intelligence Explorer + AI Workspace · primeiro incremento (P04-I1) · módulo 0.1.0**
**Branch:** `feat/prompt-04-intelligence-explorer` · **Parada para homologação — nada foi mesclado, publicado ou implantado.**
**`F:\drmind` (Bellvia) não foi modificado.**

> **Atualizações posteriores:** correções de homologação em `P04-QA-RELATORIO.md` (QA-01) e `P04-QA-02-RELATORIO.md` (QA-02, o mais recente: CI estendido, troca de workspace, script local endurecido). Este relatório descreve a primeira entrega e não foi reescrito.

---

## A. O que foi entregue

Rota `/intelligence` funcional, com grafo de relações verificáveis do próprio tenant; 2 endpoints (`GET /intelligence/graph`, `GET /intelligence/expand`); tipos e DTOs compartilhados em `packages/types`; renderizador de grafo próprio (sem dependência nova); entrada pelo menu e pela ficha do lead ("Explorar relações"); ajuda contextual mínima e âncoras de tour; gancho de entitlements; contrato tipado de IA. Sem migration, sem alteração de RLS, sem nova infraestrutura.

## B. Decisões de projeto

Grafo só com relações comprovadas (FK/coluna), cada uma com `verification` e `provenance`; `INFERIDA` reservada sem regras. Resposta limitada e paginada (teto técnico, não comercial). Isolamento por `comTenant` + `tenantId` explícito + soft-delete, papel `propectai_app`. Campos de JSON livre/URL excluídos. Renderizador SVG próprio. Flowsint não usado (ADR-002); nenhum código copiado. Versão do módulo separada da versão global.

## C. Verificação — o que foi e o que **não** foi executado

| Item | Resultado | Natureza |
|---|---|---|
| `tsc --strict` em `packages/types` (3 módulos) | OK | Executado |
| Testes de `packages/types` | 35/35 | Executado com shim local do vitest |
| RLS em SQL puro | Isolamento confirmado | Bancada (PG 16 local) |
| Serviço real sobre PG local | 19/19 | Bancada (Prisma falso) |
| UI em Chromium | 28/28 | Bancada |
| Typecheck do monorepo (api, web) | **NÃO EXECUTADO** | Registro npm inacessível; sem `node_modules` |
| ESLint | **NÃO EXECUTADO** | idem |
| `next build` / `nest build` | **NÃO EXECUTADO** | idem |
| Jest HTTP `intelligence-tenant.spec.ts` | **ESCRITO, NÃO EXECUTADO** | Exige AppModule + Postgres com migrations |

**Risco principal:** `intelligence.service.ts` (661 linhas) e os componentes web nunca foram compilados contra os tipos gerados do Prisma e do Next reais. Podem existir erros de tipo que a bancada não pega.

## D. Segurança e isolamento

Verificado em três níveis (SQL, serviço real, UI): tenant B com ids do tenant A recebe 404 idêntico ao de lead inexistente, em 12 combinações de expansão; sem contexto de tenant a RLS nega tudo; sem `tenantId` no where a RLS sozinha segura. Telefone mascarado conforme plano. **Achado para o dono:** `leads.searchId` tem FK simples, não composta com `tenantId` — não afeta o serviço, mas a correção estrutural é uma migration **não feita** (fora da autorização).

## E. Pendências e bloqueios

1. Rodar `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` e o jest do Explorer em ambiente com dependências, e corrigir o que apontar. **Pré-requisito de homologação.**
2. Captura de tela da ficha do lead com o botão (app completo).
3. Provedor de IA aprovado (hoje: nenhum).
4. Decisão comercial para `limitesDoPlano` e eventual `Capability`.
5. Decisão sobre migration de integridade de `leads.searchId`.

## F. Estado das funcionalidades

Ver `P04-FUNCIONAL.md`. Resumo: rota, grafo, expansão, busca, ficha do lead, ajuda, âncoras = IMPLEMENTED; entitlements e inferência = PARTIAL; IA, salvar/exportar, relações entre leads = NOT_STARTED.

## G. Produção

Nenhuma mutação de banco de produção, nenhum restart, nenhum deploy, nenhum merge, nenhum push, nenhuma outra stack tocada, nenhum segredo exposto. Contêineres de produção (que preservam logs do GATE-DB-42501) não foram tocados; o servidor de produção não foi acessado nesta ordem.

---

## Bloco de veredito (§19)

```
PROJECT                      = PROSPECTAI
PROMPT                       = 04
VERSION                      = 1.0.0
WORK_TYPE                    = FEATURE_IMPLEMENTATION
BRANCH                       = feat/prompt-04-intelligence-explorer
COMMIT                       = (ver git log da branch; hash informado na mensagem de entrega)
EXPLORER_ROUTE               = IMPLEMENTED (/intelligence)
GRAPH_BACKEND                = IMPLEMENTED (não compilado contra Prisma real)
GRAPH_FRONTEND               = IMPLEMENTED (SVG próprio; verificado em bancada)
LEAD_CONTEXT_INTEGRATION     = IMPLEMENTED em código; sem captura de tela da ficha
AI_INTEGRATION               = NOT_STARTED (somente contrato tipado; nenhuma resposta simulada)
REAL_DATA_ONLY               = YES na UI do produto; dados fictícios só no PG local da bancada
TENANT_ISOLATION_TESTS       = PARTIAL (SQL, serviço real e UI em bancada: aprovados; jest HTTP escrito e não executado)
RBAC_VALIDATION              = PARTIAL (mesma cadeia JwtAuthGuard+TenantGuard; sem RBAC novo; jest não executado)
TYPECHECK                    = PARTIAL (packages/types: OK; api e web: NÃO EXECUTADO — registro npm bloqueado)
LINT                         = NOT_EXECUTED (registro npm bloqueado)
BUILD                        = NOT_EXECUTED (registro npm bloqueado)
TESTS                        = PARTIAL (35 unit + 19 serviço bancada + 28 UI bancada; jest da API não executado)
UI_EVIDENCE                  = 11 capturas (bancada Chromium), em docs/intelligence/p04/evidencias/capturas
FILES_CHANGED                = 45 (4 modificados + 41 novos, incl. 11 capturas e evidências de bancada)
ENDPOINTS_CREATED            = 2
DOCUMENTATION                = 7 documentos em docs/intelligence/p04
PRODUCTION_DB_MUTATIONS      = 0
PRODUCTION_SERVICE_RESTARTS  = 0
PRODUCTION_DEPLOYS           = 0
OTHER_STACKS_TOUCHED         = 0
SECRETS_EXPOSED              = 0
DELIVERY_STATUS              = PARTIAL
NEXT_FUNCTIONAL_INCREMENT    = Rodar CI real e corrigir; depois relações entre leads com regra e selo "Inferida"
```

**Por que PARTIAL e não COMPLETE:** o código existe, o comportamento foi demonstrado em bancada, mas typecheck, lint, build e jest do monorepo não puderam ser executados neste ambiente. Declarar COMPLETE seria afirmar algo não verificado.
