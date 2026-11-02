# P04-QA-02 v1.0.0 — Desbloqueio de CI e homologação real do Intelligence Explorer

**Módulo:** Intelligence Explorer **0.1.0** (versão preservada) · **Branch:** `feat/prompt-04-intelligence-explorer` · **Commit de referência da ordem:** `3cc67af` · **Commit desta rodada:** na mensagem de entrega e em `git log`.
**`F:\drmind` (Bellvia) não foi modificado.** Nenhum deploy, merge, migration, restart ou alteração em produção; nenhuma outra stack tocada.

## Veredito

```
P04_QA_02_EXECUTION      = PARTIAL
P04_QA_02_RESULT         = INCONCLUSIVE
PR_DRAFT                 = NOT_CREATED     (push barrado pelo proxy de git; ver §2)
CI_TYPECHECK             = NOT_EXECUTED
CI_LINT                  = NOT_EXECUTED
CI_API_BUILD             = NOT_EXECUTED
CI_WEB_BUILD             = NOT_EXECUTED
CI_HTTP_ISOLATION        = NOT_EXECUTED
CI_RLS_GATE              = NOT_EXECUTED
WORKSPACE_SWITCH_TEST    = PASS_BENCH_ONLY (20/20 em bancada com Chromium; app completo NAO executado)
LOCAL_QA_SCRIPT_HARDENED = YES_NOT_EXECUTED (revisado por leitura; sem interpretador PowerShell para sintaxe)
PRODUCTION_DEPLOYS       = 0
PRODUCTION_DB_MUTATIONS  = 0
OTHER_STACKS_TOUCHED     = 0
```

**Por que INCONCLUSIVE.** A missão da ordem era obter a execução **real** dos portões de compilação e teste. Isso depende de a branch chegar ao GitHub, e o push continua recusado pelo proxy de git da sessão (repositório fora do conjunto autorizado; `gh` sem token válido). Nada foi contornado. Sem CI não há typecheck, lint, build, jest HTTP nem portão de RLS reais, e **nenhum deles é declarado aprovado**. O que mudou é que, agora, **um único passo do proprietário** (a Rota A de `qa/COMO-RODAR.md`) produz todos eles, e o `ci.yml` está pronto para reprovar por qualquer falha.

## Cobertura por item da ordem

| # | Item | Estado | Evidência / observação |
|---|---|---|---|
| 1 | Preservação | **Feito** | branch, versão 0.1.0 e correções de profundidade/soft delete/concorrência preservadas (testes de bancada de QA-01 repetidos: 16/16 concorrência, 28/28 UI). Sem merge/deploy/migration/restart |
| 2 | CI (GitHub Actions) | **Feito (código); não executado** | `ci.yml` estendido (§1). Push tentado de novo: 403 do proxy; nenhuma ferramenta GitHub disponível na sessão. Procedimento mínimo do proprietário em `qa/COMO-RODAR.md` |
| 3 | Script local endurecido | **Feito; não executado** | `validar-p04-qa.ps1` v1.1.0 (§3). Rota A segue preferida |
| 4 | Troca de workspace | **Corrigido; PASS só em bancada** | §4 |
| 5 | Integridade documental | **Feito** | `pipeline_cards` corrigido (unicidade `pipeline_cards_leadId_key` ≠ ausência de FK composta; teste correto aceita o cruzamento num lead sem cartão); seis relações mantidas; `P04-SEC-DATA-01-HANDOFF.md` separado; sem migration nem mudança de schema |
| 6 | Testes e evidências reais | **Pendente do CI** | sem CI não há resultado real a registrar; defeitos pré-existentes × introduzidos **não distinguíveis** ainda. Captura da ficha do lead e troca de workspace no app completo: **pendentes** |
| 7 | Documentação | **Feito** | relatório técnico, QA, changelog, endpoints, índice de evidências, riscos residuais |

## 1. O que o CI passa a exigir (`.github/workflows/ci.yml`)

Aceita os mesmos gatilhos de antes (PR para `main`, push na `main`). Novo ou ajustado: `permissions: contents: read`; `Tipos` ganhou **`pnpm lint`** (typecheck:all e `prisma generate` já existiam); novo job **`Builds (API e web)`** com **`nest build`** e **`next build`** por turbo (sem `NODE_ENV=test`, que atrapalha o `next build`); o job de testes ganhou o passo **“Isolamento HTTP do Intelligence Explorer”** (`jest test/intelligence-tenant.spec.ts --runInBand`, banco real, papel `propectai_app`) antes da **suíte completa** e do **portão de RLS** (já existentes); novo job **`Resultado do CI`** (`if: always()`) que falha se `tipos`, `builds` ou `testes` não terminarem em `success` (um job pulado por `needs:` não reprova sozinho). Nenhum passo obrigatório tem `continue-on-error`; o único `if: always()` é o relatório informativo de RLS, que já era assim. Sem deploy, SSH, acesso ao servidor nem segredo de produção: o Postgres e o Redis são serviços efêmeros do runner e as credenciais são descartáveis. YAML validado sintaticamente (4 jobs); **o workflow não foi executado**.

