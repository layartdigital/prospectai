# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

---

## [Não lançado]

### Gestão de equipe · 06/08/2026

Migration `20260811204408_convites_de_equipe`. Item 2 da sequência de `docs/strategic/lacunas-estruturais.md`.

**Fecha uma promessa comercial que o produto não cumpria.** PRO e AGENCY vendiam 5 e 25 usuários e entregavam 1 — não havia convite, endpoint nem tela. O `register` criava tenant e dono, e acabava ali. Junto disso, os cinco papéis do RBAC estavam implementados, guardados por `MinRole` e **inalcançáveis**: com um usuário por tenant, nenhum era exercitado.

#### Adicionado

- Modelo `Invitation`, com token guardado em hash — mesma política do `RefreshToken`
- `GET /api/v1/team` — membros, convites pendentes e assentos
- `POST /api/v1/team/invitations` — convida e devolve o link de aceite
- `DELETE /api/v1/team/invitations/:id` — revoga
- `PATCH /api/v1/team/members/:id/role` e `DELETE /api/v1/team/members/:id`
- `GET /api/v1/invitations/:token` e `POST /api/v1/invitations/accept` — públicas
- Configurações → **Gerenciar equipe**, e `/invite/[token]` para o aceite
- `SessionCookieService`, extraído do `AuthController`: o aceite também abre sessão, e política de cookie duplicada em dois lugares é política que diverge

#### Regras que o produto passa a garantir

| Regra | Por que existe |
|---|---|
| Ninguém concede papel acima do próprio | Sem ela, um ADMIN cria um OWNER e escala privilégio em duas requisições |
| Ninguém altera quem está acima de si | A mesma escalada, pelo avesso |
| O último dono não é removido nem rebaixado | Workspace sem dono não tem quem convide, remova ou mude plano. Estado terminal, sem caminho de volta pela interface |
| Convite pendente ocupa assento | Sem isso, mil convites furam o limite do plano sem ninguém ter entrado |
| Remover membro revoga os refresh tokens | Sem isso, quem saiu continua trabalhando até o access token expirar |
| Vínculo é soft delete | Contatos e notas apontam para o autor; apagar deixaria histórico órfão |
| Aceite em conta existente exige a senha atual | Impede que alguém de posse do link anexe um workspace à conta alheia |

Onze testes cobrem essas regras, incluindo o caminho completo de escalada: convida um ADMIN de verdade, aceita o convite, pega a sessão dele e tenta a promoção a OWNER.

#### Decisão: sem envio de e-mail

Não há provedor de e-mail no produto, e **fingir que um e-mail saiu seria pior que admitir que ele não existe**. O link de aceite é devolvido uma única vez, na criação, para quem convidou copiar e enviar pelo canal que preferir. A tela diz isso — sem o aviso, alguém fecharia a janela e perderia o convite sem entender por quê.

Como o token vive em hash, não há como reconstruir o link depois. Na listagem, `acceptUrl` vem `null`.

---

### Alcance internacional — schema · 06/08/2026

Migration `20260811201507_alcance_internacional`.

Primeiro item da sequência de `docs/strategic/lacunas-estruturais.md`, e o único cujo custo crescia todo dia: sem `country`, não haveria como descobrir retroativamente de que país era cada lead.

#### Adicionado

| Modelo | Campo | Papel |
|---|---|---|
| `Lead` | `country` | ISO 3166-1 alpha-2, default `BR` |
| `ProspectingSearch` | `country` | Desambigua a busca — existe São Paulo no Brasil e San Paolo na Itália |
| `Tenant` | `country` | País da empresa cliente |
| `Tenant` | `currency` | ISO 4217, default `BRL`. Abre caminho para preço por região |
| `Tenant` | `taxId` | VAT, CNPJ ou equivalente. Habilita *reverse charge* na venda B2B |
| `Tenant` | `customerType` | `PF` \| `PJ`. Tira a decisão comercial do caminho crítico técnico |

