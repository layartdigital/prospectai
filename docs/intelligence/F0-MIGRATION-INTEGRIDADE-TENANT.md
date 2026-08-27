# F0 — Plano de migration: integridade de tenant · v2

**Data:** 23/08/2026 · **Origem:** `PROVIDER-CONTRACT-v5.md` §7.4 · `gate0/verificacoes-f0.sql`
**Substitui:** a v1 deste plano, reprovada em review adversarial

**Declaração obrigatória (`CLAUDE.md`, Qualidade):** `F:\drmind` não foi modificado. Nenhum recurso Docker foi tocado.

---

## 0. O que a v1 errou

| # | Defeito | Correção |
|---|---|---|
| **A** | Mediu **4** tabelas e incluiu **5** na migration. `pipeline_transitions` entrou sem nunca ter sido olhado | §6.1 — mede antes, e a fatia 2 só existe depois |
| **B** | O backfill do `lead_tags` "vem do lead" — mas se lead e tag divergirem, **nenhum** valor satisfaz as duas FKs. Escolher lado só decide qual estoura | §5.3 e §6.1 — a pergunta certa é divergência, e a saída é remover a linha |
| **C** | Declarou *"vira estrutura nas cinco tabelas"* deixando `scrapeJob` e as duas etapas abertos | §2.2 — o que fica aberto está nomeado e medido |
| **D** | Disse que a única incerteza era o `LeadTag`. **Três relações 1-1 têm risco de validador próprio** | §5.2 e §7 |
| **E** | Pôs o `typecheck` **depois** de aplicar a migration | §6 — a ordem correta é gerar client, checar tipos, e só então tocar no banco |
| **F** | Previu o SQL do Prisma sem nunca tê-lo gerado — faltavam `ON UPDATE CASCADE`, as duas FKs do `lead_tags`, o índice, e os índices de suporte | §6.4 — o SQL previsto sai; entra o que conferir nele |
| **G** | Plano B punha constraint fora do schema, criando um **sexto** órfão que o próximo `migrate dev` derruba | §7 — se o validador recusar, `LeadTag` sai da migration |
| **H** | Erratum E7 tirava `ProposalItem` da egress policy por critério de integridade, sendo que a mitigação sobrevivente é RLS, que precisa da coluna | §3 |

---

## 1. O que a medição de 22/08 mostrou

| Verificação | Resultado |
|---|---|
| `tenantId` divergente do pai em `lead_digital_presences`, `lead_source_records`, `lead_scores`, `lead_score_reasons` | **0** |
| `@@unique([tenantId, id])` em alguma tabela-pai | **Nenhuma** |
| `lead_tags` / `proposal_items` com `tenantId` | **Nenhuma coluna** |

**As duas primeiras juntas são a boa notícia:** nas quatro medidas, o dado está limpo, e a constraint pode ser criada sem corrigir nada antes.

> 25 linhas de presença digital é amostra pequena. Prova que a constraint **pode ser criada**, não que a aplicação esteja correta — e a constraint é o que passa a garantir a segunda coisa.

---

## 2. O escopo real

### 2.1 São cinco modelos, não vinte

A v5 do Provider Contract estimou *"cerca de vinte relações"*. Varrendo os **30** modelos com `tenantId`:

| `tenantId` tem FK para `Tenant`? | Quantos |
|---|---|
| **Sim** | 25 |
| **Não — coluna solta** | **5**: `LeadSourceRecord`, `LeadDigitalPresence`, `LeadScore`, `LeadScoreReason`, `PipelineTransition` |

Nesses cinco, `tenantId` é `String` com índice e nada mais.

> Ressalva: `AuditLog.tenantId` é `String?` com `onDelete: SetNull`. Ele tem FK, mas aceita nulo — está fora deste plano e não é órfão.

### 2.2 O que este plano fecha, e o que deixa aberto

**Fechar pela metade e chamar de fechado foi o defeito C da v1.** A lista honesta:

| Relação | Nesta migration? |
|---|---|
| `LeadSourceRecord` → `Lead` | **Sim** |
| `LeadDigitalPresence` → `Lead` | **Sim** |
| `LeadScore` → `Lead` | **Sim** |
| `LeadScoreReason` → `LeadScore` | **Sim** |
| `LeadTag` → `Lead` **e** → `Tag` | Fatia 2 — §7 |
| `PipelineTransition` → `PipelineCard` | Fatia 2 — depende da medição §6.1 |
| `LeadSourceRecord` → `ScrapeJob` | **Não.** Fica aberto: um registro do Tenant A pode apontar para um job do Tenant B, vazando a `keyword` da busca |
| `PipelineTransition` → `fromStage` / `toStage` | **Não.** Fica aberto: o nome da etapa do funil do concorrente aparece no histórico do card |
| `PipelineCard` → `PipelineStage` | **Não.** Fica aberto: card vivendo numa coluna de outro tenant |
| `Proposal` → `Lead`, `Contract` → `Proposal` | **Não.** Encontrado na revisão deste plano. `Proposal.leadId` é FK simples com `onDelete: SetNull`, e a tela de proposta renderiza o lead |

**As quatro últimas linhas são vazamentos reais, medidos pelo `verificacoes-f0b.sql`, e não resolvidos aqui.** Ficam registrados como item próprio, não como "segunda ordem" — a v1 usou esse rótulo para não olhar.

---

## 3. `LeadTag` sim; `ProposalItem` é outra conversa

```prisma
model LeadTag {
  leadId String
  tagId  String
  lead Lead @relation(fields: [leadId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId],  references: [id], onDelete: Cascade)
  @@id([leadId, tagId])
}
```

**`LeadTag` é junção de verdade — dois pais, cada um com seu tenant.** Nada impede uma linha ligando um `Lead` do Tenant A a uma `Tag` do Tenant B: o nome da tag de um concorrente na tela do outro.

`ProposalItem` tem um pai só (`Proposal`), e herda o tenant sem ambiguidade. **Não há divergência representável — logo, não há vazamento de integridade.**

**Mas isso não o tira da egress policy, e a v1 o tirava.** A `SECURITY-EGRESS-POLICY-v2.md` §5 trata de **leitura**, e a mitigação viva é RLS ou extensão do Prisma. Sem coluna `tenantId`, a policy de RLS em `proposal_items` vira subquery por linha (`EXISTS (SELECT 1 FROM proposals ...)`) — mais cara e não indexável — e uma extensão do Prisma não tem o que exigir.

> **Erratum E7, corrigido:** `ProposalItem` **não** sai da lista da egress policy §5. O que muda é a justificativa: ele entra por necessidade de **leitura**, não de integridade, e a decisão pertence ao E1 (RLS ou extensão). Chamar `LeadTag` e `ProposalItem` de "junções" era impreciso — só o primeiro é.

---

## 4. O que este plano NÃO faz

| Item | Por quê |
|---|---|
| `CHECK` de evidência nos sinais | **F3 e F5** — a invariante nasce com a capability (`PROVIDER-CONTRACT-v5.md` §7.2) |
| `websiteHasHttps` → `SignalState` | **F3.** Hoje o campo vem de `startsWith('https://')`, e o `scoring-engine.ts` é honesto: grava a evidência como `'website inicia com http://'`. Só vira mentira se a migração mapear `true → PRESENTE` |
| Tabelas `DigitalPresenceAudit` / `DigitalPresenceCheck` | **F3** — não têm consumidor antes do verificador |

**Uma migration, um propósito.** Misturar mudança de tipo com mudança de integridade torna o rollback impossível de raciocinar.

---

## 5. As mudanças no `schema.prisma`

### 5.1 Nos quatro pais

```prisma
model Lead         { @@unique([tenantId, id]) }   // NOVO
model LeadScore    { @@unique([tenantId, id]) }   // NOVO
model PipelineCard { @@unique([tenantId, id]) }   // NOVO — fatia 2
model Tag          { @@unique([tenantId, id]) }   // NOVO — fatia 2
```

Sem isso, nenhuma FK composta existe: `ERROR 42830: there is no unique constraint matching given keys`.