## 2. Push e PR rascunho

`git push` → 403 do proxy de git (repositório fora do conjunto autorizado da sessão); nenhuma ferramenta de GitHub disponível. Não houve tentativa de contornar. Procedimento mínimo (fetch do bundle `PROSPECTAI-P04-QA02-EXPLORER.bundle`, `git switch`, `git push -u origin …`, PR **rascunho** para `main`, **sem merge**) está em `qa/COMO-RODAR.md`.

## 3. Script local — o que mudou (v1.0.0 → v1.1.0)

| Defeito apontado | Correção |
|---|---|
| Remoção de contêiner sem validar propriedade | Nome único por execução + rótulo `br.com.layart.propectai.qa=p04-qa`; remoção **por ID** devolvido por `docker run`, só se o rótulo conferir; sem `rm` por nome, sem prune |
| Sem verificação de portas/identidade | Pré-voo: portas 5439/6389 livres e sem contêiner publicando; publicação só em `127.0.0.1`; marcador gravado no Postgres e no Redis **e lido de volta pelo host**; URLs validadas |
| Seguia após falha crítica | `-Critica` interrompe (install, build, typecheck, lint, migrations, seed, identidade); testes (11–13) rodam todos e o exit final é ≠ 0 se algo falhou |
| Docker sem checagem de sucesso | `Nativo` verifica exit code de cada comando; `docker run` precisa devolver ID de 64 hex; espera de prontidão aborta se estourar |
| Limpeza ampla | Só contêineres criados (ID+rótulo) e a pasta temporária com sufixo da execução; variáveis de ambiente restauradas |
| Risco de conectar em outro PostgreSQL | Prova de identidade por marcador antes de qualquer migration/seed/teste |

Também: `$ErrorActionPreference='Stop'` com tratamento do stderr de comandos nativos (Windows PowerShell 5.1), `NODE_ENV` limpo para o `next build`, logs por execução. **Não executado**; sem `pwsh` no ambiente, só a checagem de balanceamento de blocos foi feita.

## 4. Troca de workspace com o Explorer aberto

**Problema (confirmado por leitura do componente).** Antes da correção, `ExplorerWorkspace` não sabia da identidade da sessão. Se os cookies passassem a pertencer a outro workspace/usuário (login em outra aba, logout em outra aba), o grafo e a lista do dono anterior continuavam desenhados; a recusa HMAC de uma expansão seguinte era só uma mensagem de erro e **não prova limpeza visual** (a QA-01 C7 verificava só isso). Controle negativo: com o vigia desligado, o teste novo **reprova** (o aviso nunca aparece e o grafo do Alfa permanece).

**Correção.** Ver `P04-TECNICO.md` §5. Resumo: identidade (usuário + workspace) lida no servidor vira `key` do workspace; vigia de sessão compara com `GET /auth/me` (foco, visibilidade, `pageshow`, rede, 20 s, 401/403 do Explorer); mudança → `descartarTudo()` + `router.replace('/intelligence')` + `router.refresh()`; a chave nova remonta tudo. Falha de rede/5xx não descarta.

**Prova (bancada, `ui-workspace.cjs`, 20/20).** A verificação olha **texto e DOM**, não só o servidor: nenhum nome, id (`*_alfa_*`) ou nó do Alfa na tela.

| Cenário | Resultado |
|---|---|
| W1 Alfa→Beta com grafo, 8 notas, nó selecionado, painel de detalhes e busca abertos | aviso aparece; durante o aviso **zero** rastro do Alfa e nenhum painel de nó; depois, tela vazia do Beta, URL em `/intelligence` sem `lead`, lista só do Beta |
| W2 expansão **pendente** do Alfa (resposta chega 1,8 s depois da troca) | resposta tardia descartada: nenhuma nota, nenhum rastro, sem “carregando” preso |
| W3 carregamento de **grafo** pendente do Alfa | idem |
| W4 logout em outra aba (`401`) | sai para o login, sem rastro |
| W5 outro **usuário** no mesmo workspace | grafo, seleção e `lead` da URL descartados |
| W6 mesma identidade, rede fora, `/auth/me` 500 | **nada** é descartado (sem falso positivo) |
| W7 `401` numa requisição do próprio Explorer | confirma a sessão, sai, sem rastro |
| W8 sem nenhum evento | checagem periódica detecta (≈18 s) |