O default `BR` não mente: todo lead coletado até esta data veio do Brasil.

#### Corrigido

**Lead estrangeiro perdia dado em silêncio**

`toStateUf` devolvia `null` para qualquer região fora da tabela de UF brasileira, e `toE164BR` para qualquer telefone não brasileiro. Uma busca em Milão produziria leads sem região, sem telefone normalizado e sem sinal de WhatsApp — **sem erro, sem log, sem ninguém perceber.** É a pior forma de falhar num produto de dados.

- `toRegion(valor, country)` — no Brasil converte para sigla; fora dele guarda o nome como veio. Dado imperfeito com procedência é utilizável; ausência não é
- `toE164(telefone, country)` — **não adivinha código de país.** Fora do Brasil, aceita apenas número que já vem com `+`. Inferir prefixo a partir de número local produz telefone plausível e errado, e telefone errado é pior que ausente: alguém liga
- `whatsappStatusFromPhone` — devolve `UNKNOWN` fora do Brasil, sempre. Cada país tem sua regra de numeração móvel, e chutar violaria a regra 5.2 do escopo

Sete testes novos cobrem o caminho internacional, incluindo dois que afirmam **ausência de invenção**: número local italiano não vira E.164, e prefixo móvel italiano legítimo ainda assim devolve `UNKNOWN`.

#### Adiado de propósito

**O rename de `addressStateUf` para `addressRegion` não foi feito.** São 106 ocorrências em 30 arquivos, e renomear nunca fica ambíguo — custa o mesmo daqui a um ano. `country` não tinha essa propriedade, e por isso entrou sozinho. Misturar os dois numa migration só tornaria impossível saber qual quebrou o quê. O motivo está registrado no comentário do campo, para não parecer esquecimento.

Quando houver mercado internacional de verdade, `libphonenumber` substitui a heurística de telefone.

---

### Exportação CSV · 06/08/2026

#### Adicionado

- `GET /api/v1/leads/export` — CSV da listagem **com os filtros ativos**, não da base inteira. Paginação ignorada de propósito: exportar só a página visível seria surpresa desagradável. Teto de 5.000 linhas como trava, não como limite de plano — o maior plano inclui 3.000 leads
- `export-leads-button.tsx` em Meus Leads. **O botão aparece em todos os planos** e o bloqueio acontece na tentativa. Esconder de quem não tem direito impede a pessoa de descobrir que o recurso existe, e o upgrade nunca é considerado
- Capacidade `export.csv` do `EntitlementsService`, que existia desde a v0.1.1 sem nenhum consumidor, finalmente ligada
- Registro em `AuditLog` e contagem em `PlanUsage.exportsCount`

**Separador `;` e BOM UTF-8.** O Excel em português assume ponto e vírgula e, sem o BOM, quebra os acentos. São dois detalhes que decidem se o arquivo é útil ou se a pessoa desiste na primeira tentativa — e o público deste produto abre planilha no Excel, não no pandas.

#### Corrigido

**`Content-Disposition` não chegava ao navegador**

O nome do arquivo definido pelo servidor era ignorado, e todo download saía como `leads.csv`, sem data. `Content-Disposition` não é cabeçalho *safelisted*: em requisição cross-origin, o JavaScript não o lê sem `Access-Control-Expose-Headers`. Com web em 3100 e API em 3101, isso valia para o usuário real, não só para o teste.

Resolvido com `exposedHeaders` no `enableCors`. Em produção, com API e web no mesmo domínio, o defeito nem existiria — apareceu porque o ambiente de desenvolvimento separa as portas.

#### Nota de método

A lacuna foi encontrada ao escrever o teste do critério 19, e o primeiro teste que escrevi para ela **verificava a exportação "se o botão existir"**. Passou verde num produto que não exportava nada.

Teste condicional que passa na ausência da funcionalidade é pior que teste ausente: aparece como cobertura no relatório. Foi removido, a funcionalidade construída, e o teste voltou sem `if`.

---

