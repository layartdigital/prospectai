# PROVIDER CONTRACT e EVIDENCE MODEL · v5

**Produto:** **PropectAI**
**Data:** 22/08/2026 · **Origem:** item 5 da sequência do `PROMPT-01-ADENDO.md`
**Substitui:** v1 a v4 — **as quatro reprovadas em review adversarial**

**Declaração obrigatória (`CLAUDE.md`, Qualidade):** `F:\drmind` não foi modificado. Nenhum recurso Docker foi tocado. Nenhuma alteração fora de `docs/`.

---

## 0. As duas mudanças desta versão

**A v4 mudou o método** — parou de escrever migration para um banco que não posso executar, e passou a entregar decisões e consultas de verificação. Isso funcionou: o review confirmou 10 dos 16 defeitos anteriores como fechados, e a camada factual sobre o código como correta.

**A v5 muda o alvo.** O review encontrou que a §7 inteira da v4 — invariante, proveniência por sinal, rotina de revogação — protegia `hasInstagram` e `hasFacebook`, que são produzidos pela capability que a §4 do mesmo documento declara **bloqueada**. E não cobria `websiteHasHttps`, o único sinal que a fase liberada realmente escreve.

> F0 protegeria dois sinais que ninguém pode escrever, e F3 gravaria medição sem proveniência — o defeito que a §7 existe para impedir.

**Correção:** a invariante deixa de ser item de F0. Ela nasce **junto da capability que produz o sinal**, em F3 para `hasHttps` e em F5 para os sociais. É a aplicação, à própria §7, do critério que o documento usa em toda parte: *componente sem consumidor não é construído.*

### Defeitos tratados, por versão de origem

| Origem | Defeitos | Onde |
|---|---|---|
| v1–v3 | Tabela inexistente, `CHECK` sobre dado existente, `Evidence` paralelo, SQL em snake_case, `unknown` no resultado, orçamento estourado em silêncio, pipeline contra T6, medição sustentando dois sinais, `Boolean?` na invariante, `ScrapeJob` sem `searchId`, escopo citado além do status | Fechados na v4, mantidos aqui |
| **v4** | Invariante mirando o sinal errado | **§7, §13** |
| **v4** | FK composta exige `@@unique` no **pai**, e `leads` não tem | **§7.4** |
| **v4** | `check` no topo não é discriminante; `result` não amarrado | **§5** |
| **v4** | `revokeSignal` regrava a URL no `AuditLog` | **§8** |
| **v4** | `audit.run` e contador de auditoria **não existem** | **§3.2, §13** |
| **v4** | Três controles da egress policy rebaixados sem erratum | **§3.1, §12** |
| **v4** | Reautorização fecha forja de tenant, deixa replay de id | **§6.1** |
| **v4** | "69%" republicado sem as ressalvas do próprio Gate 0 | **§4** |
| **v4** | ADR descrito como quebra de regra, sendo o mecanismo dela | **§10** |
| **v4** | Assinatura de drift no pipeline errado, sem baseline | **§6.3** |

---

## 1. A convenção de provider já existe — e está triplicada

| Contrato | Tipo | Fábrica | Implementações |
|---|---|---|---|
| `LeadSourceProvider` | `packages/types/src/lead-source.ts:88` | `apps/worker/src/providers/index.ts:8` | `GoogleMapsScraperProvider`, `MockLeadSourceProvider` |
| `PaymentProvider` | `packages/types/src/payment-provider.ts:159` | `apps/api/src/billing/providers/payment-provider.factory.ts` | `StripePaymentProvider`, `MockPaymentProvider` |
| `AIProvider` | `@propectai/types` | `apps/api/src/outreach/providers/ai-provider.factory.ts:20` | `GeminiAIProvider`, `MockAIProvider` |

**A forma repetida:** `readonly name` como primeiro campo · verbos do domínio, nunca `execute(input: unknown)` · nenhum tipo do fornecedor cruzando a fronteira · uma pasta `providers/` por família, onde o SDK é o único lugar importado · uma fábrica que escolhe por env · **mock sempre presente, com queda logada** — nas três.

O cabeçalho de `payment-provider.ts` enuncia o princípio **e o critério de verificação**:

> *"o domínio não pode conhecer o fornecedor... **O teste de que funcionou:** `apps/api/src/billing/providers/` é a única pasta do repositório que importa o SDK do Stripe."*

**Um quarto provider que ignore esta forma não é evolução da arquitetura — é uma segunda arquitetura.**

---

## 2. Retratação do gap G2

`GAP-ANALYSIS.md` classificou como **Alta**: *"Scraper chamado direto pelo `prospecting`."* **É falso nos dois módulos:** o worker tem a abstração com duas implementações e fábrica, e `prospecting.service.ts` — o acusado — enfileira no BullMQ.

