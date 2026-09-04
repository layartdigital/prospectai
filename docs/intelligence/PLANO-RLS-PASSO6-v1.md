# Passo 6 — espalhar o RLS para as demais tabelas

**Versão 1 · 27/08/2026 · continua o `PLANO-RLS-v1.md`, cujos passos 1 a 5 estão entregues**

O canário provou o mecanismo: `FORCE`, política `RESTRICTIVE`, `comTenant`, e S8/S9 verdes contra o banco. **O que falta não é descobrir se funciona — é descobrir onde não cabe.**

Este documento levanta o inventário, aponta os dois lugares onde o mecanismo colide com o produto, e propõe uma ordem.

---

## Correção de 27/08 (2): o inventário de chamadores foi medido numa cópia velha

**A contagem de usos por modelo da primeira versão deste documento estava errada**, e vale dizer por quê, porque o erro não foi de raciocínio.

Contei sobre uma cópia local do repositório que estava desatualizada: faltavam os módulos `audits`, `dashboard`, `notifications`, `proposals`, `segments` e `system` inteiros. Os números pareciam plausíveis e eram calculados sobre a árvore errada.

**É o mesmo padrão de três outros erros do dia** — o "4 `PipelineStage`" que li como "é pouco" sem perguntar onde estavam os outros dois, a verificação SQL que media zero contra tabela vazia, e o `NO FORCE` que eu afirmei sem testar. Em todos, um número correto respondendo a uma pergunta que não era a que eu precisava fazer. A pergunta que faltou aqui: **sobre o que este número foi calculado?**

### O inventário de verdade

**193 chamadas a tabelas com `tenantId`, em 17 arquivos.** Três já convertidos — `pipeline.service.ts`, `audits.service.ts` e `process-audit-job.ts`, somando 21 chamadas. **Restam 172 em 14 arquivos.**

| arquivo | chamadas |
|---|---:|
| `leads/leads.service.ts` | 33 |
| `proposals/proposals.service.ts` | 22 |
| `team/team.service.ts` | 21 |
| `worker/pipeline/process-scrape-job.ts` | 20 |
| `account/account.service.ts` | 16 |
| `outreach/outreach.service.ts` | 13 |
| `dashboard/dashboard.service.ts` | 12 |
| `billing/billing.service.ts` | 8 |
| `notifications/notifications.service.ts` | 7 |
| `admin/admin.service.ts` | 7 |
| `prospecting/prospecting.service.ts` | 6 |
| `auth/auth.service.ts` | 5 |
| `entitlements/entitlements.service.ts` | 1 |
| `common/tenant.guard.ts` | 1 |

**A correção que mais muda o plano:** a família 8 não é "sem interface, por último". O `proposals.service.ts` tem **22 chamadas** — a segunda maior do repositório —, sendo 7 em `proposal` e 4 em `contract`. Eu tinha registrado zero usos, medido na árvore sem o módulo.

E `dashboard` (12) e `notifications` (7) não apareciam em análise nenhuma de chamadores.

### Nota de método: 193 é um piso, não um total

A varredura conta **chamadas de delegate** — `.lead.findMany(`, `.membership.create(`. Ela não encontra tabela escopada alcançada por **`include` a partir de uma raiz não escopada**.

O caso que revelou isso é o `getSession` do `AuthService`: ele consulta `user.findUniqueOrThrow` e traz `memberships` — com o tenant, a assinatura e o plano — por `include` aninhado. O delegate é `user`, que não tem `tenantId`; `memberships` tem. Sob política em `memberships`, essa leitura devolve zero e **o login para de listar workspace nenhum.**

Antes da família 6, é preciso uma segunda varredura, por `include` e não por delegate. Enquanto ela não existir, o número acima é o que se sabe, não o que há.

### A segunda varredura — feita em 03/09, e o resultado

Feita antes da família 6, como planejado. Três cuidados de método, todos por causa de erros anteriores:

1. **Sobre os arquivos vivos.** Os 86 `.ts` de `apps/api/src` e `apps/worker/src` foram trazidos da máquina de origem no momento da varredura. A cópia local que eu tinha continha 42 arquivos — menos da metade — e teria produzido o mesmo tipo de número plausível e errado da primeira contagem.
2. **Com o mapa de relações derivado do schema, não escrito à mão.** A primeira tentativa usou um dicionário que eu digitei (`memberships` → `Membership`, e assim por diante). Ele deu o mesmo resultado, mas um mapa escrito à mão só encontra o que quem escreveu lembrou de listar. A versão que vale lê os campos de relação do `schema.prisma` e desce até quatro níveis de `include` aninhado.
3. **Sobre a pergunta certa.** Não "quais arquivos têm `include`", mas **"quais chamadas cuja raiz não tem `tenantId` alcançam tabela que tem"**. É a pergunta que o `getSession` levantou.

**Resultado: três chamadas, e as três já eram conhecidas.**

| local | raiz | alcança |
|---|---|---|
| `admin.service.ts:22` | `tenant.findMany` | `memberships`, `subscription` |
| `admin.service.ts:127` | `tenant.findFirst` | `subscription` |
| `auth.service.ts:272` | `user.findUniqueOrThrow` | `memberships`, `onboardingState`, `subscription` |

Nenhuma travessia nova. **O piso de 193 estava apertado para esta classe** — o que não era garantido, e por isso a varredura precisava existir. O `getSession` não era a ponta de um problema difuso; era o problema inteiro.

#### O que ela achou de outro tipo

A varredura falhou em confirmar uma coisa e acertou em outra. O inventário dizia **17 arquivos com chamadas ao Prisma. São 20.** Os três que faltavam:

- **`common/platform-admin.guard.ts`** — nunca apareceu em levantamento nenhum. Faz uma chamada, a `platformAdmin.findUnique`, e `PlatformAdmin` não tem `tenantId`.
- **`segments/segments.service.ts`** — seis chamadas, todas em `Segment` e `SegmentLocale`, taxonomia global compartilhada por todos os tenants.
- **`privacy/privacy.service.ts`** — criado depois do inventário, na D4.

**Nenhum dos três exige trabalho de conversão**, e é exatamente por isso que valia nomeá-los: sem estarem escritos, a ausência deles da fase A é indistinguível de esquecimento. Agora é decisão registrada.

### O estado real, medido em 03/09

Contagem sobre os arquivos vivos, separando o que está dentro de bloco (`tx.`) do que está fora (`this.prisma.`):

**64 chamadas a tabelas com `tenantId` ainda fora de bloco.** Destas, **53 são conversão de verdade**:

| arquivo | faltam |
|---|---:|
| `leads/leads.service.ts` | 33 |
| `worker/pipeline/process-scrape-job.ts` | 20 |

As outras **11 são os casos especiais**, e nenhuma delas deve virar `comTenant`:

| local | chamadas | por quê |
|---|---:|---|
| `admin.service.ts` | 7 | atravessa tenants por desenho |
| `team.service.ts:490` (`conviteValido`) | 1 | busca por token, antes de haver tenant |
| `privacy.service.ts:56` (`anonimizarAtor`) | 1 | varre as linhas da pessoa em todos os tenants |
| `common/tenant.guard.ts:46` | 1 | roda antes de o tenant ser conhecido |
| `entitlements.service.ts:217` | 1 | precisa receber o `tx`, não abrir bloco próprio |

Os números que o inventário já dava — `leads` 33, `process-scrape-job` 20, `admin` 7, `tenant.guard` 1, `entitlements` 1 — **conferiram todos**. O que estava errado era a lista de arquivos, não a contagem deles.

### Fase A concluída — 03/09

As 64 acabaram. **14 arquivos, 172 chamadas**, em oito fatias, cada uma verificada sozinha antes da seguinte.

O que a fase entregou além do embrulho, porque envolver uma chamada obriga a olhar para ela:

| onde | defeito que já existia |
|---|---|
| `leads.recalculateScore` e `scoreLead` (worker) | `deleteMany` + `createMany` nas razões do score, soltos: falha entre os dois deixava o lead com número e nenhuma explicação |
| `leads.changeStage` | podia mover o card e perder a transição — histórico com buraco que parece completo |
| `process-scrape-job.refundQuota` | `.catch()` dentro do que viraria transação: **segunda ocorrência** do defeito consertado em `devolverCota` em 27/08 |
| `process-scrape-job` (conclusão) | `COMPLETED` + notificação + auditoria soltas: falha na notificação deixava o job concluído sem o cliente saber |
| `admin.suspend` | marcar a suspensão e falhar antes de revogar as sessões deixava todo mundo trabalhando lá dentro |
| `prospecting.createSearch` | `P2002` sem tratamento: dois cliques simultâneos davam 500 |
| `billing.aplicarAssinatura` | seis escritas soltas: falha no meio deixava assinatura atualizada e acesso no estado anterior |

