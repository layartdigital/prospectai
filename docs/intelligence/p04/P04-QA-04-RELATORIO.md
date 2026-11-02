# P04-QA-04 v1.0.0 — Homologação E2E REAL no GitHub Actions — Intelligence Explorer

**Módulo:** Intelligence Explorer **0.1.0** · **PR #7 (rascunho)** · **Branch:** `feat/prompt-04-intelligence-explorer` · **Commit de partida:** `002880203714a07f46ee0e5103fb48d118d1321e` (QA-03, validado pelo CI #75) · **Commit desta rodada:** ver a mensagem de entrega e `git log` (um commit sobre `0028802`).
**`F:\drmind` (Bellvia) não foi modificado.** Nenhum deploy, merge, migration em produção, restart ou acesso ao servidor produtivo; a stack `prospectai-prod` e a coleta pendente do GATE-DB-42501 não foram tocadas. SEC-DATA-01, SEC-DB-02, Company 360, Flowsint e novas funcionalidades de IA **não** foram iniciados.

> **Estado atual (P04-CLOSE-01, 02/11/2026): `P04_QA_04R_RESULT = PASS`.** O veredito “AUTHORED_NOT_EXECUTED / INCONCLUSIVE” abaixo é o **histórico** da entrega de autoria (commit `84a96c6`) e foi superado: o commit `78e9fe2` foi homologado pelo GitHub Actions **#77** (Explorer 27/27, regressão 29/29, 0 falhas, 0 instáveis, 0 pulados). Ver a seção **“P04-QA-04R”** e o **“Fechamento P04-CLOSE-01”** ao final deste documento. O texto histórico não foi reescrito.

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

**Resultado atual (P04-CLOSE-01): todas as linhas `PASS` no Actions #77** (commit `78e9fe2`): E2E-01…08 = 27 testes, 27 aprovados; E2E-09 = 29 testes, 29 aprovados; 0 falhas, 0 instáveis, 0 pulados (contagens lidas na saída do passo “Resumo dos testes” do log do job). Antes do #76 todas as linhas estavam `NOT_EXECUTED`; no #76 (commit `84a96c6`) E2E-05a e o teste do rodapé do fluxo 1 falharam e E2E-05b não executou. A coluna “Passará a provar” é o que o teste verde significa — agora ele está verde.

