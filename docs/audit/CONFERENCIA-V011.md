# Entrega 1 — Conferência dos 24 critérios de aceite da v0.1.1

**Data:** 31 de julho de 2026
**Base:** `docs/strategic/scope-v0.1.1.md` §8 (24 critérios) + `CLAUDE.md`
**Escopo desta entrega:** estado real do código × cada critério, com evidência. **Nenhum código novo, nenhum documento novo além deste.**

---

## 1. Método e limitação declarada

Inspeção estática de `F:\prospectai` com leitura de arquivo e busca por padrão.

**O ambiente Linux isolado não subiu** (falta de espaço em disco na máquina). Consequência honesta: **nada que dependa de execução foi verificado.** Não foi possível rodar `pnpm dev`, `pnpm test`, `docker compose ps`, `pnpm db:migrate` nem abrir uma tela.

Por isso este relatório usa a taxonomia A–G recomendada no parecer, com uma regra rígida: **critério que exige runtime não recebe "A" com base em leitura de código.** Recebe **G — Não verificável**, com a evidência estática registrada ao lado. Marcar como aprovado o que não foi executado seria exatamente o defeito que o escopo existe para evitar.

| Classe | Significado nesta conferência |
|---|---|
| **A** | Verificável estaticamente e satisfeito |
| **B** | Existe e funciona, mas abaixo do que o escopo especifica |
| **C** | Parcial — tipicamente backend pronto, interface ausente |
| **D** | Mock apresentado como real |
| **E** | Implementado e quebrado |
| **F** | Ausente |
| **G** | Não verificável sem runtime — evidência estática registrada |

---

## 2. Três achados que mudam a conversa

### Achado 1 — O menu tem o dobro do tamanho aprovado

`CLAUDE.md` e `scope-v0.1.1.md` definem cinco itens no menu principal da v0.1.1. `apps/web/src/lib/nav.ts` tem **dez**.

| Item em `PRIMARY_NAV` | Situação no escopo aprovado |
|---|---|
| Dashboard, Nova Busca, Meus Leads, Pipeline, Histórico | Aprovados |
| **IA de Abordagem** (`/ai-outreach`) | **Cortada por completo** — §4.1: *"Duplicação. O card na ficha do lead já entrega a função"* |
| **Propostas** (`/proposals`) | §4.2: modelado no schema, **sem interface** |
| **Contratos** (`/contracts`) | §4.2: modelado no schema, **sem interface** |
| **Precificador** (`/pricing-calculator`) | §4.3: adiado para **v0.2** |
| **Avisos** (`/notifications`) | §4.3: adiado para **v0.2** — na v0.1.1 seria só o sino da topbar |

O detalhe que importa: **essas telas parecem ter backend real.** `/proposals` consome `serverApi('/proposals')` contra `proposals.controller.ts`; existem `notifications.service.ts`, `pricing-calculator.tsx`, `outreach-workbench.tsx`. Não é o defeito clássico de menu cheio com produto vazio — é o oposto: **construiu-se superfície além do escopo aprovado, sem registro da decisão em lugar nenhum.**

Ironia registrada: o comentário nas linhas 25–34 do próprio `nav.ts` enuncia a regra que o array abaixo dele contraria.

Isso não é necessariamente errado — pode ter sido decisão consciente e boa. Mas **decisão de escopo não registrada é decisão que ninguém pode auditar depois**, e cinco itens a mais de superfície são cinco itens a mais para manter, testar e não quebrar antes de o núcleo fechar.

### Achado 2 — Faltam duas telas que o escopo declara não-opcionais, e uma rota está morta

`scope-v0.1.1.md` §3.1: *"Mais as telas de suporte que não são opcionais: `/login`, `/register`, `/onboarding`, `/settings`, `/subscription`."*

Existem: `/login`, `/settings`, `/subscription`.
**Não existem:** `/register`, `/onboarding` — nenhum `page.tsx` em `apps/web/src/app`.

Pior que ausente: **`/register` é rota morta.** `apps/web/src/middleware.ts:6` declara `const PUBLIC_ROUTES = ['/login', '/register']` — o middleware libera o acesso a uma rota que não existe. Visitante não autenticado que chegar lá recebe 404 em vez de ser redirecionado ao login.