Sete defeitos, nenhum deles procurado. **A fase A foi barata em risco e cara em atenção**, e foi a atenção que os encontrou.

Duas correções de infraestrutura de teste entraram junto, e as duas eram "verde que valia menos do que parecia": o `billing-rules.spec.ts` passava um `PrismaClient` cru mascarado por `as never`, e o `scrape-pipeline.spec.ts` era o único spec do worker com um cliente só — o do dono —, o que faria a suíte de cota e score passar por fora da política na fase B.

### Os casos que não recebem `comTenant`

Saíram do levantamento e precisam de tratamento próprio:

- **`admin.service.ts` (7)** — atravessa tenants de propósito. É o caso do papel `propectai_admin` já descrito acima; embrulhar em `comTenant` quebraria a funcionalidade.
- **`tenant.guard.ts` (1)** — roda **antes** de o tenant ser conhecido: é ele quem o resolve. Não há contexto para declarar.
- **`entitlements.service.ts` (1)** — é chamado de dentro do bloco dos outros, com client próprio. O conserto é receber o `tx` por parâmetro, não abrir bloco próprio.
- **`auth.service.ts` → `getSession`** — lista os workspaces de uma pessoa. Não há um tenant a declarar: enumerá-los é o propósito. Terceiro caso de travessia deliberada, junto com `AdminService` e `PrivacyService`, e o terceiro a precisar do papel `propectai_admin`.

**Três caminhos atravessam tenants por desenho, e os três apareceram um de cada vez** — o painel administrativo no levantamento, o `PrivacyService` ao implementar a D4, e o `getSession` ao converter o `auth`. Nenhum foi previsto. Vale assumir que existe um quarto e procurá-lo antes da família 6, em vez de esperar que ele se apresente devolvendo zero em produção.

#### Atualização de 03/09: eram cinco

A suposição pagou, e pagou duas vezes.

- **Quarto — `TeamService.conviteValido`** (fatia 3). Busca o convite **pelo token**, e o tenant é o que ela devolve. Declarar contexto antes exigiria saber a resposta.
- **Quinto — a descoberta de tenant no webhook de cobrança** (fatia 5). `BillingService.receberWebhook` é chamado pelo Stripe: não há sessão e não há `tenantId` no caminho da chamada. `acharTenant` o descobre lendo `metadata.tenantId` ou procurando por `stripeCustomerId`.

O quinto é diferente dos outros quatro e merece destaque, porque ele **não é resolvível por papel nem por embrulho**:

> Se a tabela `tenants` ganhar política de RLS (`id = current_setting('app.tenant_id', true)`), as duas consultas de `acharTenant` passam a devolver zero linhas e **todo webhook de cobrança do produto para de funcionar** — a política exige como entrada exatamente o valor que a consulta existe para descobrir. É circular.

Saídas possíveis, ambas em aberto: `tenants` fica **sem** política, ou a descoberta roda como `propectai_sistema`. É o argumento mais forte até agora para o papel existir, e é decisão de schema, não de fase A.

**Cinco caminhos, e nenhum dos cinco foi previsto no levantamento inicial.** Os quatro primeiros apareceram ao converter o código; o quinto, ao ler um arquivo com atenção a uma pergunta que a varredura por delegate não faz. A segunda varredura (por `include`) fechou a classe que ela cobre — mas a classe "o tenant não existe quando a chamada começa" não é encontrável por varredura de texto nenhuma, porque é uma propriedade do fluxo e não da consulta. Essa continua saindo uma por vez.

#### E no fim eram quatro, não seis

O `TenantGuard` entrou na lista como sexto ao ser lido de perto — ele tem dois ramos, e o de escolher o membership padrão não tem tenant a declarar. Esse continua valendo.

Mas a **fatia 8c desfez parte da contagem**, e na direção oposta à esperada: **o `AdminService` não era um caminho, era um quarto de caminho.**

