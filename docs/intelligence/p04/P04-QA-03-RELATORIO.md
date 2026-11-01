# P04-QA-03 v1.0.0 — Homologação funcional integrada do Intelligence Explorer

**Módulo:** Intelligence Explorer **0.1.0** · **PR #7** · **Branch:** `feat/prompt-04-intelligence-explorer` · **Commit validado pelo CI:** `a093622738251a2c2432212c84eb7e0ff8d4078a` · **Commit desta rodada:** ver mensagem de entrega e `git log` (um commit sobre `a093622`).
**`F:\drmind` (Bellvia) não foi modificado.** Nenhum deploy, merge, migration, restart ou alteração em produção; a stack `prospectai-prod` e a coleta pendente do GATE-DB-42501 não foram tocadas. IA, Flowsint, novas migrations e SEC-DATA-01 não foram iniciados.

## Veredito

```
P04_QA_03_EXECUTION      = PARTIAL
P04_QA_03_RESULT         = INCONCLUSIVE
CI                       = PASS            (GitHub Actions #74, commit a093622, informado pelo proprietário;
                                            esta sessão não alcança a API do GitHub e não o verificou por conta própria)
REAL_APP_BROWSER_TEST    = NOT_EXECUTED
LEAD_DETAIL_INTEGRATION  = NOT_EXECUTED    (app real) · revisão estática do botão: OK · lado do destino: PASS_BENCH_ONLY
WORKSPACE_SWITCH         = PASS_BENCH_ONLY (27/27; app real NOT_EXECUTED)
CROSS_TENANT_ISOLATION   = PASS_CI (spec HTTP real, informado) + PASS_BENCH_ONLY (serviço real, PG com RLS)
RESPONSIVENESS           = PASS_BENCH_ONLY (390 / 820 / 1600 px; app real NOT_EXECUTED)
PRODUCT_REGRESSION       = PASS_CI (suíte completa, informado) · regressão em navegador no app real: NOT_EXECUTED
PRODUCTION_DEPLOYS       = 0
PRODUCTION_DB_MUTATIONS  = 0
MERGE_EXECUTED           = NO
```

**Por que INCONCLUSIVE, e não PASS_WITH_LIMITATIONS.** A ordem exige teste em navegador sobre a aplicação integrada (Next.js + NestJS + Prisma real + PostgreSQL descartável) e proíbe usar a bancada como prova dela. Nesta sessão isso **não pôde ser montado**, por três bloqueios medidos (nada foi contornado):

| Recurso necessário | Situação medida hoje |
|---|---|
| Instalar dependências (`pnpm install`) | registro npm inacessível a partir daqui |
| Subir PostgreSQL descartável por Docker | o cliente Docker existe, mas não há daemon (`/var/run/docker.sock` ausente) |
| Executar no seu PC (ambiente Linux isolado do app desktop) | recusado: pouco espaço livre em disco (a ferramenta pede até 17 GB) |
| Verificar o PR #7 / Actions #74 por API | GitHub fora do conjunto autorizado da sessão (`HTTP 403`) |

Não encontrei **nenhuma falha** nos testes que consegui executar; a lacuna é de **cobertura no app real**, não de defeito conhecido. Os rótulos abaixo separam o que foi provado de verdade.

## Evidências por exigência

Legenda: `PASS_CI` = executado pelo CI do GitHub (informado, não verificado aqui) · `PASS_BENCH_ONLY` = bancada local (PostgreSQL 16 com RLS, serviço real do Explorer, Prisma **simulado**, componentes reais da interface em Chromium; **não é o app completo**) · `NOT_EXECUTED`.

### Interface e navegação

