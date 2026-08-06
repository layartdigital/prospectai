# Modelo de Dados — v0.1.1

**ORM:** Prisma
**Banco:** PostgreSQL 16
**Identificadores:** CUID2 em todas as entidades

---

## 1. Princípios

**Multi-tenancy desde a primeira migration.** Toda entidade de negócio carrega `tenantId`. Não é possível acrescentar isso depois sem migração de dados dolorosa — por isso entra agora, mesmo nas tabelas que ainda não têm interface.

**Índices únicos sempre compostos com `tenantId`.** Um `place_id` pode existir em vários tenants; o que não pode é aparecer duas vezes no mesmo.

**Nada é apagado de verdade.** Exclusões são lógicas (`deletedAt`). `AuditLog` nunca é tocado.

**Tabelas sem interface existem mesmo assim.** `Proposal`, `Contract`, `Tag` e afins entram no schema para não exigir retrofit, mesmo sem rota na v0.1.1.

---

## 2. Entidades da v0.1.1

### 2.1 Identidade e acesso

| Entidade | Papel | Campos relevantes |
|---|---|---|
| `User` | Pessoa | `email` único global, `passwordHash` (Argon2), `name`, `avatarUrl` |
| `Tenant` | Organização | `name`, `slug`, `timezone`, `isDemo` |
| `Membership` | User ↔ Tenant | `role`, único em `(userId, tenantId)` |
| `RefreshToken` | Sessão | `tokenHash`, `expiresAt`, `revokedAt`, `userAgent` |

`Role`: `OWNER`, `ADMIN`, `MANAGER`, `SDR`, `VIEWER`

O refresh token é gravado como hash, nunca em claro, e rotaciona a cada uso.

### 2.2 Planos e consumo

| Entidade | Papel |
|---|---|
| `Plan` | Catálogo: `code`, `name`, `priceCents`, `limits` (JSON), `isActive` |
| `Subscription` | Vínculo tenant ↔ plano, com `status` e período |
| `PlanUsage` | Consumo por período: leads, buscas, gerações de IA, exportações |
| `OnboardingState` | Respostas das 5 etapas + `completedAt` |

`PlanCode`: `FREE`, `START`, `PRO`, `AGENCY`

`limits` como JSON evita uma coluna nova a cada limite novo. O `EntitlementService` é o **único** ponto que lê esse campo — nenhum componente ou controller consulta limite diretamente.

`PlanUsage` guarda `reserved` e `settled` separadamente: a reserva acontece ao iniciar o job, a liquidação ao terminar, com o número real de leads novos. Job que falha devolve a reserva.

### 2.3 Prospecção

| Entidade | Papel |
|---|---|
| `ProspectingSearch` | O que o usuário pediu: `niche`, `state`, `city`, `neighborhood`, `radiusKm`, `requestedCount`, filtros |
| `ScrapeJob` | Execução: `status`, `idempotencyKey`, `externalJobId`, `attempts`, `error`, timestamps, `resultCount`, `duplicateCount` |

`ScrapeJobStatus`: `PENDING`, `QUEUED`, `RUNNING`, `NORMALIZING`, `SCORING`, `COMPLETED`, `FAILED`, `CANCELLED`

Uma busca pode gerar **vários** `ScrapeJob` — o scraper tem teto de 300 segundos por job, então buscas grandes são fatiadas. `ProspectingSearch` agrega o resultado de todos.

`idempotencyKey` é único por tenant. Reenviar a mesma busca não cria job novo.

### 2.4 Leads

| Entidade | Papel |
|---|---|
| `Lead` | Entidade central, normalizada |
| `LeadSourceRecord` | Payload bruto da fonte, já higienizado |
| `LeadDigitalPresence` | Sinais, cada um com estado de três valores |
| `LeadScore` | Score atual + versão do algoritmo |
| `LeadScoreReason` | Um registro por peso aplicado |

**`Lead` — campos principais:**

```
tenantId, searchId, name, category, phoneE164, phoneRaw,
email, website, websiteStatus, addressStreet, addressNeighborhood,
addressCity, addressStateUf, addressPostalCode, latitude, longitude,
reviewCount, reviewRating, openHours (JSON), timezone,
placeId, cid, fingerprint, isFavorite, isDisqualified,
suppressedAt, lastEnrichedAt, deletedAt
```

Dois índices únicos, ambos compostos com `tenantId`:
- `(tenantId, placeId)` — quando `placeId` existe
- `(tenantId, fingerprint)` — sempre

O `fingerprint` é o hash normalizado de nome + telefone E.164 + CEP. É o que dedupllica leads sem `placeId`.

`addressStateUf` guarda a **sigla**. O scraper devolve o nome por extenso (`"São Paulo"`); a normalização converte via tabela de UF. Sem isso, filtro por estado não funciona.

**`websiteStatus`:** `SEM_SITE`, `SITE_PRECARIO`, `SITE_PROPRIO` — ver `scoring.md` §3.1.

**`LeadDigitalPresence`** — um registro por lead, com um campo por sinal usando o enum `SignalState` (`PRESENTE`, `AUSENTE`, `DESCONHECIDO`):

```
hasWebsite, hasEmail, hasPhone, hasInstagram, hasFacebook,
whatsappStatus (UNKNOWN | LIKELY | VERIFIED), lastCheckedAt
```