### Migração de volume por falha de hardware · 06/08/2026

#### Contexto

Durante a sessão de 31/07 a escrita em disco começou a falhar de forma intermitente: `EPERM` no `prisma generate`, escritas recusadas em pastas distintas, e o Node reportando `UNKNOWN: unknown error, read` ao carregar arquivos de `node_modules` que lera minutos antes.

As três primeiras hipóteses estavam erradas — disco cheio, conexão da sessão, arquivo travado. O Visualizador de Eventos do Windows deu o diagnóstico real, com carimbo do dia:

| Evento | Conteúdo |
|---|---|
| **154** | Falha de I/O em bloco lógico do Disco 2 **por erro de hardware** |
| **51** | Erro durante operação de paginação, dezenas de ocorrências |
| **50** | *"O Windows não pôde salvar todos os dados para o arquivo F:\prospectai. **Os dados foram perdidos.**"* |
| **55** | **Corrupção detectada em estrutura de índice NTFS do volume F:** |

O Disco 2 é um `Samsung M3 Portable` — HD externo USB — que hospedava o PropectAI e o Bellvia. O `robocopy` confirmou com `ERROR_DEVICE_HARDWARE_ERROR` (483), e em certo momento o dispositivo respondeu "inexistente" (433). O `HealthStatus: Healthy` do Windows era ruído: ponte USB raramente repassa SMART.

Trocar cabo e porta USB estabilizou o volume — o que aponta para a ponte, o cabo ou a alimentação do gabinete, não necessariamente para as plataformas.

#### Alterado

- **Raiz do projeto: `F:\prospectai` → `C:\ResgateProjetos\prospectai`.** Independente de o disco sobreviver, HD externo USB hospedando bind mount de Docker e `node_modules` com centenas de milhares de arquivos é o lugar errado para desenvolver
- **`.npmrc`** — removido `store-dir=F:\.pnpm-store`. A diretiva estava correta enquanto a raiz vivia no F: (store no mesmo volume permite hardlink); depois da migração passou a apontar para outro volume, e um defeituoso
- `CLAUDE.md`, `README.md` e `scope-v0.1.1.md` atualizados com a raiz nova

Documentos anteriores a 06/08 que citam `F:\prospectai` **ficam como estão**. São registro histórico do que se sabia à época; reescrevê-los falsificaria o rastro.

#### Preservado

- **Primeiro commit do repositório**, com 192 arquivos e 35.915 linhas, e push para o remoto. Até 06/08/2026 o projeto inteiro existia em cópia única, sem histórico — sobreviveu ao incidente por sorte, não por processo. Era a maior fragilidade do projeto e não tinha relação com o disco
- **Bellvia** (`F:\drmind`) copiado para `C:\backup-drmind`: 5.146 arquivos, zero falhas
- **Volumes Docker intactos.** `propectai-postgres-data` e `propectai-redis-data` são gerenciados pelo Docker e nunca estiveram no F: — o seed, as contas de demonstração e o histórico de buscas sobreviveram sem intervenção

#### Validação

Executado em 06/08/2026, após a migração:

| Verificação | Resultado |
|---|---|
| `docker volume ls` | `propectai-postgres-data` e `propectai-redis-data` presentes — banco, seed e contas intactos |
| `docker compose up -d` | Três containers no ar; `gmaps-scraper` como `Up` puro, sem o `unhealthy` do healthcheck inválido |
| `@propectai/types` | 35 testes |
| `@propectai/worker` | 5 testes — regras comerciais 5.3, 5.4 e 5.5 |
| `@propectai/api` | 26 testes — isolamento de tenant em banco e HTTP, invariantes, provider de IA |
| **Total** | **66 testes, zero falhas** |

**Nenhum arquivo veio corrompido.** A verificação estrutural feita antes da instalação já indicava isso, mas compilar e exercitar o banco é o que prova.

`F:\drmind` não foi modificado. Os containers do Bellvia seguiram no ar, saudáveis, durante toda a migração.