**O que falta:** registry (é um `if`), router com critério (é um `.env` global resolvido no boot), health (`configurado` é booleano), custo em moeda. **Severidade corrigida: Média.**

---

## 3. O que fica adiado

### 3.1 RLS — não é minha decisão, e não pode ser rebaixada em silêncio

`SECURITY-EGRESS-POLICY-v2.md` **já foi entregue** e lista RLS como mitigação do T2 — *vazamento entre tenants*, severidade **Alta**.

A v3 adiou RLS oferecendo FK composta como substituto. **Não substitui:** FK impede escrita com tenant divergente; **não impede leitura sem filtro de tenant**, que é o T2.

| Opção | Custo | Descoberto |
|---|---|---|
| **RLS agora** | Role separada do owner, `FORCE ROW LEVEL SECURITY`, `SET LOCAL` amarrado à transação — o pool do Prisma não garante afinidade fora de `$transaction`. Toca todo acesso a dado | Nada |
| **Extensão do Prisma exigindo `tenantId`** | Baixo | Query raw, e todo caminho que não passe pelo client |
| **Só FKs compostas** | Baixo | **Leitura inteira. Não fecha T2** |

Recomendo a **segunda com as FKs juntas**, registrando que ela não fecha T2 — o que exige **erratum na egress policy**, não uma linha de tabela aqui. Ver §12.

### 3.2 Por que adiar registry e router — e o que isso pressupõe que não existe

**Não há provider pago.** Seleção de provider por tenant só vira requisito quando existir um provider que só alguns planos alcancem — o mesmo gatilho do `CostGuard`. Enquanto o verificador for nativo, todos os planos usam o mesmo, e o que muda é a cota.

> **A v4 apoiou isto citando `scope-v0.2.md` §6 como se fosse aprovado.** Não é: a §7.1 deste documento estabelece que só as duas decisões estruturais da §1 daquele escopo estão aprovadas, e a própria §6 abre com *"valores a definir com o comercial"*. O argumento vale pelo mérito, não pela autoridade.

**E a cota que ele pressupõe não existe.** `scope-v0.2.md` §6 diz *"**Nova** capacidade em `EntitlementsService`: `audit.run` e `audit.export`. Contagem em `PlanUsage`"* — futuro. Conferido no schema: `PlanUsage` tem `leadsReserved`, `leadsSettled`, `searchesCount`, `aiGenerationsCount`, `exportsCount` e **nenhum contador de auditoria**. `EntitlementsService` existe e resolve crédito de *lead*.

**Consequência:** `audit.run`, `audit.export` e `PlanUsage.auditsCount` são **entrega de F3**, e o diagrama da §6 os desenha como existentes. Ver §13.

---

## 4. Capabilities

| Capability | Contrato | Consumidor | Estado |
|---|---|---|---|
| `LEAD_DISCOVERY` | `LeadSourceProvider` | Busca de prospects | `CURRENT` |
| `OUTREACH_GENERATION` | `AIProvider` | Módulo `outreach` | `CURRENT` |
| `WEBSITE_HEALTH_AUDIT` | `SiteAuditProvider` | `scope-v0.2.md` Fase 1 | `TARGET` |
| `SITE_CLASSIFICATION` | **derivada, sem provider** | Fase 2 | `TARGET` |
| `SOCIAL_LINK_DISCOVERY` | `SiteAuditProvider` | Fase 3 | **`BLOCKED`** |

`SITE_CLASSIFICATION` não é capability de provider: as nove categorias do `scope-v0.2.md` §3.4 são derivadas das medições.

**`SOCIAL_LINK_DISCOVERY` está bloqueada**, não pendente: `SECURITY-EGRESS-POLICY-v2.md` §8 determina que *"para clínica, advogado e MEI, o Instagram do site **é o perfil pessoal**"* e manda **reclassificar**. A reclassificação não aconteceu.

**O bloqueio precisa existir em código, não em prosa.** `SiteAuditInput.checks` aceita qualquer `SiteCheck`; um provider que implemente o contrato como escrito executa a capability bloqueada por default. **Decisão:** `INSTAGRAM_LINK` e `FACEBOOK_LINK` não entram no tipo `SiteCheck` até a reclassificação — são acrescentados em F5, com a união se estendendo por adição.

### O número do Gate 0, com as ressalvas que ele próprio declara

A v1 a v4 publicaram "69% de cobertura". O dado, lido do `gate0_social.csv`:

| | |
|---|---|
| Leads na amostra | 111 |
| Com site | 83 |
| `PRESENTE` | 58 — **dos quais 4 são camada `A_SCRAPER`**: o campo `website` já *era* a rede social, nenhum site foi buscado |
| **Carregavam link social no site** | **54 de 83 = 65%** |
| Sites que não responderam | 9 |
| Estrato `SEM_SITE` | **Não medido** — 53 linhas `C_PULADA`. É o estrato que o próprio script chama de "o que decide" |
| `verificacao_humana` | **Vazia nas 111 linhas.** O script encerra pedindo o erro silencioso, limiar ≤3% |

**O Gate 0 se declara incompleto, e nenhuma das quatro versões anteriores disse isso ao republicar o número.**

### 4.1 O enum `LeadSource` não é um registry

Marca a **procedência do registro** — inclusive `MANUAL`, que não tem provider. Sobrevive ao registry, que acrescentaria `providerId` ao lado.

---

## 5. O contrato

```typescript
export interface SiteAuditProvider {
  readonly name: string;
  audit(input: SiteAuditInput): Promise<SiteAuditResult>;
}

export interface SiteAuditInput {
  /** Obrigatório: a egress §2.6 exige rate limit de egress por tenant. */
  tenantId: string;
  /** URL crua, como veio de `Lead.website`. Nunca confiável. */
  url: string;
  checks: SiteCheck[];
}

/** INSTAGRAM_LINK e FACEBOOK_LINK entram em F5, após a reclassificação — §4. */
export type SiteCheck =
  | 'DNS' | 'HTTP_REACHABLE' | 'HTTPS' | 'REDIRECT_CHAIN'
  | 'VIEWPORT_META' | 'TTFB' | 'TITLE_META';

export type SiteCheckResult =
  | { check: 'DNS';            resolves: boolean; addressCount: number }
  | { check: 'HTTP_REACHABLE'; statusCode: number }
  | { check: 'HTTPS';          valid: boolean; expiresAt: Date | null }
  | { check: 'REDIRECT_CHAIN'; hops: number; finalUrl: string }
  | { check: 'VIEWPORT_META';  present: boolean }
  | { check: 'TTFB';           milliseconds: number }
  | { check: 'TITLE_META';     title: string | null; description: string | null };
```

### O envelope, corrigido

A v4 pôs `check: SiteCheck` no topo dos três membros alegando ser o discriminante. **Não é:** é o mesmo tipo nos três, logo não separa membro nenhum — o discriminante é `status`. E `result` era a união inteira, **sem amarra com o `check` do envelope**.

Isso compilava, e é um defeito de correção, não de estilo:

```typescript
// Compilava na v4. O envelope diz TTFB, a medição é de DNS.
{ check: 'TTFB', status: 'OK', observedUrl: '…', observedAt: new Date(),
  result: { check: 'DNS', resolves: true, addressCount: 2 } }
```

A projeção leria `check === 'TTFB'`, gravaria na coluna de TTFB o valor de DNS, e o relatório afirmaria ao prospect um tempo que nunca foi medido — contra o `scope-v0.2.md` §4, que exige que ele possa conferir.

**A forma que fecha, com tipo mapeado:**

```typescript
type OkOutcome = {
  [K in SiteCheck]: {
    check: K;
    status: 'OK';
    /** POR CHECAGEM: com até 3 saltos de redirect, DNS e TITLE_META não
     *  olham a mesma URL, e cada afirmação precisa da sua evidência. */
    observedUrl: string;
    observedAt: Date;
    result: Extract<SiteCheckResult, { check: K }>;
  };
}[SiteCheck];

export type SiteCheckOutcome =
  | OkOutcome
  | { check: SiteCheck; status: 'FAILED';  observedUrl: string; observedAt: Date; errorCode: SiteCheckError }
  | { check: SiteCheck; status: 'SKIPPED'; reason: 'NOT_REQUESTED' | 'DEPENDENCY_FAILED' };

export interface SiteAuditResult {
  auditVersion: string;   // `scope-v0.2.md` §5, como `algorithmVersion` do score
  outcomes: SiteCheckOutcome[];
}
```

Agora `o.status === 'OK' && o.check === 'TTFB'` estreita `o.result` para o membro de TTFB, e o exemplo acima deixa de compilar.

**Sem `success: boolean`:** ele obrigaria a inventar um critério de "suficiente" que ninguém definiu. Parcial é o caso comum.

---

## 6. Pipeline

```text
┌── API (NestJS) ─────────────────────────────────────────────┐
│  Authorize Tenant · Entitlement audit.run · Quota           │  ◄── a criar (§3.2)
│  Enqueue                 BullMQ — só o auditId              │
└─────────────────────────────────────────────────────────────┘
┌── worker (BullMQ) ──────────────────────────────────────────┐
│  Dequeue · REAUTORIZAR · GUARDA DE ESTADO       ◄── §6.1    │
│  Execute → fetcher ─┐                                       │
│  Sanitize ◄─────────┘   ingresso                            │
│  Snapshot · Validate · Normalize                            │
│  Persist DigitalPresenceCheck · Project via porta           │
│  Meter Usage · Audit                                        │
└─────────────────────────────────────────────────────────────┘
┌── fetcher ──────────────────────────────────────────────────┐
│  URL → bytes + headers + contentHash. Sem DSN.              │
│  Sem rota para 5434/6381                                    │
└─────────────────────────────────────────────────────────────┘
```