O backend está pronto dos dois lados (`auth.controller.ts` expõe register; `account.controller.ts` expõe `GET/PATCH settings/preferences` com estado de onboarding). É **C — Parcial**: falta só a interface.

### Achado 3 — A ficha do lead lê tudo e escreve quase nada

`apps/api/src/leads/leads.controller.ts` expõe onze endpoints, incluindo:

```
POST :id/contact-records      POST :id/follow-ups
POST :id/recalculate-score    POST :id/activities
POST :id/notes                PATCH :id/pipeline-stage
```

`apps/web/src/app/(app)/leads/[id]/page.tsx` **exibe** histórico de contatos (linhas 224–261) e follow-ups (263–308), mas não há nenhum componente para **criar** contato, **agendar/concluir/reagendar/cancelar** follow-up, nem **recalcular** o score. Em `apps/web/src/components/leads/` existem apenas `badges`, `leads-filters`, `lead-pipeline-sidebar`, `lead-note-composer`, `lead-quick-actions`, `lead-outreach-card`.

O escopo §3.2 é explícito: *"registro de contatos e follow-ups com agendar, concluir, reagendar e cancelar"* e *"botão recalcular"*. Também ausente: *"horário de funcionamento com situação calculada (aberto/fechado)"*.

Endpoint sem interface é endpoint que nenhum usuário alcança. **C — Parcial**, e é o que bloqueia o critério 14.

---

## 3. Tabela de conferência — 24 critérios

