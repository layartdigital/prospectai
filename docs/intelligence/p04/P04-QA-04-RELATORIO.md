# P04-QA-04 v1.0.0 — Homologação E2E REAL no GitHub Actions — Intelligence Explorer

**Módulo:** Intelligence Explorer **0.1.0** · **PR #7 (rascunho)** · **Branch:** `feat/prompt-04-intelligence-explorer` · **Commit de partida:** `002880203714a07f46ee0e5103fb48d118d1321e` (QA-03, validado pelo CI #75) · **Commit desta rodada:** ver a mensagem de entrega e `git log` (um commit sobre `0028802`).
**`F:\drmind` (Bellvia) não foi modificado.** Nenhum deploy, merge, migration em produção, restart ou acesso ao servidor produtivo; a stack `prospectai-prod` e a coleta pendente do GATE-DB-42501 não foram tocadas. SEC-DATA-01, SEC-DB-02, Company 360, Flowsint e novas funcionalidades de IA **não** foram iniciados.

## Veredito

```
P04_QA_04_EXECUTION   = AUTHORED_NOT_EXECUTED   (o portão E2E foi construído e revisado; a execução real é a do GitHub Actions
                                                  depois do push do proprietário. Nada abaixo é declarado como executado.)
P04_QA_04_RESULT      = INCONCLUSIVE
CI_BASELINE_75        = PASS   (Actions #75, commit 0028802, 4/4 jobs verdes — informado pelo proprietário por capturas de tela;
                                #75 NÃO executou teste de navegador no app real)
```

**Por que INCONCLUSIVE.** A ordem pede evidência de um navegador real contra Next.js, NestJS, Prisma e PostgreSQL reais, e o único lugar autorizado para isso é o GitHub Actions. Esta sessão não consegue executar nada disso (sem registro npm, sem daemon Docker, e o PC do proprietário está fora de questão por exigência da ordem), e o proxy Git da sessão não publica. Em vez de simular o resultado, entreguei o portão pronto, incorporado ao “Resultado do CI”, e declaro cada cenário como **NOT_EXECUTED** até que o run exista. O veredito sobe para `PASS` ou `PASS_WITH_LIMITATIONS` **somente** com o run verde e a matriz da seção “Matriz de cenários” preenchida a partir dele.

**O que foi verificado aqui, de verdade** (não é execução dos testes):

| Verificação | Resultado |
|---|---|
| Tipagem estrita (TS 6.0.3, `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`) das 4 specs, do suporte, do `helpers.ts` e do `playwright.ci.config.ts` contra os tipos reais do `@playwright/test` | 0 erros |
| Sintaxe da fixture `prisma/e2e-explorer-fixtures.ts` (sem o cliente Prisma gerado aqui) | OK; tipos conferidos por leitura contra o `schema.prisma` e contra o `seed.ts` (o `typecheck:scripts` do CI é quem confirma) |
| Gateway `apps/web/e2e/ci/gateway.mjs` contra dois servidores de teste locais | roteia `/api` e o resto, preserva `Host`, corpo e `Set-Cookie` |
| `ci.yml` | YAML válido; sem `continue-on-error`; sem `\|\| true`; o job `e2e` é obrigatório em “Resultado do CI” |
| Contratos de DOM, rótulos, endpoints e mensagens usados nas specs | lidos no código real do Explorer, da API e do schema (não de memória) |

## O que foi construído

```
.github/workflows/ci.yml                       novo job `e2e`; `resultado` agora exige tipos+builds+testes+e2e
apps/web/playwright.ci.config.ts               config do CI: sem webServer, sem trace, sem retry, forbidOnly
apps/web/e2e/ci/gateway.mjs                    gateway same-origin mínimo (/api -> API, resto -> Next)
apps/web/e2e/explorer-support.ts               suporte comum (manifesto, login real, seletores, evidências)
apps/web/e2e/explorer-01-acesso-ficha-e-grafo.spec.ts       E2E-01, E2E-02, E2E-03
apps/web/e2e/explorer-02-expansao-e-interface.spec.ts       E2E-04, E2E-05
apps/web/e2e/explorer-03-isolamento-e-sessao.spec.ts        E2E-06, E2E-07
apps/web/e2e/explorer-04-responsividade.spec.ts             E2E-08
apps/web/e2e/global-setup.ts                   1 linha: o log de diagnóstico do login não imprime mais o corpo (senha)
prisma/e2e-explorer-fixtures.ts + script `db:e2e-fixtures`  fixtures sintéticas Alfa/Beta (Prisma real)
.gitignore                                     manifesto gerado e saídas do Playwright de CI
docs/intelligence/p04/qa/E2E-REAL.md           como o E2E funciona, roda e se lê
```