Evidências: `evidencias/bancada/ui-workspace.cjs`/`.out`, capturas `troca-1-antes-alfa.png`, `troca-2-aviso-descartado.png`, `troca-3-depois-beta.png`. Regressão: `ui-concorrencia` 16/16 e `ui-run` 28/28 repetidos com a mudança.

**Limites desta prova (para não superestimar).** A bancada **emula** `layout.tsx` + `page.tsx` do Next (a cada `router.refresh()` relê a sessão e re-renderiza com `key`) e usa a **mesma** `chaveDeIdentidade` do produto; o runtime real do Next/App Router, o middleware de renovação, `React.cache` no servidor e o `useRouter` real **não foram executados**. A sessão da bancada é um cookie `as=`/`usr=`, não JWT. Por isso `WORKSPACE_SWITCH_TEST = PASS_BENCH_ONLY`. O teste no app completo permanece obrigatório depois do CI verde.

## 5. Integridade relacional

Corrigido (`P04-QA-INTEGRIDADE-RELACIONAL.md`): a recusa de `pipeline_cards` na QA-01 era **unicidade** (`pipeline_cards_leadId_key`), porque o lead usado já tinha o cartão órfão semeado. Teste correto (`integridade-pipeline-cards.sql/.out`): cartão do Alfa num lead do Beta **sem** cartão foi **aceito** (ausência de FK composta demonstrada); a FK composta de estágio recusou estágio de outro tenant. As seis relações simples seguem registradas; **nenhuma migration, nenhuma mudança de schema**; encaminhamento separado em `P04-SEC-DATA-01-HANDOFF.md` (não iniciado, depende de autorização do dono; GATE-DB-42501 T1 não antecipado; SEC-DB-02 não iniciado).

## 6. Defeitos pré-existentes × introduzidos pelo Prompt 04

Não distinguíveis: nenhuma suíte, typecheck ou lint real foi executado nesta rodada. Quando o CI rodar, o critério é: falha em arquivo fora de `intelligence`, `packages/types/src/intelligence-*|session-identity*` e `use-vigia-de-sessao.ts` → pré-existente até prova em contrário (comparar com o CI do commit-base `2c4b1b2`); falha nesses arquivos → introduzida pelo Prompt 04 e corrigida na branch.

## 7. Riscos residuais

1. **Compilação nunca executada contra tipos reais** (API/Prisma gerado e web/React/Next). Cerca de 5.400 linhas de TS acrescentadas desde a base `2c4b1b2` (inclui testes; contagem por `git diff --numstat`); a web sequer tem `@types/react` neste ambiente. Probabilidade moderada de erro de tipo/lint — o CI revelará.
2. **Prisma simulado × real** (filtro de relação `lead: {…}`; `ValidationPipe`/DTOs). Cobertos só pelo spec HTTP, ainda não executado.
3. **Troca de workspace validada em emulação.** Pode divergir do comportamento do App Router (por exemplo, cache de rota do cliente) — mitigado por `key` e pelo botão “Recarregar a página” após 6 s, mas só o app completo confirma. Janela residual: até 20 s (ou até o próximo foco/401) o grafo do dono anterior pode permanecer visível se a aba **nunca** perdeu foco; os dados continuam protegidos pelo servidor.
4. O script PowerShell nunca foi executado nem parseado; qualquer erro de sintaxe aparece na primeira execução, **sem efeito colateral** (o pré-voo vem antes de criar algo).
5. Integridade entre workspaces (seis FKs simples): decisão do dono, fora do Explorer.
6. Outros módulos que leem essas colunas sem filtrar `tenantId` dos dois lados não foram auditados.

## 8. Próximo passo (do proprietário)

Rota A de `qa/COMO-RODAR.md` (publicar a branch, PR **rascunho**, sem merge) e devolver os quatro jobs do CI. Depois: corrigir o que apontarem, repetir; então a verificação do app completo (ficha do lead com “Explorar relações” e troca de workspace) e a reavaliação deste veredito (teto razoável: `PASS_WITH_LIMITATIONS`). Esta Executora **para aqui**, para homologação; não inicia Company 360, IA, Flowsint, nem mudanças de schema.