### 6.1 Reautorização **e guarda de estado** — T6

Hoje `prospecting.service.ts` enfileira `{ tenantId, searchId, scrapeJobId, keyword, ... }`: **o `tenantId` viaja no corpo da mensagem**, que é o padrão que o T6 proíbe.

A v4 corrigiu para "a mensagem carrega só o id, e o worker deriva o tenant do banco". **Isso fecha a forja de tenant e deixa o replay de id.** A egress §4 exige derivar o tenant de algo *que o produtor não controle* — e o produtor controla o id, que seleciona a linha, que determina o tenant. Escalação de privilégio virou replay.

**Correção completa:**

1. A mensagem carrega apenas o id da execução
2. O worker deriva `tenantId` da linha, e revalida entitlement e cota
3. **Guarda de estado:** uma execução só sai de `QUEUED`. Reenfileirar id `COMPLETED` ou `RUNNING` é descartado e logado
4. Reprocesso parcial (§6.5) **não** reenfileira o mesmo id: cria execução nova apontando para a anterior

Sem o passo 3, o atacante enumera ids e reenfileira em laço: consome a cota da vítima, dispara egress a partir do bucket de rate limit dela, e cobra repetido — tudo com reautorização passando, porque a linha é legítima. **Teste novo: S12b, replay de id válido.**

### 6.2 Sanitização no ingresso

```text
v1/v2 (errado)  fetch → SNAPSHOT → validate → normalize(filtra PII)
v5 (correto)    fetch → sanitize → SNAPSHOT → validate → normalize
```

É a convenção do `LeadSourceProvider`: o `RawLead` já diz que `user_reviews`, `user_reviews_extended` e `owner` são *"DESCARTADOS antes de chegar aqui"*. A v1 propôs abandoná-la sem notar.

### 6.3 Drift — o que é coberto, onde, e o que falta especificar

**Correção de escopo, que a v4 não fez:** este mecanismo é do pipeline de **coleta** — payload JSON do scraper, com forma estável e esperada. **Não se aplica ao pipeline de auditoria**, cuja entrada é HTML de sites arbitrários, onde forma diferente é a condição normal e não sinal de drift.

| Classe | Coberta? | Como |
|---|---|---|
| Chave nova | **Sim** | Assinatura observada tem caminho ausente da esperada |
| Chave que sumiu | **Sim** | Assinatura esperada tem caminho ausente da observada |
| Mudança de tipo | **Sim** | Mesmo caminho, tipo diferente |
| **Semântica** — `reviewCount` passa a somar filiais | **Não** | Indetectável por qualquer mecanismo estrutural. **Risco declarado** |

A assinatura é o conjunto de `(caminho, tipo)`, **calculada antes da sanitização** — senão os campos que o sanitizador remove por política ficam indistinguíveis dos que sumiram por drift. Ela sai do mesmo ponto que o `contentHash`, e nenhum valor viaja com ela.

**Duas coisas ficam abertas, e a v4 as apresentava como resolvidas:**

- **Onde mora a assinatura esperada.** Baseline versionado, e o que fazer quando o fornecedor muda de forma legítima. Sem isso, as classes 2 e 3 estão delegadas a um artefato que não existe
- **Custo de representação.** Payload do Maps tem arrays e JSON aninhado em string. Colapsar índices perde heterogeneidade; não colapsar explode em um caminho por elemento

**Retenção de `contentHash`:** serve a **dedup**, e a chave de dedup **inclui o tenant** (egress §5). Como o fetcher não conhece tenant, ele devolve o hash e o worker compõe a chave.

**Não é chave de idempotência de reprocesso, e a v3 afirmava que era.** Refazer o fetch de página com timestamp ou contador devolve hash diferente. A chave certa já existe: `data-model.md` — *"reprocessar um `ScrapeJob` concluído não pode criar lead novo nem cobrar de novo. A chave é `(tenantId, source, sourceId)`."*

**A quarentena como store deixa de existir** — o residual (assinatura, hash, `errorCode`, tamanho) vai na linha da execução. **Isto altera a egress §3.1 e exige erratum** — ver §12.

### 6.4 A auditoria não cabe no `ScrapeJob`

```prisma
model ScrapeJob {
  searchId String   // NOT NULL, FK obrigatória para prospecting_searches
  keyword  String   // NOT NULL
  source   LeadSource @default(GOOGLE_MAPS)
}
```