| Exigência | Estado | Evidência |
|---|---|---|
| Acessar `/intelligence` autenticado | `NOT_EXECUTED` (app real) · `PASS_CI` para a compilação (`next build`) · `PASS_BENCH_ONLY` para a tela | `ui-run.out` 28/28 |
| Abrir pela ficha do lead / botão “Explorar relações” | `NOT_EXECUTED` no app real. Revisão estática: `app/(app)/leads/[id]/page.tsx` renderiza `<Link href="/intelligence?lead=<id>">Explorar relações</Link>`; o Explorer lê o parâmetro `lead` (`useSearchParams`) e carrega o grafo; o destino foi exercitado com `?lead=` na bancada | código; `ui-run.out` |
| Carregar o grafo com dados controlados | `PASS_BENCH_ONLY` | `ui-run.out`, `service-isolation.out` (37/37) |
| Expandir relações; filtros; zoom; painel | `PASS_BENCH_ONLY` | `ui-run.out` (28/28: expansão, tipos, zoom/pan/teclado, painel) |
| Estados vazios e mensagens de erro | `PASS_BENCH_ONLY` | `ui-run.out` (vazio, lead inexistente, erro claro) |
| Desktop / tablet / mobile | `PASS_BENCH_ONLY` | 1600, 820 e 390 px sem rolagem horizontal; capturas `10-mobile-390.png`, `11-tablet-820.png` (**bancada**) |

### Segurança multi-tenant

| Exigência | Estado | Evidência |
|---|---|---|
| Alternar workspace com o Explorer aberto; limpar grafo, detalhes e buscas | `PASS_BENCH_ONLY` | W1 (`ui-workspace.out`): zero rastro do Alfa em texto e DOM (nomes, ids, nós, painel) durante e depois da troca |
| Descartar respostas assíncronas antigas | `PASS_BENCH_ONLY` | W2/W3 (expansão e grafo pendentes) + C1–C7 de concorrência (16/16) |
| Logout e mudança de usuário | `PASS_BENCH_ONLY` | W4, W5, W7, W9–W11, W13 |
| Beta não acessa dados do Alfa | `PASS_CI` (`intelligence-tenant.spec.ts`, HTTP real, papel `propectai_app`) + `PASS_BENCH_ONLY` | `ui-run.out` (“Beta abrindo lead do Alfa recebe o mesmo erro, sem nenhum dado do Alfa”) |
| **Não depender só do polling de 20 s após mudança de contexto conhecida pela aplicação** | **Corrigido nesta rodada** · `PASS_BENCH_ONLY` | seção abaixo; W9–W13 |

## Defeito encontrado e corrigido nesta rodada

**Achado (requisito explícito da ordem).** Na QA-02, o descarte do estado dependia de a aba perceber a mudança — foco, `pageshow`, 401/403 ou a checagem a cada 20 s. Mas várias mudanças de contexto são **conhecidas pela própria aplicação no instante em que acontecem**: o clique em “Sair”, o login, o cadastro e o aceite de convite. Numa **segunda aba** com o Explorer aberto, os dados da conta anterior ficavam visíveis até a próxima checagem. Origem: decisão de projeto da QA-02 do Prompt 04 (não é defeito pré-existente do produto).

**Correção (só na branch).** Novo canal `lib/session-events.ts` (`BroadcastChannel` com `storage` como reserva, mesma origem e mesmo navegador): `LogoutButton`, `LoginForm`, `RegisterForm` e `AcceptInviteForm` anunciam a mudança **somente depois de a API confirmar**. O vigia do Explorer reage na hora: `logout` descarta tudo **sem esperar rede**; `login`/`troca` consultam `/auth/me` imediatamente e descartam se a identidade difere. O aviso é só um gatilho — não carrega identidade nem dado; mensagens inválidas ou sem mudança real não apagam nada. A checagem de 20 s continua, apenas como rede de segurança para mudanças que a aplicação não viu (cookie trocado por fora, sessão expirada).

| Cenário (bancada, Chromium, **sem** evento de foco e **sem** esperar os 20 s) | Resultado |
|---|---|
| W9 logout em outra aba | Explorer descarta e sai para o login em **72 ms** |
| W10 login de outra conta (Beta) em outra aba | descarta em **165 ms** |
| W11 logout na própria aba, com `/auth/me` lento (4 s) | descarte em **25 ms** — não depende da rede |
| W12 anúncio com a mesma identidade + mensagens malformadas | **nada** é descartado |
| W13a/b/c **componentes reais** `LoginForm`/`LogoutButton` | login recusado não anuncia; login aceito e logout anunciam; Explorer descarta em ~100 ms |