| método | atravessa? | por quê |
|---|---|---|
| `listTenants` | **sim** | agrega `plan_usages` e `lead_activities` de todos os tenants ao mesmo tempo |
| `changePlan` | não | recebe o `tenantId` por parâmetro |
| `suspend` | não | idem |
| `reactivate` | não | idem |

Os três últimos foram para o `comTenant`, e para eles isso **não é apenas suficiente — é mais apertado**: sob a política, um defeito que calculasse o tenant errado é recusado pelo `WITH CHECK`; com `BYPASSRLS` o mesmo defeito grava em silêncio no workspace de outro cliente.

**O erro de classificação tem um nome:** eu confundi *quem chama* com *o que a chamada faz*. O operador ser da plataforma decide se ele **pode** agir — isso é o `PlatformAdminGuard`. Não decide sobre **quantos** workspaces a consulta age, que é o que a política governa. "É o painel administrativo, então precisa do papel forte" é a forma curta desse erro, e ela é sedutora porque soa prudente.

**Custo concreto da confusão:** a migration `20260903120000_rls_papel_sistema` concedeu ao papel escrita em quatro tabelas, das quais três nunca foram usadas. Corrigido em `20260903190000_rls_papel_sistema_estreitar`, que deixa o papel com leitura em 10 tabelas e **uma única escrita** — o `UPDATE` em `audit_logs` do `anonimizarAtor`.

A regra que sai daí, e que vale para a fase B: **classificar por método, nunca por arquivo.** Um arquivo com quatro métodos pode ter quatro naturezas.

### A ordem da fase A

Uma fatia por vez, cada uma verificável sozinha, nenhuma arriscada:

1. **`auth.service.ts`** — pequeno, e é o caso especial: o tenant **nasce dentro** da transação de registro, então o contexto precisa ser declarado no meio dela, não na abertura. Também é o que quebrou a família Pipeline. Vai primeiro por isso.
2. **`prospecting` + `notifications` + `dashboard`** — 25 chamadas de leitura simples.
3. **`team` + `account`** — 37.
4. **`outreach` + `proposals`** — 35.
5. **`billing`** — 8.
6. **`leads`** — 33, o hub. Por último entre os da API, quando o padrão já estiver repetido cinco vezes.
7. **`process-scrape-job`** — 20, no worker.
8. **Os três casos especiais**, cada um com a sua solução.

**A ordem foi cumprida como planejada, com a oitava fatia partida em três** — `8a` (`entitlements` recebe o `tx`), `8b` (o papel do sistema e os cinco caminhos de uma chamada) e `8c` (`admin`) — porque as naturezas eram diferentes demais para uma verificação só. Todas as oito fecharam em 326 testes.

A escolha de deixar `leads` por último se pagou: quando chegou a vez dele, o padrão já tinha sido repetido cinco vezes, e a decisão difícil daquele arquivo — passar o `tx` para `assertLead` e `recordActivity` em vez de embrulhar método a método — foi reconhecida de imediato porque era a mesma de `team`, `account` e `billing`.

---

## O inventário

**42 tabelas. 33 carregam `tenantId`; 9 não.**

Sem `tenantId`, e corretamente fora do RLS:

| tabela | por quê |
|---|---|
| `users`, `refresh_tokens` | a pessoa existe antes e independentemente do workspace |
| `tenants` | é o próprio sujeito da política |
| `plans`, `billing_events` | catálogo e eventos do provedor, globais |
| `segments`, `segment_locales` | taxonomia compartilhada, é o que a torna útil |
| `platform_admins` | quem administra a plataforma não pertence a um tenant |

**E uma exceção que é um buraco:** `proposal_items` não tem `tenantId`. Ela pende de `proposals`, que tem — mas sob RLS a política protege a mãe e **não** a filha, e um `findMany` direto em `proposal_items` atravessaria tudo. Hoje não há interface para Propostas (`0` usos no código da API), então não vaza nada na prática. Fica registrado como pré-requisito da família 8: ou `tenantId` na tabela, ou ela nasce com o furo pronto no dia em que a tela existir.

---

## Os dois lugares onde o mecanismo colide com o produto

### 1. O painel administrativo atravessa tenants **de propósito**

`admin.service.ts` lista workspaces, uso e cobrança de todos os clientes. Isso não é um vazamento: é a funcionalidade. Sob RLS, essas consultas devolvem zero.

Três saídas, e a diferença entre elas é onde mora a confiança:

**(a) O módulo admin usa o `propectai_migrator`.** Funciona hoje, e mistura duas coisas que devem ficar separadas: o papel que roda migration passa a atender requisição HTTP.

**(b) Um papel próprio, `propectai_admin`, com `BYPASSRLS`.** O caminho que cruza tenants ganha **identidade de banco própria**, visível em `current_user`, auditável, e sem nada a ver com migration.

**(c) Exceção dentro da política** — `USING (... OR current_setting('app.platform_admin', true) = 'true')`. Uma conexão só, e **destrói a garantia que o `RESTRICTIVE` acabou de dar**: a isolação passa a depender de uma variável nunca ser definida por engano. É trocar uma restrição por uma convenção, que é exatamente o que a D2 recusou.

**Recomendo (b).** O argumento: onde cruzar tenant é a funcionalidade, isso deve aparecer na identidade de quem conecta — e não numa flag que qualquer caminho pode acender. O `PlatformAdminGuard` já existe e já decide quem pode; o papel só torna a decisão visível para o banco.

**Custo:** um papel novo, um client novo no `AdminModule`, e a disciplina de o `admin.service.ts` ser o único a usá-lo. Um teste que afirme `current_user = 'propectai_admin'` ali e `propectai_app` no resto fecha a disciplina.

> **Executado em 03/09, com dois desvios em relação ao que está escrito acima.**
>
> **O papel chama-se `propectai_sistema`, e não `propectai_admin`.** O nome mudou quando ficou claro que o painel administrativo é só um dos seus usuários — o `TenantGuard`, o `getSession`, o `conviteValido`, o `acharTenant` e o `anonimizarAtor` usam o mesmo papel, e nenhum deles é "admin". Um nome que descreve um dos chamadores convida o próximo a não se reconhecer nele.
>
> **E o `admin.service.ts` NÃO é o único a usá-lo — nem usa o papel por inteiro.** Só o `listTenants` atravessa; os outros três métodos recebem o `tenantId` por parâmetro e ficaram sob `comTenant`. Ver a atualização "E no fim eram quatro, não seis", acima. A disciplina que a seção propunha — "o admin é o único" — teria sido **errada nos dois sentidos**: larga demais para o admin e estreita demais para o resto do produto.
>
> A disciplina que ficou no lugar dela é estrutural em vez de acordada: o `PrismaSistemaService` **não expõe o client**. A única porta é `atravessandoTenants(motivo, fn)`, e o `motivo` é obrigatório. Um `grep` por esse nome lista todas as travessias do repositório, com a justificativa de cada uma.
>
> A opção (c) continua recusada, e o motivo ficou mais concreto do que estava escrito: um sentinela no contexto tornaria a escalada de privilégio **uma string** — alcançável por qualquer `comTenant('*', ...)`, isto é, por um erro de digitação. Com papel e credencial próprios, escalar exige ter a outra conexão.

### 2. Serviços que usam o próprio client não enxergam o `tx` de quem os chama

Já anotado no `audits.service.ts`: o `EntitlementsService` recebe o `PrismaService` por injeção e consulta com ele. Quando o `AuditsService` abre um `comTenant` e chama `entitlements.availableAuditCredits()`, essa consulta roda **fora** da transação — outra conexão, sem contexto de tenant.

Não tem efeito hoje: `plan_usage` e `subscriptions` não estão no canário. **Passam a ter no dia da família 6**, e o sintoma será zero linhas num gate de saldo, o que na prática vira "sem créditos" para todo mundo.

O conserto é o mesmo padrão em qualquer serviço compartilhado: **receber o `tx` como parâmetro em vez de usar o client injetado.** Vale varrer por serviços chamados de dentro de um `comTenant` antes da família 6, não depois.

---

## As famílias, e a ordem

| # | família | tabelas | quem escreve | estado |
|---|---|---|---|---|
| 1 | Auditoria | 2 | `AuditsService`, `processAuditJob` | ✅ feito |
| 2 | Pipeline | 3 | `PipelineService`, **`AuthService`, `LeadsService`** | ⏸ revertida — ver acima |
| 3 | Coleta | 2 | `processScrapeJob`, `ProspectingService` | |
| 4 | Atividade do lead | 6 | `LeadsService`, `OutreachService` | |
| 5 | Leads núcleo | 7 | `LeadsService`, `processScrapeJob` | |
| 6 | Conta e cobrança | 6 | `AccountService`, `TeamService`, `BillingService` | depende do §2 acima |
| 7 | Operação e registro | 5 | vários | depende do papel admin |
| 8 | Comercial | 2 (+`proposal_items`) | `ProposalsService` — **22 chamadas**, não zero | |