| # | Critério | Classe | Evidência | O que falta |
|---:|---|:---:|---|---|
| 1 | `F:\drmind` não modificado | **A** | `docker-compose.yml` linhas 3–7 documentam o isolamento e a proibição de `prune`; portas 5434/6381/8081 deslocadas; rede `propectai-network`; volumes `propectai-*` | Declaração formal no relatório de fase (exigência do `CLAUDE.md`) |
| 2 | Bootstrap do zero (`install → up → migrate → seed → dev`) | **G** | Scripts existem em `package.json` (11–31). `prisma/seed.ts`, `seed-data.ts` presentes | Executar em máquina limpa. Não verificável sem runtime |
| 3 | Postgres, Redis e scraper isolados com prefixo `propectai-` | **A** | `docker-compose.yml`: `container_name` propectai-postgres / -redis / -gmaps-scraper; bind em `127.0.0.1`; volume `./data/gmapsdata` conforme decidido na auditoria de ambiente | — |
| 4 | Login, refresh, logout; sessão resolve tenant ativo | **G** | `auth.controller.ts`, `auth.service.ts`, `common/tenant.guard.ts`, `common/request-context.ts`, `web/src/lib/session.ts`, `middleware.ts` com cookie `pa_rt` | Execução do fluxo |
| 5 | Teste prova que tenant A não vê dado de B | **A** | **Executado em 31/07/2026, provado nas duas camadas.** Banco: `tenant-isolation.spec.ts`, 5 de 5 — índices compostos, idempotência, contagem. HTTP: `tenant-isolation-http.spec.ts`, 6 de 6 — `TenantGuard` em requisição real, 404 por id conhecido, KPIs do dashboard, `x-tenant-id` forjado recusado. Suíte completa: 20 testes, 3 suítes | — *(ver nota de execução abaixo)* |
| 6 | Onboarding de 5 etapas persiste e é reiniciável | **G** | **Implementado em 31/07/2026.** `app/(app)/onboarding/page.tsx` + `onboarding-wizard.tsx` (5 etapas, persiste a cada avanço); `POST settings/onboarding/complete` e `/restart`; `restart-onboarding-button.tsx` em Configurações. `pnpm typecheck` e `next lint` verdes | Falta o percurso no navegador: cadastro → wizard → `/search` → Configurações → Refazer |
| 7 | Dashboard calcula KPIs por query, nada escrito no componente | **G** | `dashboard.service.ts` + `dashboard.controller.ts`; `dashboard/page.tsx` consome `serverApi` | Conferir os sete KPIs um a um com banco populado |
| 8 | Nova Busca completa o ciclo com provider mock, progresso visível | **G** | `prospecting.service.ts` (BullMQ via ioredis), `worker/src/providers/mock.provider.ts`, `search-form.tsx`, `search/page.tsx` | Execução |
| 9 | `GoogleMapsScraperProvider` traz leads reais do container | **G** | `worker/src/providers/google-maps.provider.ts` | Scraper no ar + coleta real |
| 10 | Repetir busca não duplica nem consome cota de novo | **A** | **Provado em 31/07/2026** por `apps/worker/test/scrape-pipeline.spec.ts`: a segunda execução da mesma busca devolve `newLeads: 0`, `duplicates > 0`, consumo inalterado e contagem total de leads estável. Job falho devolve a reserva por inteiro, sem consumir nem gerar crédito | — |
| 11 | Nenhum lead concluído com score nulo/zero sem `LeadScoreReason` | **A** | **Provado nas duas frentes.** Comportamento: `scrape-pipeline.spec.ts` afirma que todo lead criado pelo pipeline tem score e motivos. Estado: `apps/api/test/business-invariants.spec.ts` varre o banco inteiro — score sem motivo, lead sem score, valor fora de 0–100 | — |
| 12 | Ficha mostra pontos positivos e de atenção do score | **A** | `leads/[id]/page.tsx:169–199` e `ReasonList` (371–414), com peso e **evidência por motivo**; versão do algoritmo e data exibidas (174) | Falta o **botão recalcular** exigido em §3.2 (endpoint `POST :id/recalculate-score` já existe) |
| 13 | Copiar telefone, abrir mapa e abrir WhatsApp geram `LeadActivity` | **G** | `lead-quick-actions.tsx` + `POST :id/activities` | Execução |
| 14 | Registrar contato atualiza timeline; criar follow-up atualiza lista e avisos | **G** | **Implementado em 31/07/2026.** `lead-contact-form.tsx`, `lead-follow-ups.tsx` (agendar, concluir, cancelar, reagendar) e `recalculate-score-button.tsx`. Backend ganhou `PATCH :id/follow-ups/:followUpId`, que faltava — só havia criar | Falta exercitar no navegador |
| 15 | Pipeline move card por drag and drop, com rollback em erro | **G** | `pipeline-board.tsx`, `pipeline.service.ts`, `PATCH :id/pipeline-stage` | Execução — rollback só se prova provocando falha |
| 16 | Meus Leads pagina no servidor e combina filtros | **G** | `leads.service.ts`, `leads.dto.ts`, `leads-filters.tsx`, `GET /leads` + `GET /leads/facets` | Execução |
| 17 | Histórico reflete buscas com duração e duplicados | **G** | `history/page.tsx` | Execução com as 3 buscas do seed |
| 18 | IA de abordagem gera com `MockAIProvider` e salva histórico | **G** | `outreach/providers/mock-ai.provider.ts` + `mock-ai.provider.spec.ts` (testa gancho de construtor gratuito); `lead-outreach-card.tsx` com histórico | Execução. **Nota:** ver Achado 1 — a tela dedicada `/ai-outreach` foi construída apesar de cortada |
| 19 | Feature gates nos 4 planos e **nenhum modal abre sem ação** | **G** | `entitlements.service.ts` centraliza tudo (comentário 13–19); comentário 47–50 declara que o método só lança em ação explícita; `leads/[id]/page.tsx:64–65` documenta que consultar cota não dispara bloqueio | Desenho correto. Provar exige carregar as telas nos 4 planos (`pnpm db:plan`) |
| 20 | Versão 0.1.1 em rodapé, Configurações e `/api/v1/system/version` | **A** | `app-footer.tsx:31` (+ status da API), `settings/page.tsx:43`, `system.controller.ts`, `main.ts:50` no Swagger | — |
| 21 | Swagger documenta todos os endpoints implementados | **A** | **Corrigido em 31/07/2026.** Dez `addTag` em `main.ts`, um por módulo, ordenados pelo percurso do produto. Os dez controllers têm `@ApiTags` e cada endpoint tem `@ApiOperation` com descrição de efeito | — |
| 22 | Nenhum dado pessoal de avaliador persistido | **A** | `google-maps.provider.ts:145–149` descarta `user_reviews` e `owner` na origem; `process-scrape-job.ts:292–293` confirma que `RawLead` nunca os carregou | Recomendo transformar em teste automatizado — hoje é garantido por código e comentário, não por asserção |
| 23 | Layout íntegro em 1920, 1440, 1366 e 390 px | **G** | Tailwind com tokens; grid `xl:grid-cols-[minmax(0,1fr)_320px]`; sidebar `hidden lg:flex` | Verificação visual. Não inferível de código |
| 24 | **Construtor de Sites não existe** | **A** | Busca por `construtor\|Criar Site\|Gerar Site\|site-builder` em `apps/`: as únicas ocorrências são (a) a **proibição** em `nav.ts:32`, (b) `"construtor gratuito"` como *gancho comercial* em `outreach.service.ts:242` e no spec, (c) `construtor do ioredis` em `prospecting.service.ts:43`. Nenhuma rota, menu, tabela ou botão | — |