**Reaproveitamento antes de dependência nova.** Nenhuma dependência foi adicionada (`pnpm-lock.yaml` intacto): o Playwright, o `helpers.ts` (login real), o `global-setup.ts`, o seed, o `db:plan` e os fluxos `fluxo-0…4` já existiam. O gateway usa só `node:http`.

### Topologia do job `e2e` (construída para não ser a bancada)

```
PostgreSQL 16 (serviço do job, efêmero)  <-  NestJS  (node apps/api/dist/main.js, NODE_ENV=production)
   migrations em 2 estágios (como no servidor) + seed + fixtures            ^
                                                                            |  /api/*
Chromium (Playwright) -> gateway :3100 ----------------------------------- +
                                  \--- resto ---> Next.js (next start, build de produção) :3200
```

- **Next.js real** em build de produção (`next build` + `next start`, o mesmo comando do Dockerfile de produção), **NestJS real** (`nest build` + `node dist/main.js`), **Prisma real** com o papel `propectai_app` (sem BYPASSRLS) e **PostgreSQL 16 real** do serviço do job. A API sobe **sem** `DATABASE_URL` e sem `DATABASE_URL_MIGRATOR` (`env -u`), só com as credenciais de runtime, como no servidor.
- **O gateway não é um simulador.** Em produção o nginx entrega uma origem só (`/api` para a API); em `next start` o Next não tem rewrite de `/api` de propósito (`next.config.mjs`). O gateway repassa cada requisição, byte a byte, para a aplicação real. Não responde nada por conta própria.
- **Nada de produção:** sem segredos do repositório (todas as credenciais do job são descartáveis e documentadas como tal), sem SSH, sem deploy, `permissions: contents: read` mantido.
- **`APP_VERSION` não é definida** no job (os jobs `builds`/`testes` usam `ci`): o rodapé mostra `0.1.1` e o teste do fluxo 1 o confere.

### Fixtures (E2E sobre dados reais do banco, não sobre respostas escritas à mão)

- **Alfa** = o tenant de demonstração (`layart-demo`, OWNER do seed) enriquecido com `Alfa Hub Relacional E2E`: pesquisa, score com motivos (motor real `computeScore`), presença digital (Instagram/Facebook `DESCONHECIDO`, e-mail `AUSENTE`), cartão no pipeline (etapa “Respondeu”), **11 notas, 4 atividades, 2 contatos, 1 follow-up e nenhuma auditoria**; 11 leads-satélite na mesma pesquisa (o primeiro com presença digital, para provar o teto de profundidade); e `Alfa Removido E2E`, **excluído logicamente na mesma pesquisa** (a contagem tem de ser 12, não 13).
- **Beta** = tenant novo, usuário próprio (senha descartável do job), 2 leads, 3 notas.
- Gravação pela mesma via do seed (Prisma, papel `propectai_migrator`). O script **recusa** rodar contra host de banco que não seja local.

## Matriz de cenários e resultados

Resultado de **todas** as linhas: `NOT_EXECUTED` neste momento (autoria concluída; execução = GitHub Actions). A coluna “Passará a provar” é o que o teste verde significa.