### Por que Pipeline é a próxima, e não Leads

Leads é a família mais valiosa e por isso a tentação óbvia. É também a de maior alcance: `leads.service.ts` tem 27 KB, o `processScrapeJob` escreve lá, e três specs consultam `lead` sem contexto de tenant. Começar por ela é repetir o erro que o canário existiu para não cometer.

Pipeline tem **três tabelas, um serviço de 5 KB, um controller**, e é a primeira família com caminho de leitura de API de verdade — o canário nunca exercitou uma listagem. É onde a regra de escopo medida no passo 3 aparece pela primeira vez: **o custo é por chamada de `comTenant`, não por requisição**, e uma tela de pipeline que faça cinco consultas em cinco chamadas paga cinco vezes os ~5 ms.

E há um motivo extra: a família Pipeline já estava na lista de pendências por outro caminho — `pipeline_transitions.fromStageId` e `pipeline_cards.stageId` são as FKs que ficaram sem chave composta, fecháveis com `@@unique([tenantId, id])` em `pipeline_stages`. **As duas coisas mexem nos mesmos arquivos**, e fazer junto custa menos que fazer duas vezes.

---

## Correção de 27/08: envolver e ligar são duas fases, não uma

**A primeira tentativa da família Pipeline foi revertida no mesmo dia.** Vale escrever por quê, porque o erro estava neste documento e não na execução.

O plano dizia "uma família por vez", e família era definida por **tabela**. Mas os chamadores atravessam famílias: as três tabelas de pipeline são escritas por **três módulos** — `pipeline.service.ts`, `auth.service.ts` (que cria as etapas padrão no registro) e `leads.service.ts` (que tem *sete* usos, mais que o próprio módulo Pipeline). Converti um dos três e liguei a política. O registro passou a responder 500 e 45 testes caíram.

**O módulo com o nome da tabela não é o dono dela.** Num monólito modular, a fronteira de módulo não é a fronteira de dado.

Pior que a quebra barulhenta: o `findOne` do `leads.service.ts` traz o card por `include` aninhado. Sob a política sem contexto, o card volta **null** — sem erro, sem teste falhando, com a tela do lead mostrando "sem etapa" para todos.

### A ordem certa

**Fase A — envolver todos os chamadores, com as políticas desligadas.**
Neutra em comportamento; medido no passo 3. Pode varrer o código inteiro em vários commits, cada um verificável, nenhum arriscado. Termina quando `grep` por delegate de tabela com `tenantId` não achar mais nada fora de um `comTenant`.

**Fase B — ligar as políticas, uma família por vez.**
Só aqui a decomposição por tabela volta a fazer sentido, porque não sobra chamador para descobrir.

Eu generalizei o canário de uma amostra de dois: aquelas duas tabelas tinham exatamente dois chamadores, e eu conhecia os dois.

---

## A receita por família (fase B)

1. **Varrer os chamadores** — `grep` pelo delegate em **todo** `apps/*/src`, não no módulo de mesmo nome. `$queryRaw`/`$executeRaw` incluídos. Conferir que todos já estão em `comTenant` pela fase A.
2. **Fixtures para o `criarPrismaAdmin()`** nos specs que tocam essas tabelas.
3. **Migration**: `ENABLE` + `FORCE` + `acesso_base` permissiva + `tenant_isolamento` restritiva, com `USING` e `WITH CHECK`.
4. **Teste de isolamento** no molde do `rls-canario.spec.ts`: `current_user` como pré-condição, leitura sem contexto devolvendo zero **com denominador**, leitura cruzada devolvendo zero, e `WITH CHECK` recusando escrita no vizinho.

**A ordem entre 2 e 3 não é negociável.** Ligar a política antes de mover as fixtures quebra tudo de uma vez, e aí não se sabe se o problema é a política ou o cenário.

**E reverter é `DISABLE ROW LEVEL SECURITY`, não `NO FORCE`** — ver a correção no `PLANO-RLS-v1.md`.