Uma auditoria é *"sob demanda, por lead"* — **não tem `ProspectingSearch` nem `keyword`**. Estender exigiria tornar duas colunas `NOT NULL` em nuláveis, em tabela com volume, e sobrecarregar `LeadSource` com valor que não é procedência.

**A execução da auditoria é `DigitalPresenceAudit`.** Não é modelo paralelo: é outro tipo de execução, com outro disparador e outra unidade de cobrança.

### 6.5 `PARTIAL`

`ScrapeJobStatus` tem oito valores e **não tem `PARTIAL`**. O estado vive em `DigitalPresenceAudit`: persiste o obtido com registro do que falhou, cobra o executado, e o reprocesso cria execução nova (§6.1, item 4).

---

## 7. Evidência — decisões e pré-requisitos, não migration

### 7.1 O nome já existe, e o status dele, com precisão

`scope-v0.2.md` §5 propõe `DigitalPresenceAudit`, `DigitalPresenceCheck` e `AuditReport`.

**Não invoco autoridade:** aquele documento declara *"Status: aprovado nas duas decisões estruturais; detalhamento aberto a revisão"*, e as duas decisões estruturais são destinatário do relatório e momento da verificação. A §5 é detalhamento.

O argumento é outro: **o projeto já propôs um nome, e inventar `Evidence` ao lado cria o quarto modelo de evidência** — junto de `DigitalPresenceCheck` (proposto), `LeadScoreReason.evidence` (no schema) e `LeadSourceRecord.payload`.

**Nenhuma das três existe no schema** — grep confirma que `DigitalPresence` só aparece em `LeadDigitalPresence`. **Criá-las é pré-requisito explícito**, não suposição. Foi o que a v2 e a v3 esqueceram, cada uma com um nome de tabela diferente.

### 7.2 A invariante nasce com a capability — não antes

**Esta é a correção principal da v5.**

| Sinal | Tipo hoje | Quem o produz | Invariante em |
|---|---|---|---|
| `websiteHasHttps` | **`Boolean?`** | `WEBSITE_HEALTH_AUDIT` — **F3** | **F3**, precedida da migração para `SignalState` |
| `hasInstagram`, `hasFacebook` | `SignalState` | `SOCIAL_LINK_DISCOVERY` — **F5, bloqueada** | **F5**, depois da reclassificação |
| `hasWebsite`, `hasEmail`, `hasPhone`, `hasReviews` | `SignalState` | Payload do Maps | **Não entram.** Já têm proveniência via `LeadSourceRecord`. Incluí-los valida contra dado existente e quebra a normalização que funciona |

A v4 punha a invariante em F0, cobrindo só os dois sinais sociais. Resultado: **F0 protegeria o que ninguém pode escrever, e F3 gravaria `websiteHasHttps` sem proveniência nenhuma** — o defeito que a seção existe para impedir.

**`websiteHasHttps` precisa virar `SignalState` antes**, e isso é mudança de tipo, não de constraint: `NULL` não é `DESCONHECIDO`. `NULL` é ausência de valor, e hoje "não medido" e "medido como falso" são indistinguíveis — que é exatamente o que a regra 4 do `CLAUDE.md` proíbe.

**Uma medição sustenta no máximo um sinal.** Foi por isso que `SOCIAL_LINKS` virou duas checagens: com uma medição sustentando dois sinais, revogar um derruba o outro ou é impedido pela FK.

### 7.3 O que precisa ser verdade antes de escrever qualquer migration

A v3 afirmou *"zero backfill, zero risco"* apoiada num **comentário do schema**. Comentário não é restrição — que é a tese desta seção.

| # | Pergunta | Como responder | Se a resposta for inesperada |
|---|---|---|---|
| **1** | Existe presença digital com tenant divergente do lead? | `SELECT count(*) FROM lead_digital_presences p JOIN leads l ON l.id = p."leadId" WHERE p."tenantId" <> l."tenantId";` | ≠ 0 → **há vazamento entre tenants em dado gravado hoje**, e isso muda a prioridade de tudo neste documento |
| **2** | O mesmo, em `lead_source_records` e `lead_scores` | Mesma forma, trocando a tabela | idem |
| **3** | O mesmo, em `lead_score_reasons` | **Não é "idem":** o model não tem `leadId`, só `scoreId`. A consulta passa por `lead_scores` | idem |
| **4** | Existe linha com sinal social ≠ `DESCONHECIDO`? | `SELECT count(*) FROM lead_digital_presences WHERE "hasInstagram" <> 'DESCONHECIDO' OR "hasFacebook" <> 'DESCONHECIDO';` | ≠ 0 → o `CHECK` de F5 precisa de `NOT VALID` e backfill |
| **5** | `pnpm typecheck` passa? | `pnpm typecheck` | O `CHANGELOG` já declara **dois erros de tipo**. É o item 1 da sequência do adendo |