#### Corrigido

**Seletor de KPI acoplado a classe de estilo**

O E2E localizava o card por `div.pa-card` e o número por `p.text-kpi`, e as duas asserções quebraram com `element(s) not found` depois da reinstalação.

Classe de Tailwind é contrato acidental: o `KpiCard` monta `className` via `cn()`, que passa por `tailwind-merge` — e `text-kpi` (tamanho customizado) pode ser descartado por conflito de grupo com `text-navy-900` (cor customizada). O seletor deixa de existir sem ninguém tocar no componente, e a mensagem de erro fala de elemento ausente, não de estilo.

`KpiCard` ganhou `data-testid="kpi-card"`, `data-kpi-label={label}` e `data-testid="kpi-value"`. O `data-kpi-label` resolve de quebra a armadilha do rótulo, que aparece em maiúsculas por CSS mas vive em minúsculas no DOM.

**A verificar visualmente:** se `text-kpi` estiver mesmo sendo descartado, os números do dashboard renderizam menores que o design pede. É defeito visual que o E2E encontrou de lado, procurando outra coisa.

#### Pendente

- `chkdsk F: /scan` (somente leitura) para dimensionar a corrupção de índice registrada no evento 55. **Não rodar `/f` nem `/r`** antes de backup íntegro: em dispositivo instável, reescrever metadados transforma perda parcial em total
- Confirmar no navegador se `text-kpi` sobrevive ao `tailwind-merge`
- Os 10 critérios que continuam em `G` na conferência


### Ficha do lead, regras comerciais e Swagger · 31/07/2026

#### Adicionado

**Camada de escrita da ficha do lead**

- `PATCH /api/v1/leads/:id/follow-ups/:followUpId` — **endpoint que faltava**. Havia como criar follow-up, não como concluir, cancelar ou reagendar; `FOLLOWUP_COMPLETED` existia no enum de atividades sem nunca ser gravado. Um endpoint para as três operações, porque mudam os mesmos campos e competem entre si — separadas, exigiriam ordem definida entre chamadas
- `lead-contact-form.tsx` — registro de contato com canal, direção e resultado
- `lead-follow-ups.tsx` — agendar, concluir, cancelar e reagendar, com ação por item
- `recalculate-score-button.tsx` — recalcular o score de um lead sem reprocessar a base

**Reagendar reabre.** Data nova sem status devolve o follow-up a `PENDING` (ou `OVERDUE`, se já passou) e limpa as marcas de conclusão e cancelamento. Sem isso, remarcar um cancelado deixaria item com data futura e status `CANCELLED` — visível na lista, ausente dos avisos, e ninguém entenderia o motivo.

**Testes das regras comerciais 5.3, 5.4 e 5.5**

- `apps/worker/test/scrape-pipeline.spec.ts` — prova de **comportamento**, com Vitest novo no worker. Roda o pipeline real com `MockLeadSourceProvider` contra o banco: primeira busca liquida a reserva e cobra só os leads novos; a segunda devolve zero novos e não cobra; job falho devolve a reserva por inteiro, sem consumir **nem gerar** crédito; todo lead criado tem score com motivos; e o payload em `LeadSourceRecord` não contém `user_reviews` nem `owner`

  Achado do teste: o mock gera `place_id` novo a cada job, então a deduplicação da segunda busca acontece **pelo fingerprint**. É o caminho mais importante dos dois — o que protege quando a fonte não devolve identificador estável — e ficou coberto justamente porque o mock não colabora.

- `apps/api/test/business-invariants.spec.ts` — prova de **estado**. Varre o banco inteiro sem depender de quem gravou a linha: score sem motivo, lead sem score, valor fora de 0–100, saldo de cota negativo, reserva pendurada com fila parada, liquidação acima da contagem real de leads. A limitação está declarada no arquivo: invariante passa trivialmente em banco vazio, então é rede permanente, não prova de que o pipeline funciona