---

## O que este plano não resolve

**Não há estimativa de prazo aqui**, e não vou inventar uma. O canário levou uma tarde com o mecanismo já provado; a família Leads tem dez vezes mais superfície e três specs para migrar. O que dá para dizer é que as famílias 2 a 5 são mecânicas, e as 6 e 7 têm decisão de desenho antes.

**O passo 6 não fecha o `$queryRaw` de quem não usa `comTenant`.** Fecha o efeito — zero linhas —, não a chamada. A varredura continua valendo a cada família.

**A medição de latência foi feita em consulta barata e isolada.** Uma tela de pipeline com cinco consultas é outro caso, e merece o `rls:bench` apontado para ela antes de assumir que os ~5 ms se diluem. Já errei essa previsão uma vez, no passo 3.

---

## Fase B concluída — 04/09

**34 das 42 tabelas sob política.** As oito de fora são as globais listadas no inventário, e a nona que era buraco — `proposal_items` — ganhou a coluna.

### A tabela real, contra a que este documento previa

| # | família | previa | foram | migration | testes |
|---|---|---:|---:|---|---:|
| 1 | Auditoria | 2 | 2 | `20260827140000_rls_canario_auditoria` | — |
| 2 | Pipeline | 3 | 3 | `20260903200000_..._pipeline_religar` | 333 |
| 3 | Coleta | 2 | 2 | `20260903210000_rls_familia_coleta` | 340 |
| 4 | Atividade do lead | 6 | 6 | `20260903220000_rls_familia_atividade` | 349 |
| 5 | Leads núcleo | 7 | 7 | `20260903230000_rls_familia_leads` | 362 |
| 6 | Conta e cobrança | 6 | **5** | `20260904100000_rls_familia_conta` | 374 |
| 7 | Operação e registro | 5 | **6** | `20260904140000_rls_familia_operacao` | 388 |
| 8 | Comercial | 2 (+1) | **3** | `20260904170000_rls_familia_comercial` | 399 |

**Duas contagens erradas, em sentidos opostos.**

`billing_events` estava contada na família 6 e **não tem `tenantId`** — o próprio schema documenta por quê: o evento do provedor chega antes de sabermos de quem é, e evento de preço não pertence a tenant nenhum. Sem coluna não há política a escrever. São cinco.

`feature_flags` não estava na família 7 e **tem `tenantId`** como todas as outras — flag é por workspace. São seis.

As duas só apareceram porque a varredura de cada família abriu o schema em vez de repetir esta tabela. **É o argumento contra confiar num plano na hora de executá-lo**, mesmo num plano cuidadoso: ele foi escrito com menos informação do que quem o executa tem.

### Correções ao inventário, acima

**"`proposal_items` … Hoje não há interface para Propostas (`0` usos no código da API)" — falso.** São **11 acessos** a `proposal`, `proposalItem` e `contract`, todos no `proposals.service.ts`. A linha da família 8 na tabela original já se corrigia sozinha dizendo "**22 chamadas**, não zero" — e 22 também não é o número. O correto é 11, medido em 04/09.

Que o mesmo documento carregasse "0" num parágrafo e "22" numa tabela, sobre a mesma coisa, é o sintoma: **uma correção que não apaga o texto corrigido deixa duas afirmações em pé.**

**A resolução do buraco:** `proposal_items` ganhou `tenantId` com FK composta para `proposals(tenantId, id)`, na `20260904160000_proposal_items_tenant` — separada da migration de política de propósito, porque uma pode falhar por dado preexistente e a outra não pode falhar por nada.

### O §2 — serviços que usam o próprio client

"Vale varrer por serviços chamados de dentro de um `comTenant` antes da família 6, não depois." **Foi feito**, na fatia 8a: o `EntitlementsService.currentUsage` passou a aceitar um `tx` opcional, e **os dois ramos declaram contexto** — nenhum roda sem. `availableLeadCredits` e `availableAuditCredits` repassam.

A previsão do sintoma estava certa: seria zero linhas num gate de saldo, isto é, "sem créditos" para todo mundo.

### Onde este plano errou a dificuldade

Ele diz: *"as famílias 2 a 5 são mecânicas, e as 6 e 7 têm decisão de desenho antes."*