A **pergunta 1 é a mais importante do documento**, e nenhuma das quatro versões anteriores a fez.

> Colunas em camelCase e entre aspas: o schema tem 40 `@@map` de tabela e **zero `@map` de campo**.

### 7.4 O pré-requisito estrutural que a v4 não viu

**Uma FK composta exige `UNIQUE` do lado referenciado, e nenhuma tabela-pai tem.**

`leads` tem `@@id([id])`, `@@unique([tenantId, fingerprint])` e `@@unique([tenantId, placeId])` — **não** `@@unique([tenantId, id])`. O mesmo em `tenants`, `lead_scores`, `prospecting_searches` e nos demais pais de relação com tenant.

Sem isso, tanto o Prisma quanto o PostgreSQL recusam:

```text
ERROR 42830: there is no unique constraint matching given keys for referenced table "leads"
```

**A v4 perguntava se o Prisma aceita `tenantId` como escalar de várias relações — a pergunta do lado filho, enquanto o bloqueio está no pai.** E era a única das perguntas dela cuja resposta não precisava do banco: estava no `schema.prisma` que eu já tinha lido.

**Pré-requisito, portanto:** acrescentar `@@unique([tenantId, id])` a cada tabela-pai antes de qualquer FK composta. É aditivo e barato — e é o que torna toda a §7.5 possível.

**Duas exceções que a egress §5 já registrava e a v4 declarou regra universal sem citar:** `LeadTag` e `ProposalItem` **não têm `tenantId` nenhum**. Para essas, FK composta não é a correção — é acrescentar a coluna primeiro.

**Escala:** "toda FK entre tabelas com tenant" são cerca de vinte relações, não quatro. `@@index([tenantId])` aparece também em `lead_activities`, `pipeline_transitions`, `lead_notes`, `lead_follow_ups`, `outreach_messages` e `notifications`.

### 7.5 As decisões de modelagem

1. **`LeadDigitalPresence` é projeção** — a última medição por sinal, materializada para leitura. A invariante vive no que ela projeta
2. **Cada sinal coberto ganha referência à medição que o sustenta.** `lastCheckedAt` é um carimbo para seis sinais independentes
3. **Toda FK entre tabelas com tenant é composta** — inclusive dentro da cadeia nova: `DigitalPresenceCheck.tenantId` precisa de FK composta para `DigitalPresenceAudit(tenantId, id)`. Uma FK composta prova que a linha **declara** o mesmo tenant, não que pertença a ele; só a cadeia inteira fecha
4. **A invariante é `CHECK`.** O Prisma não a modela, então não a remove no diff — **premissa não verificada sobre o comportamento do `prisma migrate diff`**, e está aqui declarada como tal
5. **As `UNIQUE` e FKs vão no `schema.prisma`** se `pnpm prisma validate` permitir; senão, para o SQL, e então **entram no runbook de migrations junto do `CHECK`**, porque o diff remove o que existe só na migration

### 7.6 A tensão que sobra

A referência da projeção para a medição cruza a fronteira CRM/Intelligence no banco. **A v2 justificava contando serviços, o que não responde à pergunta.** A justificativa é menor: uma projeção que aponta para a medição que a produziu é lineage, não acoplamento — o CRM guarda a referência e a expõe pela porta, sem ler a medição.

Custo aceito: separar bancos depois exige desfazer isto, e fica mais caro a cada lead.

---

## 8. Exclusão de titular

```text
revokeSignal(tenantId, leadId, sinal):
  numa transação —
  1. LeadDigitalPresence.<sinal>        := DESCONHECIDO
  2. LeadDigitalPresence.<sinal>Url     := NULL
  3. LeadDigitalPresence.<sinal>CheckId := NULL
  4. DELETE do DigitalPresenceCheck correspondente
  5. AuditLog — SEM before/after
```

**O passo 5 é a correção da v4.** `AuditLog` tem `before Json?` e `after Json?`, e é **append-only por desenho**. Uma revogação logada com `before: { instagramUrl: "…" }` **regrava numa tabela imutável exatamente a URL que os passos 2 a 4 apagaram** — desfazendo a exclusão como parte da rotina de fazê-la, e contra a regra 6 do `CLAUDE.md`.

O registro guarda `{ sinal, motivo, checkId }`. **Nunca o valor.**

**O que continua exposto, e a v4 não examinava:**