**Swagger organizado** — dez `addTag` em `main.ts`, um por módulo, ordenados pelo percurso do produto em vez da ordem de registro dos controllers. Antes, só `system` estava declarado e o resto caía em `default`.

Verificado em 31/07/2026: `pnpm typecheck` verde nos 5 pacotes, `next lint` sem avisos, 66 testes em 7 arquivos passando.

---

### Isolamento na camada HTTP · 31/07/2026

#### Adicionado

- `apps/api/test/tenant-isolation-http.spec.ts` — 6 asserções sobre o `TenantGuard` em requisição real, atravessando guard, controller e service. Sobe o `AppModule` em porta efêmera com a mesma configuração do `main.ts` e usa `fetch` nativo com cookies montados à mão; nenhuma dependência nova

  Complementa `tenant-isolation.spec.ts`, que prova o isolamento no banco. A lacuna entre os dois era real: índice composto correto com query sem `where` de tenant continua vazando, e guard correto com índice ausente também.

  Cobre: conta nova vê `total: 0`; o dono vê o próprio lead; **conhecer o id devolve 404, não 403** — confirmar existência já seria informação; KPIs e funil do dashboard em zero, porque agregação é onde o escopo de tenant mais some; 401 sem sessão; e `x-tenant-id` de outro workspace recusado mesmo com cookie válido.

  Automatiza a verificação visual que estava prevista como passo manual.

#### Corrigido

**A API não liberava a conexão Redis no encerramento**

`ProspectingService` criava a conexão `ioredis` e a fila BullMQ no construtor, sem `OnModuleDestroy`. E o BullMQ não é dono de conexão recebida pronta: `queue.close()` sozinho não bastaria.

Em teste isso aparecia como `Jest did not exit one second after the test run`. **Em produção é `SIGTERM` ignorado** — o container só encerra no kill forçado do orquestrador, com job em voo perdido no meio.

Descoberto pelo teste HTTP acima: foi a primeira vez que o ciclo de vida da aplicação inteira foi exercitado. A suíte anterior falava direto com o Prisma e nunca subiu o `AppModule`.

Verificado em 31/07/2026: 3 suítes, 20 testes, Jest encerrando sozinho.

---

### Cadastro e onboarding · 31/07/2026

#### Adicionado

- `/register` — tela de cadastro. A rota já constava em `PUBLIC_ROUTES` no middleware desde a Fase 2, **sem página**: visitante não autenticado recebia 404 em vez do formulário. Espelha o `RegisterDto` (senha mínima de 10 caracteres com contador), trata 409 com mensagem específica — quem já tem conta precisa saber que o caminho é entrar — e leva ao onboarding, não ao dashboard
- `/onboarding` — wizard de 5 etapas (serviços, nichos, regiões, canal, meta). Persiste a cada avanço, não só no fim: quem fecha a aba na etapa 3 volta na etapa 3. Todas as etapas são opcionais, e as duas que alimentam o score declaram o efeito na tela (nicho +15, região +5) em vez de exigir preenchimento. Termina em `/search`
- `POST /api/v1/settings/onboarding/complete` — idempotente, preserva a data da primeira conclusão
- `POST /api/v1/settings/onboarding/restart` — exige MANAGER. Limpa apenas a data de conclusão
- Botão Refazer/Continuar onboarding em Configurações
- Links cruzados entre `/login` e `/register`

#### Corrigido

**O onboarding não podia ser concluído**

`completedAt` só era escrito no ramo `create` do upsert em `AccountService.updatePreferences`. Como `preferences()` já cria a linha vazia no primeiro GET, todo PATCH caía no ramo `update`, onde o campo nunca era tocado — a conclusão era inalcançável por qualquer caminho.

A conclusão virou transição explícita, e não efeito colateral de salvar preferência: ajustar nichos em Configurações não significa "terminei de me apresentar ao produto".

Reiniciar **não apaga preferências**. Quem refaz quer rever as perguntas, não perder as respostas — e zerar as listas derrubaria dois pesos do score por um clique que a pessoa entende como "quero olhar de novo".

