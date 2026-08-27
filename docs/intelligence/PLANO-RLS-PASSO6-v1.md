# Passo 6 — espalhar o RLS para as demais tabelas

**Versão 1 · 27/08/2026 · continua o `PLANO-RLS-v1.md`, cujos passos 1 a 5 estão entregues**

O canário provou o mecanismo: `FORCE`, política `RESTRICTIVE`, `comTenant`, e S8/S9 verdes contra o banco. **O que falta não é descobrir se funciona — é descobrir onde não cabe.**

Este documento levanta o inventário, aponta os dois lugares onde o mecanismo colide com o produto, e propõe uma ordem.

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

### 2. Serviços que usam o próprio client não enxergam o `tx` de quem os chama

Já anotado no `audits.service.ts`: o `EntitlementsService` recebe o `PrismaService` por injeção e consulta com ele. Quando o `AuditsService` abre um `comTenant` e chama `entitlements.availableAuditCredits()`, essa consulta roda **fora** da transação — outra conexão, sem contexto de tenant.

Não tem efeito hoje: `plan_usage` e `subscriptions` não estão no canário. **Passam a ter no dia da família 6**, e o sintoma será zero linhas num gate de saldo, o que na prática vira "sem créditos" para todo mundo.

O conserto é o mesmo padrão em qualquer serviço compartilhado: **receber o `tx` como parâmetro em vez de usar o client injetado.** Vale varrer por serviços chamados de dentro de um `comTenant` antes da família 6, não depois.

---

## As famílias, e a ordem

| # | família | tabelas | quem escreve | estado |
|---|---|---|---|---|
| 1 | Auditoria | 2 | `AuditsService`, `processAuditJob` | ✅ feito |
| 2 | Pipeline | 3 | `PipelineService` | **próxima** |
| 3 | Coleta | 2 | `processScrapeJob`, `ProspectingService` | |
| 4 | Atividade do lead | 6 | `LeadsService`, `OutreachService` | |
| 5 | Leads núcleo | 7 | `LeadsService`, `processScrapeJob` | |
| 6 | Conta e cobrança | 6 | `AccountService`, `TeamService`, `BillingService` | depende do §2 acima |
| 7 | Operação e registro | 5 | vários | depende do papel admin |
| 8 | Comercial | 2 (+`proposal_items`) | — sem interface | por último |

### Por que Pipeline é a próxima, e não Leads

Leads é a família mais valiosa e por isso a tentação óbvia. É também a de maior alcance: `leads.service.ts` tem 27 KB, o `processScrapeJob` escreve lá, e três specs consultam `lead` sem contexto de tenant. Começar por ela é repetir o erro que o canário existiu para não cometer.

Pipeline tem **três tabelas, um serviço de 5 KB, um controller**, e é a primeira família com caminho de leitura de API de verdade — o canário nunca exercitou uma listagem. É onde a regra de escopo medida no passo 3 aparece pela primeira vez: **o custo é por chamada de `comTenant`, não por requisição**, e uma tela de pipeline que faça cinco consultas em cinco chamadas paga cinco vezes os ~5 ms.

E há um motivo extra: a família Pipeline já estava na lista de pendências por outro caminho — `pipeline_transitions.fromStageId` e `pipeline_cards.stageId` são as FKs que ficaram sem chave composta, fecháveis com `@@unique([tenantId, id])` em `pipeline_stages`. **As duas coisas mexem nos mesmos arquivos**, e fazer junto custa menos que fazer duas vezes.

---

## A receita por família

Cinco passos, iguais para todas. O canário é o gabarito.

1. **Varrer os chamadores.** Quem toca essas tabelas, e quem chama serviço compartilhado de dentro do bloco. `$queryRaw`/`$executeRaw` incluídos.
2. **`comTenant` nos serviços**, envolvendo o escopo mais amplo que fizer sentido — nunca consulta a consulta, e nunca com I/O externo dentro.
3. **Fixtures para o `criarPrismaAdmin()`** nos specs que tocam essas tabelas. É o trabalho que o passo 2 recortou para dois arquivos, e ele volta aqui, uma família por vez.
4. **Migration**: `ENABLE` + `FORCE` + `acesso_base` permissiva + `tenant_isolamento` restritiva, com `USING` e `WITH CHECK`.
5. **Teste de isolamento** no molde do `rls-canario.spec.ts`: `current_user` como pré-condição, leitura sem contexto devolvendo zero **com denominador**, leitura cruzada devolvendo zero, e `WITH CHECK` recusando escrita no vizinho.

**A ordem entre 3 e 4 não é negociável.** Ligar a política antes de mover as fixtures quebra tudo de uma vez, e aí não se sabe se o problema é a política ou o cenário.

---

## O que este plano não resolve

**Não há estimativa de prazo aqui**, e não vou inventar uma. O canário levou uma tarde com o mecanismo já provado; a família Leads tem dez vezes mais superfície e três specs para migrar. O que dá para dizer é que as famílias 2 a 5 são mecânicas, e as 6 e 7 têm decisão de desenho antes.

**O passo 6 não fecha o `$queryRaw` de quem não usa `comTenant`.** Fecha o efeito — zero linhas —, não a chamada. A varredura continua valendo a cada família.

**A medição de latência foi feita em consulta barata e isolada.** Uma tela de pipeline com cinco consultas é outro caso, e merece o `rls:bench` apontado para ela antes de assumir que os ~5 ms se diluem. Já errei essa previsão uma vez, no passo 3.

`F:\drmind` não foi modificado.