Controle negativo: com o ouvinte desativado o teste reprova (a aba não limpa dentro de 5 s). Regressão repetida: `ui-workspace` **27/27**, `ui-concorrencia` **16/16**, `ui-run` **28/28**.

**Limites.** Cobre abas do mesmo navegador (o caso em que cookies são compartilhados). Mudança de sessão feita por **outro navegador ou dispositivo** não troca os cookies deste navegador e, portanto, não é “troca de contexto” para esta aba; a sessão só passa a valer na próxima requisição, e o servidor (RLS/HMAC) protege os dados.

## Regressão do produto

| Área | Estado | Observação |
|---|---|---|
| Login, dashboard, lista de leads, ficha, pesquisa, scores, pipeline, planos e permissões | `PASS_CI` na medida da suíte completa e do portão de RLS (informado: Actions #74, sobre `a093622`) | não há teste de navegador no app real para nenhuma delas: `NOT_EXECUTED` |
| Arquivos de outros módulos alterados **nesta** rodada | `login-form.tsx`, `register-form.tsx`, `accept-invite-form.tsx`, `logout-button.tsx` | cada um ganhou **uma chamada** `anunciarMudancaDeSessao(...)` após a confirmação da API; `LoginForm` e `LogoutButton` foram exercitados em Chromium (W13). **Requer novo CI** |

## O que o proprietário precisa fazer (um passo, sem merge)

O commit desta rodada **não está no PR #7** (esta sessão não consegue publicar). Para o CI reavaliar:

```powershell
git fetch "C:\ResgateProjetos\prospectai\Claude outputs\PROSPECTAI-P04-QA03-EXPLORER.bundle" feat/prompt-04-intelligence-explorer:qa03-entrada
git switch feat/prompt-04-intelligence-explorer
git merge --ff-only qa03-entrada
git push origin feat/prompt-04-intelligence-explorer
```

O CI do PR #7 dispara de novo. **Enquanto ele não ficar verde sobre o novo commit, `CI = PASS` vale só para `a093622`.** Não fazer merge.

## Como obter `PASS_REAL_APP` (o que falta)

Qualquer um destes caminhos libera a evidência real; a Executora precisa de um deles:

1. **Liberar espaço no PC** (a ferramenta pede até 17 GB) para a Executora montar o ambiente isolado por ali; ou
2. **Rota B** (`qa/COMO-RODAR.md`, `validar-p04-qa.ps1` v1.1.0: pré-voo, rótulo de propriedade, só recursos próprios, portas 5439/6389; ainda não executado) e devolver `qa-logs\<execução>\99-resumo.txt`; ou
3. **Roteiro manual** com a stack de desenvolvimento (`pnpm dev` + Docker de desenvolvimento) e capturas: (a) login e dashboard; (b) lista de leads → ficha de um lead → botão “Explorar relações” abre `/intelligence?lead=…` com o grafo; (c) expandir notas, ocultar um tipo, zoom, selecionar um nó; (d) com o Explorer aberto, **numa segunda aba** sair e entrar com outro usuário/workspace e voltar à primeira aba: a tela deve estar vazia e sem dados do anterior; (e) larguras 1440, 820 e 390 px; (f) pesquisa, pipeline e página de planos abrindo normalmente.

## Riscos residuais

1. **App real não exercitado em navegador** — o principal. A bancada usa Prisma simulado, emula `layout.tsx`/`page.tsx` do Next e usa cookies simplificados (`as=`/`usr=`) no lugar de JWT.
2. O novo commit ainda não passou pelo CI (typecheck estrito, lint e build reais sobre os arquivos novos/alterados).
3. Verificação do CI #74 é por informação do proprietário, não por consulta direta.
4. Seis FKs simples entre workspaces (SEC-DATA-01, fora desta rodada).

## Próximo passo recomendado

1. Publicar o commit desta rodada no PR #7 (acima) e confirmar o CI verde. 2. Obter `PASS_REAL_APP` por um dos três caminhos. 3. Se ambos passarem, reavaliar para `PASS_WITH_LIMITATIONS` e **então** decidir, em ordem separada, a publicação controlada: merge do PR #7 por você, deploy somente com checklist e janela próprios, flag de módulo se desejar, sem tocar no GATE-DB-42501 T1. Nada disso foi feito.