> `LeadScore` aparece aqui **e** na §5.2 de propósito: é filho de `Lead` e pai de `LeadScoreReason`. A cadeia `lead_score_reasons(tenantId,scoreId) → lead_scores(tenantId,id) → leads(tenantId,id)` é válida, e o cascade encadeia.

### 5.2 Fatia 1 — os quatro filhos do caminho de lead

```prisma
model LeadSourceRecord {
  lead Lead @relation(fields: [tenantId, leadId], references: [tenantId, id], onDelete: Cascade)
  @@unique([tenantId, leadId])          // NOVO — ver aviso abaixo
  // scrapeJob permanece simples; §2.2 registra o que isso deixa aberto
}

model LeadDigitalPresence {
  lead Lead @relation(fields: [tenantId, leadId], references: [tenantId, id], onDelete: Cascade)
  @@unique([tenantId, leadId])          // NOVO
}

model LeadScore {
  lead Lead @relation(fields: [tenantId, leadId], references: [tenantId, id], onDelete: Cascade)
  @@unique([tenantId, leadId])          // NOVO
}

model LeadScoreReason {
  score LeadScore @relation(fields: [tenantId, scoreId], references: [tenantId, id], onDelete: Cascade)
}
```

**O `@@unique([tenantId, leadId])` não é decorativo, e a v1 não o tinha.**

O Prisma decide se uma relação é 1-1 ou 1-n olhando se **o conjunto exato de campos escalares da relação** é único. Com `fields: [tenantId, leadId]`, o conjunto é `(tenantId, leadId)` — e `leadId @unique` sozinho não satisfaz isso, ainda que o torne único no banco. Sem o `@@unique` composto, o validador tende a degradar a relação para 1-n, e aí `Lead.digitalPresence`, `Lead.score` e `Lead.sourceRecord` precisariam virar listas — quebrando `lead.score.value` em todo o código.

`leadId @unique` **permanece** nos três: continua verdade que um lead tem no máximo um de cada.

### 5.3 Fatia 2 — `LeadTag` e `PipelineTransition`

```prisma
model LeadTag {
  tenantId  String                       // NOVO
  leadId    String
  tagId     String
  createdAt DateTime @default(now())

  lead Lead @relation(fields: [tenantId, leadId], references: [tenantId, id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tenantId, tagId],  references: [tenantId, id],  onDelete: Cascade)

  @@id([leadId, tagId])
  @@index([tenantId])
  @@map("lead_tags")
}

model PipelineTransition {
  card PipelineCard @relation(fields: [tenantId, cardId], references: [tenantId, id], onDelete: Cascade)
}
```

**As duas FKs do `LeadTag` partilham `tenantId`, e é isso que força lead e tag ao mesmo tenant** — a divergência deixa de ser representável.

**`@@id([leadId, tagId])` permanece.** `leadId` já identifica o lead globalmente; acrescentar `tenantId` à chave primária mudaria o nome da chave composta gerada de `leadId_tagId` para `tenantId_leadId_tagId`, quebrando toda chamada com `where: { leadId_tagId: {...} }`. As duas FKs já impedem mover a linha para outro tenant.

---

## 6. A sequência

**A ordem mudou da v1, e é a correção mais importante deste plano.** O client do Prisma se regenera a partir do **schema**, não do banco — dá para ver todos os erros de tipo antes de tocar em Postgres.

### 6.1 Medir o que faltou

```powershell
docker cp .\gate0\verificacoes-f0b.sql propectai-postgres:/tmp/v2.sql
docker exec propectai-postgres psql -U propectai -d propectai -f /tmp/v2.sql
```

| Resultado | Consequência |
|---|---|
| `transition vs card` = 0 | `PipelineTransition` entra na fatia 2 |
| `transition vs card` > 0 | **Corrigir o dado primeiro.** A FK abortaria a migration inteira |
| `lead_tags` divergentes = 0 linhas | O backfill a partir do lead é seguro |
| `lead_tags` divergentes > 0 | **`LeadTag` sai desta migration.** Cada linha precisa de decisão — remover ou reatribuir. Nenhum `tenantId` satisfaz as duas FKs |
| Bloco 6 (nomes de constraint) | São os nomes que o `DROP CONSTRAINT` vai usar. Se divergirem de `<tabela>_<coluna>_fkey`, o SQL gerado precisa ser conferido linha a linha |