### Nota de execução — 31/07/2026

Na primeira tentativa, as cinco asserções de isolamento **falharam** com `PrismaClientInitializationError: Can't reach database server at localhost:5434`, com o Postgres comprovadamente no ar (`pg_isready` respondendo).

Causa: o Jest rodava as duas suítes em paralelo e cada worker sobe o próprio engine nativo do Prisma — que passa de 5s no Windows, conforme o comentário do próprio teste. Os engines competiam e o `$connect()` estourava. O Prisma reporta timeout de conexão com a mesma mensagem de servidor inalcançável.

Nenhuma asserção chegou a rodar. **Lido às pressas, seria "cinco testes de isolamento falharam" — risco de vazamento entre clientes reportado onde havia problema de concorrência de teste.** É o caso concreto que justifica a regra de não tratar "não verificável" como "ausente".

Corrigido com `maxWorkers: 1` no config do `@propectai/api`, com o motivo registrado no próprio arquivo. Suíte caiu de 122s para 33s — o custo era contenção, não trabalho. O `--passWithNoTests` foi removido do script na mesma passada: agora que existem testes, a flag só serviria para deixar a suíte verde caso alguém quebrasse o `testMatch`.

### Contagem

| Classe | Qtd | Critérios |
|---|---:|---|
| **A** — satisfeito com evidência | 10 | 1, 3, 5, 10, 11, 12, 20, 21, 22, 24 |
| **B** — abaixo do escopo | 0 | — |
| **C** — parcial | 0 | — |
| **G** — implementado, pendente de exercício | 14 | 2, 4, 6, 7, 8, 9, 13, 14, 15, 16, 17, 18, 19, 23 |
| **F** — ausente | 0 | — |

**Nenhum critério continua parcial ou abaixo do escopo.** Os catorze em G têm código completo que compila e passa no lint; o que falta em cada um é exercício — a maioria no navegador.

Os critérios 6 e 14 saíram de C e **não entraram em A**: código pronto não é fluxo verificado. Marcar como aprovado aqui repetiria exatamente o erro que este documento existe para evitar.

### Suíte de testes — 31/07/2026

| Pacote | Runner | Arquivos | Testes |
|---|---|---:|---:|
| `@propectai/api` | Jest, serial | 4 | 26 |
| `@propectai/types` | Vitest | 2 | 35 |
| `@propectai/worker` | Vitest, serial | 1 | 5 |
| **Total** | | **7** | **66** |

Contra os 4 arquivos e 39 testes do início da conferência. As adições cobrem isolamento na camada HTTP, invariantes comerciais de estado e o ciclo completo do pipeline com provider mock.

**Leitura honesta:** zero critérios ausentes, três parciais, um abaixo do especificado — e **treze que ninguém pode afirmar que passam até serem exercitados.** Nenhum indício de mock apresentado como produção; a regra 7 do `CLAUDE.md` parece respeitada em todo o front inspecionado.