Verificado em 31/07/2026: `pnpm typecheck` verde nos 5 pacotes, `next lint` sem avisos. **Percurso no navegador ainda pendente** — o critério 6 segue em G na conferência.

---

### Correções · 31/07/2026

#### Corrigido

**Healthcheck do motor de coleta**

O container `propectai-gmaps-scraper` ficava permanentemente `unhealthy` com o serviço perfeitamente no ar. O teste `wget -q --spider http://127.0.0.1:8080/api/v1/health` estava errado por dois motivos independentes:

1. A imagem é um binário Go em base mínima — não há shell nem `wget`, então `CMD-SHELL` falhava na largada.
2. `/api/v1/health` não existe no scraper. O servidor tem rota catch-all que devolve a UI HTML com 200 para qualquer caminho desconhecido. **Se o `wget` existisse, o teste teria passado sem nunca verificar nada** — falso positivo é pior que o falso negativo que estávamos vendo.

Correções aplicadas:

- `docker-compose.yml` — healthcheck removido do serviço `gmaps-scraper`, com os dois motivos registrados no arquivo para impedir que alguém "conserte" o `wget` e reintroduza um teste que aprova sem verificar. O worker já dependia com `condition: service_started`, então nada na subida foi afetado
- `apps/worker/src/providers/google-maps.provider.ts` — guarda de `content-type` em `request<T>`: resposta 200 sem JSON agora falha nomeando a causa, em vez do `Unexpected token '<' is not valid JSON`, que é sintoma e não causa. Adicionado `probe()`, que exige JSON em `/api/v1/jobs` e não lança
- `apps/api/src/system/scraper-health.service.ts` — novo. Verificação de alcance real do scraper com timeout de 2s, porque o rodapé consome `/health` a cada render. Duplica ~30 linhas do `probe()` do worker de propósito: a API não depende do worker como workspace, e criar essa dependência só para um healthcheck acoplaria dois processos hoje independentes
- `packages/types/src/system.ts` — `HealthResponse.checks` ganhou `scraper`
- `apps/api/src/system/system.controller.ts` — `/api/v1/health` passa a reportar o scraper. **Scraper fora leva o status a `degraded`, nunca a `down`:** sem ele o usuário ainda lê leads, move pipeline e registra contato — só não dispara coleta nova. `down` continua reservado à perda de PostgreSQL e Redis

Verificado em 31/07/2026: `pnpm typecheck` verde nos 5 pacotes; `docker ps` sem `unhealthy`; `GET /api/v1/health` devolvendo `{"status":"ok","checks":{"database":"ok","redis":"ok","scraper":"ok"}}`.

`F:\drmind` não foi modificado. Nenhum recurso Docker do Bellvia foi parado, removido ou reconfigurado.

---

### Fase 1 — Fundação · 27/07/2026

#### Adicionado

**Monorepo**
- pnpm workspaces + Turborepo com scripts de raiz
- `packages/config` — tsconfig base, node e Next.js
- `packages/types` — contratos compartilhados entre api, web e worker
- `.npmrc` com store em `F:\.pnpm-store`, no mesmo volume do projeto

**Infraestrutura**
- `docker-compose.yml` com `propectai-postgres` (5434), `propectai-redis` (6381) e `propectai-gmaps-scraper` (8081)
- Healthchecks nos três serviços e dependências por condição de saúde
- Rede `propectai-network` e volumes com prefixo `propectai-`
- Serviços de aplicação sob o profile `full`, para produção
- `.env.example` documentado

**Banco de dados**
- `prisma/schema.prisma` completo: 30 modelos e 20 enums
- `tenantId` em toda entidade de negócio desde a primeira migration
- Índices únicos compostos `(tenantId, fingerprint)` e `(tenantId, placeId)`
- Tabelas sem interface na v0.1.1 já modeladas: `Proposal`, `Contract`, `Tag`, `ExportJob`