| Exposição | Situação |
|---|---|
| A URL no **snapshot** da home | O sanitizador da egress §3 remove `user_reviews`, `owner`, userinfo e headers — **não** links de Instagram, que são o objeto da medição. `revokeSignal` não alcança o snapshot. **Aberto** |
| Medições vencidas que **não sustentam sinal** — reprocesso, sinal já revogado, `PARTIAL` refeito | `revokeSignal` é indexada por lead+sinal e não as alcança. A política de retenção precisa de **varredura própria** por `retentionUntil`, além da rotina acima |
| Revogação em massa pela retenção muda score em silêncio | `DESCONHECIDO` não pontua. Exige `SCORE_RECALCULATED` e `LeadActivity`, senão o score muda sem o usuário ter feito nada |
| `AuditLog` append-only vs. art. 18 VI | Já registrado na egress §8. **Decisão do Product Owner** |

`ON DELETE RESTRICT` é deliberado — um `DELETE` cru deixaria o sinal `PRESENTE` sem base, o estado que a §7 existe para impedir.

---

## 9. Custo

`PlanUsage` não tem **nenhum campo em moeda**.

```typescript
interface UsageEvent {
  tenantId: string; runId: string;
  capability: Capability; providerId: string; units: number;
  estimatedCostCents: number;
  actualCostCents: number;
  /**
   * ISO 4217 — moeda em que o FORNECEDOR cobra, não a do plano do tenant.
   * A v1 as confundia ao fixar 'BRL': um tenant europeu paga em EUR
   * (`Plan.pricesByCurrency`) enquanto o provider cobra em USD. Achatar as
   * duas apaga a margem, que é a diferença.
   */
  costCurrency: string;
  success: boolean;
  /** Separado de `success`: executou, cobrou, não trouxe nada. */
  emptyResult: boolean;
  occurredAt: Date;
}
```

As colunas nascem com o modelo; a lógica do `CostGuard` espera o primeiro provider pago.

---

## 10. Orçamento de complexidade — ADR-004

**Correção da v4, que dramatizava.** O `00-REGRAS-COMUNS.md` §2 tem uma coluna **"Como estourar"**, e para serviços ela diz *"ADR com justificativa de custo/hora"*. **O ADR não quebra a regra: é o mecanismo dela.** A v4 chamava isso de "primeira vez que uma regra precisa ser quebrada", o que é falso.

**A contagem:** `apps/web`, `apps/api`, `apps/worker` e o container `gosom/google-maps-scraper` — **quatro, no teto**. PostgreSQL e Redis são os dois datastores, também no teto. O `fetcher` exigido pela egress §2.5 é o **quinto serviço**.

**O ADR-004 precisa das seis respostas que a §2 exige.** Três eu posso propor; três dependem do Product Owner:

| Exigência | |
|---|---|
| Problema | SSRF por desenho: `Lead.website` é entrada de terceiro, buscada de dentro da rede |
| Alternativas | **A** — fetcher isolado (quinto serviço) · **B** — só validação em código no worker: fica em quatro, e um bug dá acesso a 5434 e 6381 · **C** — embutir no scraper: `CLAUDE.md` regra 3 proíbe modificar o clone |
| Por que a escolhida | É a única camada que sobrevive a um bug na tabela de faixas — código valida, rede impede |
| **R$/mês** | **PO** — um container pequeno, mas o número é da conta dele |
| **Horas/mês de manutenção** | **PO** — estimativa depende de como o deploy dele funciona |
| **Estratégia de saída** | **PO** — o que reverter se o custo não se justificar |

**Sem essas três respostas, o ADR não fecha, e nada de F0 começa.**

---

## 11. Correções factuais

| Afirmação | Onde | Realidade |
|---|---|---|
| *"`proposals` não existe em `apps/api/src`"* | `PROMPT-01-EXECUTION-REPORT.md` §4 | **Existe** — verificado por listagem de `C:\ResgateProjetos\prospectai\apps\api\src` em 22/08: `account`, `admin`, `auth`, `billing`, `common`, `dashboard`, `entitlements`, `leads`, `notifications`, `outreach`, `pipeline`, `prisma`, `proposals`, `prospecting`, `redis`, `segments`, `system`, `team`. **O reviewer errou e eu propaguei sem conferir** |
| *"A fábrica de IA cai para mock; as outras duas não caem"* | v2 | A de pagamento cai igual, logando `error` em vez de `warn` |
| `StripeProvider` | v2 | É `StripePaymentProvider` |
| "69% de cobertura" | v1–v4 | **54 de 83 = 65%**, com o estrato `SEM_SITE` não medido — §4 |
| `WebsiteStatus` tem 3 estados | v1 | Tem **4** |
| Links sociais "não existem" | `GAP-ANALYSIS.md` | `LeadDigitalPresence` já tem `instagramUrl`, `facebookUrl`, `websiteHasHttps` |
| "Não há IA no caminho" | egress v1 | `AIProvider`, `GeminiAIProvider`, `OutreachMessage.model` |
| `AppSetting` escrito por Admin | v1 | *"pesos editáveis por tenant sem deploy"* — `scoring.md` §3 |
| `currency: 'BRL'` fixo | v1 | §9 |