O critério 9 deixou de estar bloqueado por alarme falso — o `unhealthy` do scraper era healthcheck inválido, não defeito (ver `CHANGELOG.md`, 31/07). Continua em G até uma busca real produzir leads deduplicados e pontuados.

---

## 4. Desvios de escopo não registrados

Além dos três achados, itens que divergem do aprovado sem decisão documentada:

| Desvio | Referência violada | Gravidade |
|---|---|---|
| 5 itens extras no menu principal | `CLAUDE.md` "Sidebar da v0.1.1"; escopo §4.1–4.3 | Alta — muda a definição de pronto da versão |
| `/ai-outreach` construída | §4.1: "Cortado por completo" | Média — duplica função da ficha do lead |
| `/proposals` e `/contracts` com interface | §4.2: "sem rota, sem item de menu" | Média |
| `/register` no middleware sem página | §3.1 | **Alta — rota morta em produção** |
| Sem tela `/onboarding` | §3.1 e critério 6 | Alta |
| E2E Playwright dos 3 fluxos críticos | §4.3: previsto para a v0.1.1 | Média — não localizados |

**Suíte de testes localizada, na íntegra:** `apps/api/test/tenant-isolation.spec.ts`, `apps/api/test/mock-ai.provider.spec.ts`, `packages/types/src/scoring-engine.test.ts`, `packages/types/src/normalize.test.ts`. Quatro arquivos. Para 24 critérios de aceite, é pouco — e nenhum deles cobre as regras comerciais 5.3 (cota) e 5.4 (score obrigatório), que o escopo classifica como invioláveis.

---

## 5. O que fecha a v0.1.1

Ordenado por bloqueio, não por esforço:

1. **Liberar espaço em disco e executar o ambiente.** Quatorze critérios estão em G por isso. Nenhuma outra tarefa desta lista deveria começar antes — sem runtime, todo relatório de fase seguinte é opinião.
2. **Rodar `pnpm test`** e registrar o resultado real de `tenant-isolation.spec.ts`. É o critério 5, o único cuja falha significa vazamento entre clientes.
3. **Criar `/register`** — hoje é rota pública apontando para o vazio.
4. **Criar `/onboarding`** com as 5 etapas e a ação de reiniciar em Configurações (critério 6).
5. **UI de escrita na ficha do lead**: registrar contato, agendar/concluir/reagendar/cancelar follow-up, recalcular score. Os quatro endpoints já existem (critério 14).
6. **Testes das duas regras comerciais**: duplicado não consome cota / job falho devolve reserva (5.3), e nenhum lead concluído sem `LeadScoreReason` (5.4 — o escopo pede asserção, não boa intenção).
7. **Decidir o menu.** Ou os cinco itens extras voltam para a v0.2, ou o `scope-v0.1.1.md` é atualizado registrando a mudança e os critérios de aceite correspondentes. As duas saídas são legítimas; deixar como está não é.
8. **`addTag` por módulo no Swagger** (critério 21).
9. **QA visual nas 4 larguras** (critério 23).
10. **E2E dos 3 fluxos críticos.**

Itens 3, 4 e 5 são o grosso do trabalho de interface restante. Itens 1 e 2 são pré-requisito de tudo.

---

## 6. Conclusão

O código inspecionado tem qualidade acima da média e coerência clara com o escopo aprovado: multi-tenant desde a primeira migration, entitlements centralizados com o comentário certo no lugar certo, descarte de PII na origem, score com evidência por motivo exibida ao usuário, proibição do Construtor de Sites respeitada sem exceção. Os comentários explicam *por que*, não *o que* — inclusive as decisões contraintuitivas, como o bind dual-stack em `main.ts:60–66`.

O problema não é qualidade. É **fronteira**: a v0.1.1 cresceu cinco telas além do aprovado enquanto duas telas obrigatórias ficaram para trás e a camada de escrita da tela mais importante do produto ficou pela metade. E há **quatorze critérios que ninguém pode declarar aprovados**, porque o ambiente não subiu.

**Recomendação:** não iniciar a v0.2 — nem qualquer item extraído do prompt mestre — antes de os 24 critérios estarem verdes com evidência de execução. A tabela acima é o checklist.