| ID | Cenário | Teste (arquivo · título) | Passará a provar | Resultado |
|---|---|---|---|---|
| E2E-01 | Autenticação pela interface | `explorer-01` · E2E-01a/b/c | sem sessão: `/intelligence` vai ao login e a API do grafo responde 401; credencial errada não autentica; login real leva ao dashboard e ao Explorer, sem modal de bloqueio | NOT_EXECUTED |
| E2E-02 | Lista de leads → ficha → “Explorar relações” → `/intelligence?lead=<id>` | `explorer-01` · E2E-02, E2E-02b | o lead da ficha é a raiz do grafo; o botão aponta para a URL certa; item “Intelligence” do menu abre o Explorer; capturas da ficha e do Explorer | NOT_EXECUTED |
| E2E-03 | Grafo inicial real | `explorer-01` · E2E-03 | exatamente as 5 entidades que as fixtures têm (lead, pesquisa, score, presença, cartão), 4 arestas `VERIFICADA`/`FOREIGN_KEY`, nenhum nó de auditoria/nota/etc.; DOM = resposta da API; contagens 11/4/2/1 das relações de vários itens; prova de profundidade em todo nó | NOT_EXECUTED |
| E2E-04 | Expansão, paginação, duplicação, limites | `explorer-02` · E2E-04a/b/c | 11 notas = 8 + 3 e botão “Completo”; duplo clique = 1 pedido; nenhum `data-no` repetido; pesquisa = 12 leads em 2 páginas **sem o removido**; presença do satélite a profundidade 3 e o **sinal (profundidade 4) recusado com 400 e mensagem na tela**; servidor recusa `pageSize` 26/0, `offset` −1, profundidade adulterada, prova de outro nó e combinação de tipos inválida | NOT_EXECUTED |
| E2E-05 | Interface | `explorer-02` · E2E-05a/b | seleção por mouse e teclado (Tab/Enter/Esc), painel e proveniência, zoom por botões e teclado (+/−/0), filtros por tipo (lead fixo), sinais `Desconhecido`/`Presente`/`Ausente`, etapa “Respondeu”, motivos do score, lista alternativa para leitor de tela, estados vazio, sem resultado, erro (lead removido e id malformado), recuperação e ausência de exceções de JS | NOT_EXECUTED |
| E2E-06 | Isolamento Alfa × Beta (asserções no DOM e na API) | `explorer-03` · E2E-06a/b/c/d | Beta só vê Beta (busca, grafo, expansões); URL direta de lead alheio → 404 do servidor, mensagem neutra, nada do outro workspace na tela; ficha alheia inexistente; **prova de profundidade do Alfa reaproveitada na sessão do Beta é recusada**; duas janelas simultâneas sem mistura de nós | NOT_EXECUTED |
| E2E-07 | Mudança de sessão em outra aba | `explorer-03` · E2E-07a…e | logout, login de outro workspace e login de outro **usuário do mesmo workspace** em outra aba descartam o Explorer; troca **silenciosa** de cookie + `focus`/`visibilitychange`/`pageshow`/`online` também; **o relógio de 20 s é removido da página** (nenhum `waitForTimeout`); resposta real atrasada (retida pelo teste até depois da troca) não repovoa a tela, verificado por observador de DOM | NOT_EXECUTED |
| E2E-08 | Responsividade 1440 / 820 / 390 | `explorer-04` · E2E-08 ×3, E2E-08b | sem rolagem horizontal, busca/grafo/detalhes dentro da largura, grafo com área útil, alvos de zoom ≥ 32 px, botão da ficha cabe em 390 px; capturas | NOT_EXECUTED |
| E2E-09 | Regressão do produto | `fluxo-0…4` (existentes, sem alteração) | transporte same-origin, login/logout, dashboard, leads (paginação/filtros), pesquisa, cadastro e onboarding, ficha do lead, planos e permissões, navegação | NOT_EXECUTED |

## Conformidade com as restrições da ordem