Na v0.1.1, `hasInstagram` e `hasFacebook` são sempre `DESCONHECIDO` — não há enriquecimento de redes. **Nunca `AUSENTE`.**

**`LeadSourceRecord`** guarda o payload bruto — mas higienizado. `user_reviews`, `user_reviews_extended` e o link de perfil em `owner` são descartados **antes** da gravação. São dados pessoais de terceiros sem finalidade comercial no produto.

### 2.5 Operação comercial

| Entidade | Papel |
|---|---|
| `PipelineStage` | Etapa configurável por tenant: `name`, `order`, `color`, `isTerminal` |
| `PipelineCard` | Lead numa etapa: `stageId`, `position`, `ownerId`, `enteredStageAt` |
| `PipelineTransition` | Histórico: etapa anterior, nova, usuário, origem, motivo |
| `LeadActivity` | Trilha automática: copiou telefone, abriu mapa, abriu WhatsApp, mudou etapa |
| `LeadContactRecord` | Contato registrado pelo usuário: canal, direção, resultado, observação |
| `LeadNote` | Observação livre, com autoria. Nunca sobrescrita |
| `LeadFollowUp` | Agendamento: `dueAt`, `channel`, `priority`, `status`, `completedAt` |
| `OutreachMessage` | Mensagem gerada por IA: canal, tom, prompt, resultado, versão, modelo |

Etapas padrão do seed: Novo, Contato Enviado, Respondeu, Reunião Agendada, Proposta Enviada, Negociação, Fechado, Perdido.

`FollowUpStatus`: `PENDING`, `COMPLETED`, `OVERDUE`, `CANCELLED`. O estado `OVERDUE` é calculado por job periódico contra o timezone do tenant, não do servidor.

`LeadActivity` é a diferença entre um CRM que registra e um que só armazena. Toda ação do usuário na ficha do lead gera um registro.

### 2.6 Sistema

| Entidade | Papel |
|---|---|
| `Notification` | `type`, `title`, `body`, `payload`, `readAt` |
| `AuditLog` | `actorId`, `action`, `entityType`, `entityId`, `before`, `after`, `ip`. **Imutável** |
| `SuppressionEntry` | Telefone ou domínio bloqueado para abordagem, com motivo |
| `AppSetting` | Configuração por tenant: pesos do score, lista de domínios precários, extras do precificador |
| `FeatureFlag` | Ativação por tenant |

`AppSetting` é o que torna o score ajustável sem deploy. Pesos, faixas e a lista de domínios de construtor gratuito vivem aqui.

---

## 3. Entidades no schema, sem interface na v0.1.1

Criadas na primeira migration porque relacionamento é caro de acrescentar depois. Sem rota, sem menu, sem tela.

| Entidade | Interface em |
|---|---|
| `Proposal`, `ProposalItem` | v0.2 |
| `Contract` | v0.2 |
| `ExportJob` | v0.2 (o CSV da v0.1.1 é síncrono) |
| `Tag`, `LeadTag` | v0.2 |

---

## 4. Deduplicação

Ordem de decisão, ao processar cada lead bruto:

1. **`placeId` existe e já está no tenant?** → atualiza o lead, marca como duplicado, **não consome cota**
2. **Fingerprint já existe no tenant?** → mesmo tratamento
3. **Nenhum dos dois** → cria lead novo, consome 1 crédito

O `fingerprint` é `sha256(nome_normalizado + telefone_e164 + cep)`. Normalização do nome: minúsculas, sem acento, sem pontuação, sem sufixos societários (ltda, me, eireli, s/a).

**Idempotência do job:** reprocessar um `ScrapeJob` concluído não pode criar lead novo nem cobrar de novo. A chave é `(tenantId, source, sourceId)`.

Isso é asserção de teste de integração, não boa intenção: rodar a mesma busca duas vezes deve resultar em `duplicateCount` igual ao total e `PlanUsage` inalterado.

---

## 5. Isolamento entre tenants

Três camadas, porque uma só é frágil:

1. **`TenantGuard`** — resolve o tenant da sessão ou do header `x-tenant-id`, e valida o `Membership`. `tenantId` vindo no body é **sempre ignorado**.
2. **Contexto no repositório** — todo método recebe o contexto do tenant. Não existe query de entidade de negócio sem filtro por `tenantId`.
3. **Teste automatizado** — o tenant A tenta ler, editar e apagar recursos do tenant B por ID direto. Todos devem retornar 404, nunca 403. Retornar 403 já confirma que o recurso existe.

---

## 6. Ordem das migrations

1. `init` — User, Tenant, Membership, RefreshToken, Plan, Subscription, PlanUsage, OnboardingState
2. `prospecting` — ProspectingSearch, ScrapeJob
3. `leads` — Lead, LeadSourceRecord, LeadDigitalPresence, LeadScore, LeadScoreReason
4. `pipeline` — PipelineStage, PipelineCard, PipelineTransition
5. `activity` — LeadActivity, LeadContactRecord, LeadNote, LeadFollowUp, OutreachMessage
6. `system` — Notification, AuditLog, SuppressionEntry, AppSetting, FeatureFlag
7. `future` — Proposal, ProposalItem, Contract, ExportJob, Tag, LeadTag

Cada migration precisa rodar limpa a partir de banco vazio. O seed é idempotente e pode rodar quantas vezes for.