**API**
- NestJS com prefixo global `/api/v1` e Swagger em `/api/docs`
- `GET /api/v1/health` — verifica PostgreSQL e Redis
- `GET /api/v1/system/version`
- Helmet, CORS restrito, cookie-parser
- `ValidationPipe` global com `whitelist` e `forbidNonWhitelisted` contra mass assignment

**Front-end**
- Next.js App Router com fonte Inter
- Design system em tokens CSS e tema Tailwind
- App Shell: sidebar de 176px, topbar de 60px, rodapé com versão e status da API
- Dashboard esqueleto com KPIs em estado vazio
- Placeholders honestos em `/search`, `/leads`, `/pipeline` e `/history`, indicando a fase de entrega

**Worker**
- Esqueleto BullMQ conectado ao Redis
- Logger Pino com redação de segredos e dados pessoais

**Documentação**
- `README.md` com fluxo de instalação em dez passos
- `CLAUDE.md` com as regras permanentes do projeto
- `docs/technical/environment-audit.md` — auditoria da Fase 0
- `docs/strategic/scope-v0.1.1.md` — escopo aprovado
- `docs/technical/data-model.md` e `docs/technical/scoring.md`
- `infra/scripts/audit-ambiente.ps1`

#### Corrigido durante a validação

- **API escutava só em IPv4.** `app.listen(port, '0.0.0.0')` liga o socket apenas em IPv4, mas o `fetch` do Node 18+ resolve `localhost` preferindo `::1` no Windows. O rodapé reportava "API inacessível" com a API no ar. Removido o host explícito (dual-stack) e adicionado `API_INTERNAL_URL` com IPv4 explícito para os Server Components.
- **`deleteOutDir` do Nest CLI em watch mode.** A limpeza da pasta `dist` corria em paralelo com o `tsc` e às vezes chegava depois da emissão: compilava com "0 errors" e o node falhava com `Cannot find module dist/main`. Desligado. Compilação incremental também desligada na API, porque o `.tsbuildinfo` vive dentro de `dist` e uma remoção externa faz o `tsc` concluir que está tudo atualizado.
- **Scripts de postinstall bloqueados pelo pnpm 10.** Prisma, esbuild, sharp, msgpackr-extract e unrs-resolver declarados em `onlyBuiltDependencies`. Sem isso os engines do Prisma não são baixados e o `db:generate` falha.
- **Bind mount do scraper falhava no Docker Desktop.** `mkdir /run/desktop/mnt/host/f: file exists` — mount stale do backend WSL2, resolvido com `wsl --shutdown` e reinício do Docker Desktop.

#### Decisões registradas

- **Site precário vale +22 no score.** Domínio de construtor gratuito é oportunidade comercial, não "já tem site". Regra ausente do documento mestre.
- **Ausência de sinal é `DESCONHECIDO`.** Instagram, Facebook e WhatsApp não vêm do scraper; marcá-los como ausentes seria falso negativo em massa.
- **Lead duplicado não consome cota.** Reserva no início do job, liquidação no fim com o número real de leads novos. Job falho devolve a reserva.
- **`data/gmapsdata` em vez de `data/gmaps`.** A pasta já contém histórico real de coleta.
- **Disco do Docker permanece em C:.** A Fase 1 consome cerca de 300 MB; mover arrastaria os volumes do Bellvia junto.
- **Propostas, Contratos, Precificador e Avisos ficam fora da sidebar.** Modelados no schema, sem rota. Menu que só abre paywall é o defeito que este produto existe para evitar.

#### Isolamento

`F:\drmind` não foi modificado. Nenhum container, rede, volume, porta ou arquivo do Bellvia foi tocado.

---

## [0.1.0] — Fase 0 · 27/07/2026

### Adicionado
- Auditoria de ambiente com inventário do motor de coleta
- Confirmação do plano de portas sem colisão com o Bellvia
- Escopo recortado da v0.1.1: seis telas de núcleo, profundas