Errado nos dois lados. As decisões de 6 e 7 já estavam resolvidas quando chegaram — o `propectai_sistema` tinha sido criado na fatia 8b, e os caminhos que atravessam tenants já usavam `atravessandoTenants`. O que apareceu de difícil apareceu onde o plano previa mecânica:

- **Família 5** quebrou o método de varredura. Ver a emenda à receita, abaixo.
- **Família 7** trouxe a única tabela com `tenantId` anulável do sistema, `audit_logs`, e com ela um comportamento que nenhuma outra tem: linha órfã invisível em **todo** contexto.
- **Família 8** exigiu mudança de schema.

O padrão: a dificuldade não estava onde havia decisão em aberto, e sim onde a forma do dado era diferente do que o plano assumia como uniforme.

### Emenda à receita — o passo 1 não bastava

O passo 1 diz: *"Varrer os chamadores — `grep` pelo delegate em todo `apps/*/src`."*

**Isso encontrou todo mundo nas famílias 1 a 4, e não encontrou na 5.** A tabela `leads` é alcançada por `include` a partir de `pipelineCard`, `proposal`, `contract` e `outreachMessage` — e um `include` não escreve o nome do delegate em lugar nenhum.

Concretamente: `pipeline.service.ts` **não tem um único acesso direto** a nenhuma tabela da família 5. Só chega ao lead pelo `include` do card. A varredura por delegate o teria declarado não envolvido, e a tela do funil abriria com card sem nome, sem cidade e sem score.

O mesmo formato reapareceu na família 8: `proposal_items` não aparece na varredura por delegate, porque só é alcançada aninhada em `proposal`.

**O passo 1 passa a ter duas metades:**

1. `grep` pelo delegate em todo `apps/*/src`, `$queryRaw`/`$executeRaw` incluídos.
2. `grep` pelos **nomes de relação** da tabela nos `include` e `select` de qualquer outra — e pelos caminhos de dois saltos, do tipo `contract.proposal.lead.name`, que aparecem em arquivos cujo nome não sugere relação com a tabela.

A segunda metade não tem como ser mecânica: ela exige ler os nomes de relação no schema primeiro. É mais lenta, e é a que encontra o que a primeira não encontra.

### O que a fase B não fecha

1. **As duas FKs compostas adiadas do Pipeline** — `pipeline_cards.stageId` e `pipeline_transitions.toStageId`, fecháveis com `@@unique([tenantId, id])` em `PipelineStage`. Continuam adiadas por escolha, e agora com um precedente a mais de que o padrão funciona: a família 8 aplicou exatamente esse padrão em `Proposal`, com backfill em três passos, e passou.

2. **O `prisma/seed.ts` escreve pelo `DATABASE_URL`**, que é o dono superusuário, e superusuário ignora RLS mesmo com `FORCE`. Vale para todas as tabelas que ele toca. **Continua sendo sorte estrutural e não desenho** — no dia em que o dono deixar de ser superusuário, ou o seed rodar por um papel comum, ele precisa do `propectai_migrator`.

3. **Três credenciais a provisionar no primeiro deploy** — `propectai_migrator`, `propectai_app` e `propectai_sistema`. Nenhuma entra sem senha: o `pg_hba.conf` do container só confia no socket local e no `127.0.0.1` de dentro; conexão vinda de fora chega pelo gateway da ponte Docker e cai em `scram-sha-256`. **Isso inclui o dono.** A primeira migration não roda antes disso.

4. **`typecheck:all` antes de `test` no CI.** Oito ocorrências ao longo do programa em que o typecheck teria pego o defeito primeiro. Sem dono.

5. **A medição de latência** continua feita em consulta barata e isolada, como diz a seção acima. Nada na fase B mudou isso, e agora há 34 tabelas sob política em vez de duas.

### A verificação de fechamento

`docs/intelligence/gate0/verificacoes-fase-b.sql`, oito checagens, todas ao catálogo — o resultado não depende de haver dado.

**A checagem 3 é a razão do arquivo existir: ela não conhece nome de tabela nenhum.** Parte de "tem coluna `tenantId`" e cobra RLS ligado, `FORCE` ligado, política de base e política de isolamento. Uma tabela criada daqui a seis meses por quem nunca leu este documento aparece nela sozinha.

Uma verificação que enumera o que ela mesma espera só prova que a lista foi copiada corretamente.

`F:\drmind` não foi modificado.