| ID | Cenário | Teste (arquivo · título) | Passará a provar | Resultado |
|---|---|---|---|---|
| E2E-01 | Autenticação pela interface | `explorer-01` · E2E-01a/b/c | sem sessão: `/intelligence` vai ao login e a API do grafo responde 401; credencial errada não autentica; login real leva ao dashboard e ao Explorer, sem modal de bloqueio | **PASS** (#77) |
| E2E-02 | Lista de leads → ficha → “Explorar relações” → `/intelligence?lead=<id>` | `explorer-01` · E2E-02, E2E-02b | o lead da ficha é a raiz do grafo; o botão aponta para a URL certa; item “Intelligence” do menu abre o Explorer; capturas da ficha e do Explorer | **PASS** (#77) |
| E2E-03 | Grafo inicial real | `explorer-01` · E2E-03 | exatamente as 5 entidades que as fixtures têm (lead, pesquisa, score, presença, cartão), 4 arestas `VERIFICADA`/`FOREIGN_KEY`, nenhum nó de auditoria/nota/etc.; DOM = resposta da API; contagens 11/4/2/1 das relações de vários itens; prova de profundidade em todo nó | **PASS** (#77) |
| E2E-04 | Expansão, paginação, duplicação, limites | `explorer-02` · E2E-04a/b/c | 11 notas = 8 + 3 e botão “Completo”; duplo clique = 1 pedido; nenhum `data-no` repetido; pesquisa = 12 leads em 2 páginas **sem o removido**; presença do satélite a profundidade 3 e o **sinal (profundidade 4) recusado com 400 e mensagem na tela**; servidor recusa `pageSize` 26/0, `offset` −1, profundidade adulterada, prova de outro nó e combinação de tipos inválida | **PASS** (#77) |
| E2E-05 | Interface | `explorer-02` · E2E-05a/b | seleção por mouse e teclado (Tab/Enter/Esc), painel e proveniência, zoom por botões e teclado (+/−/0), filtros por tipo (lead fixo), sinais `Desconhecido`/`Presente`/`Ausente`, etapa “Respondeu”, motivos do score, lista alternativa para leitor de tela, estados vazio, sem resultado, erro (lead removido e id malformado), recuperação e ausência de exceções de JS | **PASS** (#77) |
| E2E-06 | Isolamento Alfa × Beta (asserções no DOM e na API) | `explorer-03` · E2E-06a/b/c/d | Beta só vê Beta (busca, grafo, expansões); URL direta de lead alheio → 404 do servidor, mensagem neutra, nada do outro workspace na tela; ficha alheia inexistente; **prova de profundidade do Alfa reaproveitada na sessão do Beta é recusada**; duas janelas simultâneas sem mistura de nós | **PASS** (#77) |
| E2E-07 | Mudança de sessão em outra aba | `explorer-03` · E2E-07a…e | logout, login de outro workspace e login de outro **usuário do mesmo workspace** em outra aba descartam o Explorer; troca **silenciosa** de cookie + `focus`/`visibilitychange`/`pageshow`/`online` também; **o relógio de 20 s é removido da página** (nenhum `waitForTimeout`); resposta real atrasada (retida pelo teste até depois da troca) não repovoa a tela, verificado por observador de DOM | **PASS** (#77) |
| E2E-08 | Responsividade 1440 / 820 / 390 | `explorer-04` · E2E-08 ×3, E2E-08b | sem rolagem horizontal, busca/grafo/detalhes dentro da largura, grafo com área útil, alvos de zoom ≥ 32 px, botão da ficha cabe em 390 px; capturas | **PASS** (#77) |
| E2E-09 | Regressão do produto | `fluxo-0…4` (existentes, sem alteração) | transporte same-origin, login/logout, dashboard, leads (paginação/filtros), pesquisa, cadastro e onboarding, ficha do lead, planos e permissões, navegação | **PASS** (#77) |

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

1. *(Resolvida no #77 — texto histórico)* **Sem execução nesta sessão.** As specs foram tipadas e relidas contra o código, mas **nunca rodaram**. É provável que o primeiro run revele ajustes de seletor ou de tempo (por exemplo o nome acessível exato dos botões “Carregar”, ou o status do 404 da ficha, que as specs verificam pelo texto da página). Isso se corrige no próprio PR; o veredito não sobe antes.
2. **Teto de 60 nós por resposta e de 150 nós na tela não são alcançados** com estas fixtures (a maior página tem 25 nós e o grafo de teste chega a ~40). Continuam cobertos por testes unitários/HTTP da API e pela bancada de volume (QA-01), não por E2E. A profundidade máxima (3) **é** exercitada na aplicação real.
3. **“Troca de workspace”** não tem tela própria no produto (o workspace muda pelo login); é exercitada como mudança de identidade (outro workspace, outro usuário no mesmo workspace, logout).
4. A **resposta atrasada** de E2E-07e é uma resposta real da API retida pelo teste; não é uma resposta artificial.
5. *(Resolvida no #77: 29/29 aprovados — texto histórico)* `fluxo-0…4` nunca rodaram no CI; podem falhar por razões antigas e alheias ao Explorer (dependem de seed e de `db:plan`). Se falharem, o relatório dirá qual e por quê, sem mascarar.

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

---

## P04-QA-04R — correção direcionada após o primeiro E2E real (Actions #76)

**`F:\drmind` (Bellvia) não foi modificado.** Nenhum deploy, merge, migration, acesso ao PostgreSQL de produção, restart de serviço produtivo, alteração de outras stacks, SEC-DATA-01, SEC-DB-02 ou GATE-DB-42501. Nenhuma funcionalidade nova, migration ou mudança de infraestrutura produtiva. **Nenhum código do produto foi alterado**: as três correções estão em specs, no CI e no gerador de saída publicável.

**Ponto de partida:** commit `84a96c6abfad30ce760a27f092f414d84cd4c471`, run #76 (informado pelo proprietário): tipos, builds, HTTP e RLS passaram; Explorer **25 passaram / 1 falhou / 1 não executado**; regressão **28 passaram / 1 falhou**; a sanitização reprovou e **bloqueou corretamente** a publicação das evidências.

### Veredito

```
P04_QA_04R_EXECUTION  = COMPLETE
P04_QA_04R_RESULT     = PASS        (Actions #77, commit 78e9fe2 — atualizado em P04-CLOSE-01)
```

*Histórico:* na entrega do commit, antes de qualquer run, o veredito foi `PARTIAL / INCONCLUSIVE`, porque esta sessão não tem registro npm, Docker nem push e **não executou** a suíte. O run #77, publicado pelo proprietário, confirmou as três correções (ver “Fechamento P04-CLOSE-01”). A tabela “Verificado aqui” abaixo continua descrevendo o que foi checado **localmente** antes do run.

### Causa raiz por falha

| # | Falha no #76 | Causa raiz | Classificação | Correção |
|---|---|---|---|---|
| A | E2E-05a: `Expected: > 0 / Received: 0` em `SCORE_REASON`, logo após `carregarRelacao(page, 'Motivo do score')`. E2E-05b “não executado” | O auxiliar esperava só a **resposta HTTP 200** de `/intelligence/expand` e o teste lia o DOM no mesmo instante, antes de o React desenhar os nós. A API **devolveu** os 8 motivos (as fixtures geram 8 pelo `computeScore` real). E2E-05b ficou “não executado” porque o arquivo roda em modo `serial`: depois de uma falha, o Playwright não executa os seguintes | **Defeito de teste (sincronização)** — não é defeito do produto | `carregarRelacao` agora lê o corpo da resposta e espera, pela condição observável (`toBeAttached`), **cada nó devolvido pela API** estar no SVG. Se a interface realmente perdesse nós, a espera estoura listando o nó que faltou (aponta defeito do produto). E2E-05a passou a afirmar: a API devolveu ≥ 1 motivo, todos `SCORE_REASON:`, a contagem de `SCORE_REASON` no SVG é **exatamente** a devolvida, sem duplicados. Sem `waitForTimeout`, sem retry, asserção **mais forte** que a anterior |
| B | E2E-09 (fluxo 1): esperado `API ok`, rodapé mostrou `API degraded` | `/api/v1/health` agrega PostgreSQL, Redis e **scraper**; só o scraper degrada. O scraper (`gosom/google-maps-scraper`) **não faz parte do job** e nenhum cenário depende dele (`LEAD_SOURCE_PROVIDER=mock`). `degraded` é o que o produto **deve** reportar nessa pilha | **Expectativa do teste incompatível com a infraestrutura de teste** (scraper ausente de propósito) — não é defeito do produto | O teste consulta o `/health` real e afirma: 200, `database=ok`, `redis=ok`, `status === (scraper==='ok' ? 'ok' : 'degraded')`, e que o rodapé mostra exatamente `API <esse status>`. O passo novo do CI imprime os três componentes separados e **reprova** se banco ou Redis não estiverem `ok`. Não alterei o healthcheck, não aceitei indisponibilidade de banco/Redis, não troquei `degraded` por `ok` e não adicionei scraper falso |
| C | Varredura de sanitização achou marcadores em `resultado.json` do Explorer e da regressão | O JSON bruto do Playwright carrega contexto completo de cada falha (trecho de código com literais, mensagens, stdout, anexos). Sem o log do run, **não consigo afirmar** quais campos exatos continham os marcadores; sei por inspeção do JSON real (Playwright 1.63) que segredos aparecem em `results[].error.snippet`, `results[].errors[].message` e saídas. Além disso o relatório **HTML** embute os dados comprimidos, portanto **não pode ser verificado por varredura de texto** e nunca deveria ser publicado | **Infraestrutura de publicação** (a barreira funcionou; o desenho de publicar o bruto, não) | Bruto agora vai para `$RUNNER_TEMP` (fora do workspace, nunca em artefato). Novo `apps/web/e2e/ci/sanitizar-resultados.mjs` monta a **saída publicável por lista permitida** de campos e imprime no log, por categoria de campo, **quantos** marcadores o bruto tinha (nunca os valores) — o run #77 dirá exatamente onde estavam. A varredura do CI passou a cobrir só o que será publicado (`e2e-publicavel` + logs), com `-a` para tratar binários como texto. A sanitização **continua obrigatória e sem exceção**: se falhar, o job fica vermelho e o upload não roda |

### Saída publicável (Correção C)

Preservado por teste: ID e título do cenário, arquivo, projeto, estado (`expected/unexpected/flaky/skipped`), estado do último resultado, duração, tentativas, **categoria e resumo tratado do erro**, totais, commit, repositório, workflow, run e tentativa; mais as capturas de tela sintéticas das specs e os logs de processo. **Nunca copiado:** stdout/stderr, anexos, passos, configuração, trechos de código, cabeçalhos, cookies, corpos de requisição, relatório HTML, JSON bruto.

Tratamento do erro: remove cores ANSI, corta em “Call log”, descarta linhas de trecho de código, limita a 8 linhas / 900 caracteres, troca senhas do job, `pa_at=`/`pa_rt=`, `Set-Cookie`, `Authorization`, `Bearer` e JWT por marcadores neutros; se ainda restar marcador, o texto é omitido. Depois de escrever, o script **relê** o que gravou: achou marcador → apaga o arquivo e sai com código 1.

### Verificado aqui (não é execução do E2E)

| Verificação | Resultado |
|---|---|
| Tipagem estrita (TS 6.0.3, `noUnusedLocals/Parameters`) das specs, do suporte e da config de CI | 0 erros |
| Sanitizador com JSON sintético contendo as três senhas, `pa_at=`, `Set-Cookie`, `Authorization: Bearer`, JWT e senha no título | diagnóstico contou 9 ocorrências por categoria de campo **sem imprimir valores**; saída publicável sem nenhum marcador (0 ocorrências por `grep`); o resumo do erro preservou `Expected: > 0 / Received: 0` |
| Sanitizador com JSON real do Playwright (sonda local) | 2 testes, 1 aprovado, 1 reprovado; saída ok |
| Caminho de falha (campo não redigido com `Set-Cookie`) | script sai com código 1 e apaga o arquivo; nada fica para publicar |
| Resultado ausente (etapa que não rodou) | registrado como “sem resultado”, sem erro e sem inventar dados |
| `ci.yml` | YAML válido; sem `continue-on-error`; sem `|| true`; upload só roda com `sanitizar` e `sanitizacao` em `success` |

### Arquivos alterados

`apps/web/e2e/explorer-support.ts` · `apps/web/e2e/explorer-02-expansao-e-interface.spec.ts` · `apps/web/e2e/fluxo-1-sessao-e-dashboard.spec.ts` · `apps/web/playwright.ci.config.ts` (só comentário) · `apps/web/e2e/ci/sanitizar-resultados.mjs` (novo) · `.github/workflows/ci.yml` · `.gitignore` · documentação (este relatório, changelog, índice, `qa/E2E-REAL.md`).

### Antes × depois

| | Antes (#76, `84a96c6`) | Depois (QA-04R, a confirmar no #77) |
|---|---|---|
| Explorer | 25 passaram · 1 falhou · 1 não executado | **27/27 passaram** · 0 falhas · 0 instáveis · 0 pulados (#77) |
| Regressão | 28 passaram · 1 falhou | **29/29 passaram** · 0 falhas · 0 instáveis · 0 pulados (#77) |
| Sanitização | reprovada (bloqueou) | **aprovada** (passos “Montar a saída publicável e sanitizada” e “Varredura de sanitização do que será publicado” verdes) |
| Publicação | bloqueada | passo “Publicar evidências sanitizadas” **verde** (só `e2e-publicavel/**` e logs, só com a sanitização aprovada) |

### Matriz E2E (27 + 29)

Resultado do commit `78e9fe2` no Actions #77: **E2E-01…08 = 27/27 PASS; E2E-09 = 29/29 PASS** (ver a matriz “Matriz de cenários e resultados”, agora com `PASS (#77)` em todas as linhas). No #76: E2E-05a falhou (corrigido em A), E2E-05b não executou por dependência serial de E2E-05a e o teste do rodapé do fluxo 1 falhou (corrigido em B). E2E-05 agora prova também que o DOM contém **exatamente** os nós devolvidos pela API.

### Riscos residuais

1. ~~Não há run do commit corrigido.~~ **Resolvido no #77:** E2E-05b executou e passou; não havia falha oculta atrás dele.
2. **Origem exata dos marcadores do #76 continua inferida**, não observada: o diagnóstico por categoria de campo do passo “Montar a saída publicável e sanitizada” do #77 **não foi inspecionado** nesta rodada. O resultado importa menos agora (a saída publicável passou na sanitização), mas a explicação do #76 segue sendo hipótese. Se um marcador estiver em campo **publicado**, o job continua vermelho de propósito.
3. O reporter `list` imprime erros no **log do job** do GitHub (não é artefato). Os testes não contêm senha literal, mas o log do job não passa pelo sanitizador; as senhas do CI são descartáveis e restritas ao job.
4. O scraper segue fora do E2E: o caminho “scraper ok” do rodapé não é exercitado (o teste cobre os dois ramos pela regra, mas só o ramo `degraded` ocorre no CI).
5. As capturas de falha do Playwright (`artefatos/`) não são publicadas; diagnosticar uma falha exige o resumo tratado, o log do job e os logs de processo.

### Commit e run

Commit desta rodada: `78e9fe2588ee1ee0aafe1804c4f62c1b2d58d225` (um commit sobre `84a96c6`). Run: https://github.com/layartdigital/prospectai/actions/runs/41450846331 (#77, verde).

O commit foi publicado pelo proprietário (`84a96c6..78e9fe2`) e disparou o #77.

---

## Fechamento P04-CLOSE-01 (documental, 02/11/2026)

**`F:\drmind` (Bellvia) não foi modificado.** Ordem exclusivamente documental: nenhum código funcional, migration, deploy, merge ou acesso à produção. Detalhes e histórico técnico em `P04-CLOSE-01-RELATORIO.md`.

```
P04_QA_04R_RESULT     = PASS
CI_77                 = PASS
EXPLORER_E2E          = 27/27
PRODUCT_REGRESSION    = 29/29
FAILED                = 0
FLAKY                 = 0
SKIPPED               = 0
ARTIFACT_SANITIZATION = PASS
ARTIFACT_UPLOAD       = VERIFIED
PR_7                  = DRAFT
MERGE_EXECUTED        = NO
PRODUCTION_DEPLOYS    = 0
```

Execução: https://github.com/layartdigital/prospectai/actions/runs/41450846331 (commit `78e9fe2588ee1ee0aafe1804c4f62c1b2d58d225`).

**Como os resultados foram confirmados.** As contagens (27/29 aprovados; 0 falhas, 0 instáveis, 0 pulados) foram lidas na **saída de texto do passo “Resumo dos testes (contagem por estado, do relatório bruto)” do log do job “E2E real (Playwright)”**, e não deduzidas de os passos estarem verdes. A Executora não tem acesso direto ao Actions: o trecho do log foi enviado pelo proprietário em captura. As cinco verificações do PR #7 (Tipos, Builds, Testes e RLS, E2E real, Resultado do CI) aparecem verdes.