### 6.2 Editar o schema, validar, e checar tipos — sem tocar no banco

```powershell
# depois de aplicar a §5
pnpm prisma validate
pnpm prisma generate
pnpm typecheck ; pnpm typecheck:tests ; pnpm typecheck:scripts
```

**Espere erros de tipo aqui. Não é "se quebrar" — quebra, e de quatro formas:**

| Forma | Onde aparece |
|---|---|
| **Escrita aninhada perde `tenantId`.** `lead.create({ data: { ..., digitalPresence: { create: { tenantId, ... } } } })` deixa de compilar: o campo sai do input `...WithoutLeadInput` | seeds, pipeline de ingestão |
| **`connect` exige a chave composta.** `connect: { id }` vira `connect: { tenantId_id: { tenantId, id } }` | qualquer escrita relacional |
| **Misturar escalar e relação colapsa o `XOR`.** `{ tenantId, lead: { connect: ... } }` produz `not assignable to type 'never'`, com mensagem que não aponta a causa | idem |
| **`LeadTag` ganha campo obrigatório.** `leadTag.create({ data: { leadId, tagId } })` para de compilar | fatia 2 |

`prisma.leadDigitalPresence.create({ data: { tenantId, leadId, ... } })` **continua compilando** — resolve para o input *unchecked*, que preserva escalares. É o caso que engana: parte do código passa, parte não.

**Corrija todos os call sites com o banco ainda intacto.** Só então siga.

### 6.3 Backup

O projeto já perdeu dados exatamente aqui:

> *"Migration aplicada não se edita, se substitui. (...) o Prisma detectou o checksum diferente e a única saída que ele conhece é recriar o schema. Custou os dados de demonstração e um `db:seed`. **Em produção teria custado a base.**"*

```powershell
docker exec propectai-postgres pg_dump -U propectai -d propectai -Fc -f /tmp/pre-f0.dump
docker cp propectai-postgres:/tmp/pre-f0.dump .\gate0\pre-f0.dump
```

### 6.4 Gerar sem aplicar, e ler

```powershell
pnpm prisma migrate dev --create-only --name f0_integridade_tenant
```

**A v1 previa o SQL. Não vou prever de novo — não tenho Prisma aqui, e prever foi o defeito F.** O que conferir no arquivo gerado:

| Conferir | Esperado |
|---|---|
| `CREATE UNIQUE INDEX` | Um por pai da §5.1 |
| `DROP CONSTRAINT` | Os nomes que o bloco 6 da §6.1 devolveu — **não os que eu supus** |
| `ADD CONSTRAINT ... FOREIGN KEY` | Um por filho. `ON UPDATE CASCADE` junto do `ON DELETE` é normal, não é anomalia |
| `lead_tags` | `ADD COLUMN`, **e as duas FKs**, **e** `CREATE INDEX ..._tenantId_idx` |
| Índices de suporte | O Postgres **não** cria índice para a coluna referenciante, e o Prisma também não. `lead_score_reasons` fica com `@@index([scoreId])` e `@@index([tenantId, code])`, e **nenhum serve `(tenantId, scoreId)`**. Acrescente `@@index([tenantId, scoreId])` no schema — em 25 linhas é irrelevante, e é justamente o que degrada com crescimento |

**Se aparecer, PARE:** `DROP TABLE`, `DROP COLUMN` inesperado, menção a `_prisma_migrations`, ou o aviso `We need to reset the database`.

### 6.5 O ponto que exige edição à mão

`ALTER TABLE "lead_tags" ADD COLUMN "tenantId" TEXT NOT NULL` falha se houver linha — não há default. Substitua por três passos, **antes de aplicar**:

```sql
ALTER TABLE "lead_tags" ADD COLUMN "tenantId" TEXT;

UPDATE "lead_tags" lt
   SET "tenantId" = l."tenantId"
  FROM "leads" l
 WHERE l."id" = lt."leadId";

ALTER TABLE "lead_tags" ALTER COLUMN "tenantId" SET NOT NULL;
```

Linha órfã é impossível: `leadId` já tem FK `ON DELETE CASCADE` para `leads`. E o backfill só é seguro porque a §6.1 confirmou que não há divergência — **se houvesse, este `UPDATE` produziria um estado que a segunda FK recusa.**

> Editar aqui é seguro: **a migration ainda não foi aplicada.** O que o CHANGELOG proíbe é editar migration já aplicada.

### 6.6 Aplicar e confirmar

```powershell
pnpm prisma migrate dev
docker exec propectai-postgres psql -U propectai -d propectai -f /tmp/v.sql
docker exec propectai-postgres psql -U propectai -d propectai -f /tmp/v2.sql
pnpm test
```

`typecheck` já passou na §6.2 — aqui o que importa é a suíte. Falha nela significa código gravando `tenantId` inconsistente, e **o teste está certo**.

---

## 7. A incerteza, e o que fazer com cada resposta

`pnpm prisma validate` é o gate de **todo** o §5, não só da fatia 2 — foi o defeito D da v1 tratá-lo como pergunta isolada.

| Resultado | Ação |
|---|---|
| Valida tudo | Fatia 1 e 2 na mesma migration |
| Recusa relação 1-1 nos três filhos | Falta o `@@unique([tenantId, leadId])` da §5.2. A mensagem cita o campo em `Lead` |
| Recusa reuso de `tenantId` em duas relações (`LeadTag`) | **`LeadTag` sai da migration**, e vira item próprio |
| Recusa reuso em `PipelineTransition` | Só ocorre se as etapas forem fechadas junto — não são, aqui ele usa `tenantId` uma vez só |

**Sobre o plano B da v1 — pôr a constraint composta em SQL manual fora do schema: descartado.** O `prisma migrate dev` monta o shadow database a partir dos arquivos de migration, compara com o `schema.prisma`, encontra uma constraint não declarada e emite `DROP CONSTRAINT` — na próxima migration qualquer, feita por qualquer motivo. E deixaria `lead_tags` com um `tenantId` sem relação: **um sexto órfão, criado para fechar um vazamento.**

**Fatie em vez disso.** Fatia 1 primeiro; ela não depende de nada incerto.

---

## 8. Custo e reversão

| | |
|---|---|
| **Fatia 1** | 2 índices únicos, 4 FKs trocadas, 3 `@@unique` compostos |
| **Fatia 2** | 2 índices únicos, 3 FKs (2 do `LeadTag`, 1 do `PipelineTransition`), 1 coluna com backfill, 1 índice |
| **Tempo** | Segundos. `lead_digital_presences` tem 25 linhas; `lead_tags` ainda não foi contada — bloco 3 da §6.1 |
| **Reversão** | `DROP CONSTRAINT`, `DROP INDEX`, `DROP COLUMN`. Nenhum dado se perde — mas o código já corrigido na §6.2 continua exigindo o schema novo |
| **Risco maior** | O `migrate dev` decidir resetar por drift. Daí o backup e o `--create-only` |

---

## 9. O que muda depois

**Nas quatro tabelas da fatia 1, a invariante de tenant deixa de ser disciplina e vira estrutura.** É pré-requisito declarado da `SECURITY-EGRESS-POLICY-v2.md` §5 e da invariante de evidência de F3 e F5 — nenhuma podia ser construída antes.

**O que isto não fecha, e dizer que fecha seria o erro da v3 do Provider Contract:**

- **O T2 da egress policy é sobre leitura.** FK não filtra `SELECT`. Continua valendo a decisão E1 — RLS ou extensão do Prisma
- **As quatro relações da §2.2** ficam abertas, agora medidas e nomeadas
- **`Proposal.leadId`** é vazamento encontrado durante a revisão deste plano, e não estava em documento nenhum