| Restrição | Como foi atendida |
|---|---|
| Não depender do computador do proprietário nem de espaço no Windows | tudo roda no runner do GitHub; o proprietário só faz o `git push` |
| Não usar a bancada no lugar da aplicação completa | a bancada não participa; o job sobe a API e o Next reais |
| Não usar a stack/servidor de produção | nenhum acesso; fixtures recusam banco não local |
| Não simular Prisma, Next, HTTP ou autenticação | nenhuma simulação. Único intermediário: o gateway (repassa), e uma rota de teste que **retém** (não altera) uma resposta real em E2E-07e |
| Sem `continue-on-error`, `\|\| true`, `test.skip` | nenhum; `forbidOnly` e `retries: 0` no Playwright de CI. A regressão roda com `!cancelled()`, mas o job reprova se qualquer passo reprovar |
| Sanitizar screenshots, logs, traces | `trace` e `video` desligados; log de login sem corpo; varredura de sanitização (senhas do job, `pa_at=`, `pa_rt=`, `Set-Cookie`) **antes** de publicar — achou, o job cai e a publicação é pulada; capturas só de telas autenticadas com dados sintéticos |
| `permissions: contents: read`, sem deploy/SSH/credencial de produção | mantido; só `actions/upload-artifact` (somente leitura do repositório) |
| Novo job faz parte do portão final | `Resultado do CI` agora lista `e2e` em `needs` e exige `success` |
| Não executar merge; não iniciar SEC-DATA-01 / SEC-DB-02 / GATE-DB-42501 | não executado / não iniciados |

## Limitações declaradas (nada escondido)

1. **Sem execução nesta sessão.** As specs foram tipadas e relidas contra o código, mas **nunca rodaram**. É provável que o primeiro run revele ajustes de seletor ou de tempo (por exemplo o nome acessível exato dos botões “Carregar”, ou o status do 404 da ficha, que as specs verificam pelo texto da página). Isso se corrige no próprio PR; o veredito não sobe antes.
2. **Teto de 60 nós por resposta e de 150 nós na tela não são alcançados** com estas fixtures (a maior página tem 25 nós e o grafo de teste chega a ~40). Continuam cobertos por testes unitários/HTTP da API e pela bancada de volume (QA-01), não por E2E. A profundidade máxima (3) **é** exercitada na aplicação real.
3. **“Troca de workspace”** não tem tela própria no produto (o workspace muda pelo login); é exercitada como mudança de identidade (outro workspace, outro usuário no mesmo workspace, logout).
4. A **resposta atrasada** de E2E-07e é uma resposta real da API retida pelo teste; não é uma resposta artificial.
5. `fluxo-0…4` nunca rodaram no CI; podem falhar por razões antigas e alheias ao Explorer (dependem de seed e de `db:plan`). Se falharem, o relatório dirá qual e por quê, sem mascarar.

## O que o proprietário precisa fazer (um passo, sem merge)

```powershell
cd C:\ResgateProjetos\prospectai
git fetch "C:\ResgateProjetos\prospectai\Claude outputs\PROSPECTAI-P04-QA04-E2E.bundle" feat/prompt-04-intelligence-explorer:qa04-entrada
git switch feat/prompt-04-intelligence-explorer
git merge --ff-only qa04-entrada
git push origin feat/prompt-04-intelligence-explorer
```

O CI do PR #7 dispara. Depois, **devolver**: (1) o resultado do run (print dos 5 jobs, com “E2E real (Playwright)”); (2) se algo caiu, o log do passo vermelho; (3) o artefato `e2e-evidencias` (contém `resultado.json` e `relatorio-html` de cada etapa, as capturas e os logs `api/web/gateway`). Com isso a Executora preenche a matriz acima, corrige o que o run apontar (só na branch do PR #7) e reavalia o veredito. **Não fazer merge.**

## Correção de histórico (QA-03)

O `P04-QA-03-RELATORIO.md` foi anotado: o CI #75 aprovou `0028802` (4/4 jobs), mas **não executou testes de navegador na aplicação real** — por isso a homologação funcional da QA-03 seguiu `INCONCLUSIVE`. A QA-04 existe para produzir essa evidência.

## Próximo passo recomendado

Publicar, deixar o run terminar e devolver o resultado. Só então decidir, em ordem separada, qualquer publicação controlada (merge do PR #7 por você, deploy com checklist e janela próprios). SEC-DATA-01 e GATE-DB-42501 T1 seguem exatamente onde estavam.