---

## 12. Errata que este documento exige na egress policy

`SECURITY-EGRESS-POLICY-v2.md` **já foi entregue e commitada**. Três pontos deste documento a alteram, e **nenhum vale sem erratum aprovado** — a v4 os aplicou em células de tabela, que é o que a §3.1 declara inaceitável.

| # | Egress v2 diz | Este documento propõe | Situação |
|---|---|---|---|
| **E1** | §4, T2 (Alta): mitigação é **RLS** | Extensão do Prisma + FKs compostas, que **não fecham leitura** | **Requer decisão do PO.** Sem ela, vale o que está entregue: RLS |
| **E2** | §3.1: quarentena tenant-aware com payload sanitizado | Sem store; assinatura, hash, `errorCode` e tamanho na linha da execução | Proponho; **requer aprovação** |
| **E3** | §2.7: *"erro uniforme **e tempo constante**"* | Tempo constante é inatingível como escrito — igualar µs de rejeição por faixa a 10s de timeout de DNS exige padding ao teto, e o job tem 30s | **Não corto.** Fica como problema aberto, com o agravante de que o contrato da §5 entrega **TTFB como funcionalidade** — um oráculo de temporização vendido como produto. A v4 cortou isso numa célula de tabela |

---

## 13. Efeito no roadmap

| Fase | v1 | v5 |
|---|---|---|
| **ADR-004** | — | **Bloqueia F0.** Precisa das três respostas do PO — §10 |
| **F0** | 5 testes de SSRF · **P** | As 5 consultas da §7.3 · `@@unique([tenantId, id])` nos pais · FKs compostas · `fetcher` · 22 testes + **S12b (replay)** · decisão E1 · **M** |
| **F1** | Contrato, registry, router, adapter · **M** | **Deixa de existir.** Registry e router adiados; o provider pertence a F3 |
| **F2** | Snapshot e normalização | Absorvida por F3 — sem consumidor antes dela |
| **F3** | Auditoria · **G** | Igual, **mais** `DigitalPresenceAudit` e `DigitalPresenceCheck`, `audit.run`/`audit.export`, `PlanUsage.auditsCount`, migração de `websiteHasHttps` para `SignalState`, e a invariante desse sinal · **G+** |
| **F5** | Links sociais · **P** | **Bloqueada** pela reclassificação de privacidade. Quando desbloquear, traz junto `INSTAGRAM_LINK`/`FACEBOOK_LINK` no tipo e a invariante dos sinais sociais |
| **F7** | Relatório | **Depende de F5** — `IMPLEMENTATION-ROADMAP.md` tem a aresta `F5 → F7`, e o `scope-v0.2.md` §9 põe links sociais antes do PDF. Com F5 bloqueada, **F7 também está** |

**Caminho crítico:** ADR-004 → F0 → F3. **Depois de F3 o caminho está bloqueado**, e não por falta de trabalho: por uma decisão de privacidade pendente que trava F5, e F5 trava F7.

**A v4 tirava F5 do caminho e mantinha F7**, religando o grafo de um documento já entregue sem dizer que o fazia.

---

## 14. O que precisa de decisão do Product Owner

Nada abaixo é meu para decidir, e nada de F0 fecha sem elas:

1. **ADR-004** — R$/mês, horas/mês e estratégia de saída do `fetcher` (§10)
2. **E1 — RLS ou extensão do Prisma**, sabendo que a segunda não fecha o T2 (§12)
3. **E2 — quarentena sem store** (§12)
4. **Reclassificação de privacidade** de `SOCIAL_LINK_DISCOVERY`, que destrava F5 e F7 (§4)
5. **`AuditLog` append-only vs. art. 18 VI** (§8)

---

## 15. Status

```text
Quatro versões reprovadas em review adversarial. Esta é a quinta.
As correções vêm dos pareceres das anteriores.
```

O que mudou de verdade ao longo delas foram duas coisas, e nenhuma é uma linha de arquitetura:

**Da v3 para a v4, o método** — parei de escrever migration executável para um banco que não posso executar, e passei a entregar decisões e consultas de verificação.

**Da v4 para a v5, o alvo** — a invariante deixou de ser construída em F0 para sinais que ninguém pode escrever, e passou a nascer junto da capability que produz cada sinal.

**Esta versão não foi revisada.** As quatro anteriores foram, e cada uma introduziu defeitos novos ao corrigir os antigos — não há razão para supor que esta seja diferente. Antes de virar código: rodar as cinco consultas da §7.3, começando pela primeira.
