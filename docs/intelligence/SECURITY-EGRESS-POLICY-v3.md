# SECURITY — Egress Policy e Threat Model · v3

**Produto:** **PropectAI**
**Data:** 23/08/2026 · **Prioridade:** P0, pré-requisito da Fase 1 da auditoria
**Substitui:** `SECURITY-EGRESS-POLICY-v2.md`, que foi commitada com sete erros descobertos depois

**Declaração obrigatória (`CLAUDE.md`, Qualidade):** `F:\drmind` não foi modificado. Nenhum recurso Docker foi tocado.

---

## 0. O que mudou da v2

A v1 errou a tabela de faixas — seis contornos. A v2 corrigiu a tabela e errou o ambiente: descreveu um isolamento de rede contra portas que não existem dentro do Docker, num profile que não roda, num modo de desenvolvimento onde não há rede para isolar.

| # | O que a v2 dizia | Realidade verificada | Onde |
|---|---|---|---|
| **E4** | O fetcher não pode ter rota para **5434 e 6381** | São portas **do host**. Dentro da rede, o worker fala com `postgres:5432`, `redis:6379`, `gmaps-scraper:8080` | §2.5, §9 |
| **E5** | O isolamento de rede protege a coleta | Em `pnpm dev` **não existe rede para isolar** — `api`, `worker` e `web` rodam no host | §2.6 |
| **E6** | Os 22 testes são de F0 | **S10 sai** — depende de `--profile full`, que não pode rodar: `infra/docker/` não existe. S11 fica, sem a parte de tempo | §9 |
| **E7** | *"Junções `LeadTag` e `ProposalItem` não têm `tenantId`"* | Só `LeadTag` é junção. `ProposalItem` entra por outro motivo | §5.3 |
| **E8** | Quarentena tenant-aware com payload sanitizado | Store próprio cortado; drift por assinatura de forma, **calculada depois do filtro** | §3.1 |
| **E9** | *"Erro uniforme **e tempo constante**"* | Tempo constante **não foi cortado** — virou problema aberto, e o conflito real é auto-DoS, não o orçamento do job | §2.8 |
| **E10** | FK composta `(tenantId, id)` é pré-requisito | **Feito em 23/08.** Migration `20260823131105_f0_integridade_tenant` | §5.1 |

**A lição das três versões, e ela é sobre método:** as duas primeiras descreveram a infraestrutura de memória. A v3 é a primeira escrita depois de ler o `docker-compose.yml` e consultar o banco.

> **Sobre a numeração.** E4 a E10 continuam a série do `ADR-004`. O `PROVIDER-CONTRACT-v5.md` §12 abriu uma série própria E1–E3 para as mesmas correções, e **as duas se sobrepõem**: v5-E2 é o E8 daqui, v5-E3 é o E9. Onde este documento diz *"decisão E1"*, refere-se ao **E1 do v5** — RLS ou extensão do Prisma. Séries paralelas foram erro de organização; a partir daqui vale a numeração deste documento.

---

## 1. Por que este documento é pré-requisito

A Fase 1 busca URL vinda de `Lead.website`, campo preenchido com o que a empresa cadastrou no Google Maps — string controlada por terceiro.

**SSRF por desenho, não por descuido.** O ataque: cadastrar lead com `website = http://[fd00:ec2::254]/latest/meta-data/iam/security-credentials/`, clicar em auditar, e o worker busca o endpoint de metadados de dentro da rede.

O `scope-v0.2.md` §8 trata o risco com User-Agent identificável, timeout e `robots.txt`. Os três são boa cidadania de crawler e **nenhum protege a infraestrutura**.

---

## 2. Egress policy

### 2.1 Faixas bloqueadas — validação pós-resolução

**Normalizar antes de comparar.** IPv4-mapped e IPv4-compatible viram IPv4 e passam pela tabela IPv4. Sem essa etapa, `::ffff:7f00:1` escapa das duas.

**IPv4**

| Faixa | Motivo |
|---|---|
| `0.0.0.0/8` | Não especificado |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC1918 |
| `100.64.0.0/10` | CGNAT |
| `127.0.0.0/8` | Loopback |
| `169.254.0.0/16` | Link-local — **metadados de cloud** |
| `192.0.0.0/24`, `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | Reservados e documentação |
| `198.18.0.0/15` | Benchmark |
| `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255/32` | Multicast, reservado, broadcast |

**IPv6 — a lacuna que derrubou a v1**

| Faixa | Motivo |
|---|---|
| `::/128`, `::1/128` | Não especificado, loopback |
| **`fc00::/7`** | **ULA — equivalente IPv6 do RFC1918. Contém `fd00:ec2::254`, o IMDS da AWS. Docker com IPv6 atribui `fd00::/8` aos containers** |
| `fe80::/10` | Link-local |
| `::ffff:0:0/96` | IPv4-mapped — normalizar e revalidar |
| `::/96` | IPv4-compatible, obsoleto |
| **`64:ff9b::/96`** | **NAT64 well-known — carrega IPv4 embutido** |
| **`2002::/16`** | **6to4 — idem** |
| `ff00::/8` | Multicast |
| **`fec0::/10`** | **Site-local, obsoleto pela RFC 3879 — E11** |
| **`2001:db8::/32`** | **Documentação — análogo de `192.0.2.0/24` — E11** |
| **`2001:2::/48`** | **Benchmark — análogo de `198.18.0.0/15` — E11** |
| **`100::/64`** | **Discard-only — E11** |

Rejeitar também literais com identificador de zona (`[fe80::1%25eth0]`).

> **Erratum E11 — a tabela IPv6 foi traduzida da IPv4 pela metade.** As quatro últimas linhas foram encontradas por sonda adversarial **depois** de os testes da implementação passarem, em 24/08. Três delas são análogos diretos de faixas que a tabela IPv4 já bloqueava desde a v1 — documentação, benchmark, descarte —, e a ausência tem uma causa só: a tabela nasceu olhando IPv4 e a coluna IPv6 foi preenchida com o que veio à cabeça.
>
> `fec0::/10` é o caso que importa: é o antecessor do ULA, obsoleto **e ainda roteado por sistemas antigos**. "Obsoleto" não é "inalcançável".
>
> A lição é sobre método, não sobre a faixa: **teste que passa prova que os casos escritos estão certos, não que a lista está completa.** Os seis contornos da v1 vieram de revisão adversarial; estes quatro vieram de sondar formas que ninguém tinha listado. As duas técnicas encontram coisas diferentes, e nenhuma substitui a outra.

### 2.2 Regras de resolução

1. **Validar todos os endereços retornados**, não o primeiro. Se a resolução devolver `[203.0.113.5, 127.0.0.1]`, rejeitar — o Happy Eyeballs do Node tenta os demais
2. **Conectar ao IP validado**, passando o hostname só em `Host` e SNI. Elimina a janela TOCTOU do rebinding
3. **Fail-closed** em NXDOMAIN, SERVFAIL ou timeout de DNS

> A "opção 2" da v1 — cachear e revalidar — foi removida. Contra um autoritativo com TTL 0, o atacante ganha por construção.

### 2.3 Redirect

Nunca automático. A cada salto: revalidar **IP, scheme e porta**, resolver `Location` relativo, máximo 3 saltos, e limite de tempo total do job.

### 2.4 Limites de resposta

| Limite | Valor | Observação |
|---|---|---|
| Timeout por requisição | 10s | |
| Tempo total do job | 30s | Cobre a cadeia de redirect |
| **Tamanho comprimido** | 5 MB | Corte no fluxo |
| **Tamanho descomprimido** | 10 MB | **Corte após inflar** — 2 MB de gzip viram 40 GB sem isto |
| `Content-Encoding` aninhado | Rejeitar | |
| Schemes | `http`, `https` | Inclusive após redirect |
| Portas | 80, 443 | Testar isoladamente |

### 2.5 Isolamento de rede — corrigido contra o compose real

`CURRENT / CONFIRMED` — `docker-compose.yml`.

**Erratum E4.** A v2 dizia que o fetcher não pode alcançar **5434 e 6381**. Esses números são o mapeamento no host, e existem só porque 5432 e 6379 pertencem ao Bellvia:

```yaml
ports: ["127.0.0.1:${POSTGRES_PORT:-5434}:5432"]
ports: ["127.0.0.1:${REDIS_PORT:-6381}:6379"]
```

Dentro da rede Docker os alvos são **`postgres:5432`, `redis:6379` e `gmaps-scraper:8080`** — é o que os blocos `api` e `worker` declaram em `DATABASE_URL`, `REDIS_URL` e `SCRAPER_BASE_URL`.

> **Ressalva que a v3 quase repetiu:** esses três blocos estão sob `profiles: ["full"]`, que **nunca rodou** (§2.6). Portanto isto descreve a configuração de produção declarada, não um processo em execução. **O alvo do isolamento depende do ambiente**, e confundir os dois foi o erro que a §9 corrige.

Este repositório já documentou esse modo de falha, no `CHANGELOG.md` de 31/07, sobre o healthcheck do scraper:

> *"Se o `wget` existisse, o teste teria passado sem nunca verificar nada — falso positivo é pior que o falso negativo que estávamos vendo."*

E o comentário no próprio `docker-compose.yml` conclui: *"Healthcheck que grita falso ensina o time a ignorar o sinal."*

**E só existe uma rede.** `propectai-network`, bridge, com os **seis** serviços declarados dentro — os três que rodam e os três do profile `full`. Não há fronteira nenhuma hoje: o isolamento precisa ser **criado**, não configurado. O desenho, e o ADR-004 decide se e quando:

```text
┌─────────────────┐        ┌──────────────────────┐
│ worker (BullMQ) │──URL──►│ fetcher              │
│ propectai-      │        │ propectai-egress     │
│   network       │◄─bytes─│ sem DSN, sem rota    │
│ + egress        │        │ para a rede interna  │
└─────────────────┘        └──────────────────────┘
```

O worker habita as duas redes. Isso é seguro: o problema nunca foi o worker ter egress — foi **quem busca a URL hostil** ter credencial de banco.

> **Efeito colateral registrado:** `propectai-network` é bridge comum, então `postgres`, `redis` e o scraper **têm saída para a internet hoje**. Marcá-la `internal: true` fecharia isso, mas o scraper a habita e precisa de internet. Fora de escopo deste documento.

### 2.6 Em desenvolvimento não há isolamento nenhum

**Erratum E5.** `CURRENT / CONFIRMED` — `docker-compose.yml`, cabeçalho e `profiles`.

> *"Modo híbrido de desenvolvimento: este compose sobe apenas Postgres, Redis e o scraper. Web, API e worker rodam local com `pnpm dev`. Os serviços de aplicação existem sob o profile `full` para produção."*

E o profile `full` **não pode rodar**: ele constrói a partir de `infra/docker/api.Dockerfile`, `worker.Dockerfile` e `web.Dockerfile`, e a pasta `infra/docker/` não existe. O conteúdo de `infra/` é um script PowerShell.

| Ambiente | Camadas ativas |
|---|---|
| **Produção** (não existe ainda) | Isolamento de rede **e** validação em código |
| **Desenvolvimento** (`pnpm dev`) | **Só validação em código** |

**E é em desenvolvimento que a Fase 1 vai ser escrita e testada.** Enquanto for só desenvolvimento, isso é adequado — não há infraestrutura de produção a proteger. O que não pode é o teste de isolamento passar por ausência de rede e ser lido como presença de controle.

### 2.7 Rate limit de egress por tenant

Sem ele, 5.000 leads apontando para uma vítima transformam o produto em amplificador de DDoS — com User-Agent identificável, que a §8 do escopo pede justamente para a vítima poder identificar a origem.

**Requer `tenantId` no contrato do provider**, e é por isso que `SiteAuditInput.tenantId` é obrigatório (`PROVIDER-CONTRACT-v5.md` §5). Sem ele o controle existe no documento e não no código.

### 2.8 Erro uniforme, e o problema aberto do tempo

**Erratum E9.** A v2 exigia *"erro uniforme **e tempo constante** para todo destino rejeitado"*. Um rascunho posterior cortou o tempo constante numa célula de tabela. **Nenhum dos dois está certo.**

**Erro uniforme: obrigatório e implementável.** Mesmo código, mesma mensagem, para bloqueado, NXDOMAIN, recusado e timeout.

**Tempo constante: exigência real, e o conflito não é o que a v3 escreveu primeiro.**

Correção de uma análise errada minha: eu disse que *"três saltos de redirect com padding estouram os 30s"*. **Não estouram.** Rejeição encerra o job — numa cadeia, os saltos que passam são fetches reais e no máximo **um** é rejeitado. O custo é `tempo real + um padding`, nunca três. E o teto do padding não são os 30s do job: é o pior caso das **rejeições**, que é o timeout de DNS — valor que, aliás, **não está especificado na §2.4** e precisa estar.

**O conflito real é outro, e é pior.** Padding constante no teto de rejeição, cruzado com a §2.2 regra 3 (fail-closed em NXDOMAIN e SERVFAIL), dá isto: 5.000 leads com `website` apontando para hosts inexistentes prendem uma vaga de concorrência do worker pelo tempo do padding **cada**, sem que um byte seja buscado. **Tempo constante vira alavanca de auto-DoS, acionável por quem consegue cadastrar lead** — a mesma entrada hostil do §1.

**Não corto, e não finjo que está resolvido.** Fica como problema aberto, com o agravante de que a auditoria **entrega TTFB como funcionalidade**: um oráculo de temporização vendido como produto.

Saídas possíveis, nenhuma escolhida e nenhuma avaliada contra o auto-DoS acima: piso de latência por rejeição bem abaixo do teto; rejeição em fila separada com concorrência própria; ou aceitar o mapeamento de rede interna como risco documentado — **o que hoje não é defensável**, porque a Parte 1 do ADR-004 decidiu `FETCHER_MODE=inline`, e sem isolamento de processo o oráculo aponta para algo real.

---

## 3. PII e segredo: antes do snapshot

A v1 afirmava *"PII de terceiro nunca entra no banco"* e gravava o snapshot **antes** de normalizar, com o filtro na normalização.

```text
v1 (errado)   fetch → SNAPSHOT → validate → normalize(filtra PII) → persist
                        ▲ PII já no banco

v3 (correto)  fetch → sanitize → SNAPSHOT → validate → normalize → persist
                        ▲ filtro de ingestão
```

**Isto é a convenção do projeto, não ideia nova.** O `RawLead` de `packages/types/src/lead-source.ts` já traz:

> *"user_reviews, user_reviews_extended e o link de perfil em owner são **DESCARTADOS antes de chegar aqui**."*

O sanitizador roda entre o fetcher e qualquer gravação, e remove os campos da regra 6, **userinfo de URL** (`https://user:token@host/` nunca chega a `sourceReference`), `Set-Cookie`, `Authorization`, `Proxy-Authorization`, e material com forma de credencial no corpo.

**Allowlist de headers persistíveis**, não denylist: `content-type`, `content-length`, `location`, `strict-transport-security`, `server`, `x-powered-by`.

### 3.1 Quarentena não tem store próprio

**Erratum E8.** A v2 mandava construir quarentena tenant-aware, com retenção, recebendo o payload sanitizado. **Um artefato sanitizado não reproduz o problema** — não vale a tabela.

E havia um furo de raciocínio: se o sanitizador é escrito contra o schema esperado, o que ele não reconhece ou descarta — e o drift some — ou passa, e o filtro não valeu.

**Resolução, em três partes:**

1. **`contentHash` é calculado no fetcher, sobre os bytes crus**, antes de sanitizar. Identifica o que o site devolveu, viaja com o snapshot sanitizado, e nenhum byte cru é persistido. A chave de dedup **inclui o tenant** (§5); como o fetcher não conhece tenant, ele devolve o hash e o worker compõe a chave
2. **A assinatura de forma é calculada DEPOIS da sanitização** — o conjunto de `(caminho, tipo)` do payload já filtrado
3. **Drift é a comparação entre assinatura observada e esperada**, com o conjunto de remoções por política **subtraído da esperada**

> **Correção de um furo meu.** A primeira redação da v3 calculava a assinatura **antes** do filtro, para distinguir "sumiu por drift" de "removido por política" — e isso a tornava a única gravação do pipeline que passa por fora do sanitizador, contradizendo a §3 na frase seguinte.
>
> Pior: **nome de chave é conteúdo sempre que o objeto é um mapa.** Um payload com `{"user_reviews": {"Maria Silva - CRM-SP 12345": {…}}}` gravaria o nome do titular como *caminho*, depois de o filtro tê-lo apagado — e o mesmo canal aceita chave de 4 KB ou texto de instrução vindo de terceiro, num produto que tem IA em produção (§7).
>
> A ambiguidade que eu queria resolver não exigia nada disso: **o conjunto de remoções por política é fixo e conhecido**. Subtraí-lo da assinatura esperada distingue as duas causas sem gravar um byte cru.

| Classe de mudança | Detectada |
|---|---|
| Chave nova | **Sim** |
| Chave que sumiu | **Sim** |
| Mudança de tipo | **Sim** |
| **Mudança de semântica** — `reviewCount` passa a somar filiais | **Não.** Indetectável por mecanismo estrutural. Risco declarado |

**Fica guardado na linha da execução:** assinatura, `contentHash`, `errorCode`, `schemaVersion`, tamanho. Sem tabela nova.

**Dois pontos abertos:** onde mora a assinatura *esperada* e quem a versiona; e como representar arrays sem explodir um caminho por índice nem colapsar a heterogeneidade que denunciaria o drift.

> Este mecanismo é do pipeline de **coleta** — payload JSON do scraper, com forma estável. **Não se aplica ao pipeline de auditoria**, cuja entrada é HTML de sites arbitrários, onde forma diferente é a condição normal.

---

## 4. Threat model

| # | Ameaça | Severidade | Mitigação |
|---|---|---|---|
| T1 | SSRF | Alta | §2 inteira. **A camada estrutural da §2.5 NÃO existe em F0**: o ADR-004 está `Accepted`, e a Parte 1 decidiu `FETCHER_MODE=inline`. Em F0 há **uma** camada, não duas |
| T2 | Vazamento entre tenants | Alta | **Escrita: fechada em 23/08 — §5. Leitura: aberta, decisão E1** |
| T3 | Exaustão por resposta grande | Alta | Limite pós-descompressão |
| T4 | Vazamento em export e no link público | Alta | §6 |
| T5 | Segredo em log, evidência ou snapshot | Alta | §3, no ingresso |
| T6 | **Job forjado na fila** | Alta | Reautorizar após dequeue **e guarda de estado** — ver abaixo |
| T7 | **Prompt injection indireta** | Alta | **Existe IA hoje** — §7 |

**T6, corrigido em relação à v2 e ao rascunho seguinte.** O pipeline autoriza antes de enfileirar e nunca depois. Hoje `prospecting.service.ts` enfileira `{ tenantId, searchId, scrapeJobId, keyword, ... }` — **o `tenantId` viaja no corpo da mensagem**, que é o padrão a eliminar.

Corrigir para "a mensagem carrega só o id, e o worker deriva o tenant do banco" **fecha a forja de tenant e abre replay**: o produtor controla o id, o id seleciona a linha, a linha determina o tenant. Precisa das duas coisas:

1. A mensagem carrega apenas o id da execução; o worker deriva `tenantId` da linha e revalida entitlement e cota
2. **Confronto com `queueJobId`.** `ScrapeJob.queueJobId` já existe no schema e guarda o id do job no BullMQ. Na retirada da fila, `job.id` tem de bater com `queueJobId` da linha. **Uma mensagem forjada carrega outro id de job; um retry legítimo carrega o mesmo.** É o que separa os dois
3. **Transição atômica**, não check-then-act:

```sql
UPDATE scrape_jobs SET status = 'RUNNING'
 WHERE id = $1 AND "queueJobId" = $2 AND status IN ('QUEUED','FAILED')
```

Se afetar zero linhas, descarta. Sem isso, N cópias concorrentes leem `QUEUED` e todas seguem.

> **Correção de uma versão anterior desta seção**, que dizia *"uma execução só sai de `QUEUED`; reenfileirar id `RUNNING` é descartado"*. Isso **mataria a política de retry que já está em produção**: `prospecting.service.ts` configura a fila com `attempts: 3` e backoff exponencial, e o BullMQ re-executa **o mesmo job**. Se a primeira tentativa moveu a linha para `RUNNING` e falhou, as duas seguintes seriam descartadas — e cada retry legítimo emitiria a mesma linha de log de um replay hostil, envenenando o sinal de detecção desde o primeiro dia.
>
> O confronto com `queueJobId` distingue os dois casos, que é o que a guarda por estado não conseguia fazer.

Sem os três, o atacante enumera ids e reenfileira em laço: consome cota da vítima, dispara egress do bucket de rate limit dela, e cobra repetido — com a reautorização passando, porque a linha é legítima. E `QUEUED` é estado normal de linha travada: `prospecting.service.ts` **incrementa `leadsReserved` e `searchesCount` antes do `queue.add`**, então o caminho de recuperação legítimo e o de ataque são indistinguíveis sem o item 2.

**Avaliadas e não prioritárias:** container breakout, DNS tunneling, model exfiltration.

---

## 5. Isolamento de tenant

### 5.1 Escrita — fechada em 23/08

`CURRENT / CONFIRMED` — migration `20260823131105_f0_integridade_tenant`.

**Erratum E10.** A v2 listava a FK composta `(tenantId, id)` como pré-requisito não atendido. Foi atendido:

| Tabela | FK |
|---|---|
| `lead_source_records`, `lead_digital_presences`, `lead_scores` | `(tenantId, leadId) → leads(tenantId, id)` |
| `lead_score_reasons` | `(tenantId, scoreId) → lead_scores(tenantId, id)` |
| `pipeline_transitions` | `(tenantId, cardId) → pipeline_cards(tenantId, id)` |
| `lead_tags` | coluna `tenantId` nova; **as duas FKs partilham ela** |

Sete consultas de divergência deram zero antes e depois.

**O que continua aberto na escrita, separado por motivo:**

| Relação | Situação |
|---|---|
| `lead_source_records.scrapeJobId`, `pipeline_transitions.fromStageId` | **Bloqueadas de fato.** São `ON DELETE SET NULL`, e FK composta que partilhe `tenantId` não pode ser `SET NULL` — o Postgres anularia todas as colunas da chave, inclusive `tenantId`, que é `NOT NULL`. Exige trigger, ou o `SET NULL (coluna)` do Postgres 15, que o Prisma não modela |
| **`pipeline_transitions.toStageId`** | **Fechável, e eu classifiquei errado.** `toStageId` é `String` **não nulo**, e a relação é obrigatória — o default do Prisma é `Restrict`, confirmado no banco. **`SET NULL` não se aplica.** Falta só `@@unique([tenantId, id])` em `pipeline_stages`, do mesmo tipo aditivo e barato que a migration de 23/08 já aplicou em quatro tabelas |
| `pipeline_cards.stageId` | Mesma situação de `toStageId`: relação obrigatória, `Restrict`. Fechável |
| `Proposal.leadId`, `Contract.proposalId` | FK simples, `SET NULL`. Mesmo bloqueio da primeira linha |

> A v3 pôs `toStageId` na lista dos bloqueados sem conferir a nulabilidade da coluna, e o mesmo erro está no comentário que escrevi no `schema.prisma`. **Um vazamento fechável com uma linha ficou registrado como impossível** — e é justamente o que o `verificacoes-f0b.sql` bloco 2 mede: *"uma transição do Tenant A apontando para etapa do Tenant B faz o nome do funil do concorrente aparecer no histórico do card"*. Medido em zero hoje, e agora na fila de trabalho em vez de arquivado.

### 5.2 Leitura — aberta, e é decisão do Product Owner

**FK não filtra `SELECT`.** O T2 é sobre leitura, e nada do que foi feito em 23/08 o fecha.

| Opção | Custo | O que fica descoberto |
|---|---|---|
| **RLS no PostgreSQL 16** | Role separada do owner, `FORCE ROW LEVEL SECURITY`, `SET LOCAL` amarrado à transação — o pool do Prisma não garante afinidade de conexão fora de `$transaction`. Toca todo acesso a dado | Nada |
| **Extensão do Prisma exigindo `tenantId`** | Baixo; é disciplina reforçada por tipo | Query raw, e todo caminho que não passe pelo client |

**Decisão E1, pendente.** Minha recomendação é a segunda — mas ela **não fecha o T2**, e registrar isso é a diferença entre escolher e fingir que resolveu. A v1 escolheu disciplina sem dizer que estava escolhendo.

### 5.3 Pontos que continuam valendo

- **`contentHash` com dedup global:** Tenant A receberia o snapshot de B — e antes disso descobriria **que B auditou aquele domínio**. Para agências concorrentes, o oráculo vale mais que o conteúdo. **A chave de dedup inclui tenant**
- **Unicidade de `fingerprint` e `placeId`:** já é `@@unique([tenantId, ...])`. Correto
- **`ProposalItem`** — **erratum E7.** A v2 o chamava de junção junto com `LeadTag`. Só `LeadTag` é: dois pais, cada um com seu tenant. `ProposalItem` tem um pai só e herda o tenant sem ambiguidade, **logo não tem vazamento de integridade**. Mas continua nesta lista por outro motivo: **RLS sem coluna `tenantId` vira subquery por linha** (`EXISTS (SELECT 1 FROM proposals ...)`), mais cara e não indexável, e uma extensão do Prisma não tem o que exigir. Entra pela decisão E1, não pela integridade
- **Chave de cache do Redis:** requisito declarado, nunca testado

---

## 6. Link público — fora de todo o modelo

`AuditReport` terá link público com validade. Nenhuma regra de tenant se aplica: a única proteção é a imprevisibilidade do identificador.

| Requisito | |
|---|---|
| Identificador | ≥128 bits de entropia criptográfica. **Não ULID** — ordenável e com prefixo temporal |
| Expiração | Verificada no acesso |
| Revogação | Ao remover o lead, encerrar o tenant, ou atender exclusão de titular |
| Indexação | `X-Robots-Tag: noindex` e `robots.txt` |
| Rate limit | Por token e por IP |

---

## 7. Existe IA no produto hoje

A v1 dispensou prompt injection alegando *"não há IA no caminho"*. **Falso.**

`AIProvider` e `GeminiAIProvider` existem, com fábrica em `apps/api/src/outreach/providers/ai-provider.factory.ts`. `OutreachMessage` grava `prompt`, `content`, `provider`, `model`, `tokensEstimated`. `PlanUsage` conta `aiGenerationsCount`.

Há IA em produção gerando abordagem a partir de dados de lead — e a auditoria vai alimentar esses dados com conteúdo de um site que **o alvo controla**. Prompt injection indireta é vetor **atual**.

`parecer-prompt-faro.md` §4 já aprovou as regras — proibir invenção de números, clientes, resultados, preços e garantias; exigir aprovação antes do envio; versionar o prompt. **Elas se aplicam ao conteúdo que a auditoria coletar.**

E o `external-adapters.md` do próprio módulo já enuncia a instrução de sistema obrigatória:

> *"Use exclusivamente os fatos listados no contexto. Não infira número de unidades, tempo de mercado, nome de sócios, faturamento ou qualquer dado ausente."*

---

## 8. LGPD

| Item | Situação |
|---|---|
| Base legal — legítimo interesse com teste de proporcionalidade | Pendente |
| Registro de operações (art. 37) | Pendente |
| Encarregado designado (art. 41) | Pendente |
| Fluxo de exclusão de titular | Pendente |
| Retenção de `LeadSourceRecord.payload` | Indefinida — sem `retentionUntil` |

**Conflito estrutural:** `AuditLog` é append-only por desenho. Atender o art. 18 VI exigiria apagar dado de uma tabela que não permite exclusão. E o registro da própria revogação **não pode conter o valor removido** — `AuditLog.before` com a URL do perfil regrava, numa tabela imutável, o dado que a rotina apagou. Guardar `{ sinal, motivo, checkId }`, nunca o valor.

**`SOCIAL_LINK_DISCOVERY` contradiz a classe `PROHIBITED`:** para clínica, advogado e MEI, o Instagram do site **é o perfil pessoal**, e a URL seria persistida como evidência. **Reclassificar — e enquanto não for, a capability está bloqueada**, com a Fase 3 e o relatório que depende dela.

---

## 9. Testes

**Erratum E6.** A v2 agendava 22 testes em F0. **S10 sai** — depende de `--profile full`, que não pode rodar. **S11 fica**, sem a parte de tempo (§2.8). **S12b e S12c entram** (replay e retry legítimo). Saldo: **23**.

> Uma versão anterior desta seção dizia "20", número copiado do ADR-004 sem recomputar depois dessas três mudanças. E o `PROVIDER-CONTRACT-v5.md` diz 23. **A contagem válida é a tabela abaixo**, e os outros dois documentos precisam ser reconciliados com ela.

### O alvo do teste depende do ambiente — e é onde a v3 quase errou

`CURRENT / CONFIRMED` — `apps/api/src/prospecting/prospecting.service.ts`: o default de desenvolvimento é `redis://localhost:6381`.

| Ambiente | O que o processo alcança |
|---|---|
| **`pnpm dev`** (o de hoje) | `127.0.0.1:5434`, `127.0.0.1:6381`, `127.0.0.1:8081` — **portas do host** |
| **`--profile full`** (não roda) | `postgres:5432`, `redis:6379`, `gmaps-scraper:8080` — **nomes de serviço** |

**Os testes de SSRF precisam cobrir os dois conjuntos**, e o erratum E4 vale para o segundo. Apontar só para nomes de serviço em `pnpm dev` faz o teste passar por **NXDOMAIN** — verde sem que uma única faixa de IP tenha sido consultada. É o healthcheck que grita falso, outra vez.

E `127.0.0.1:5432` **não entra em teste nenhum**: essa porta é o Postgres do Bellvia (`docker-compose.yml`), e a regra 1 do `CLAUDE.md` não admite tráfego dirigido a ele.

### F0 — 23 testes, todos executáveis hoje

| # | Teste |
|---|---|
| S1 | `http://127.0.0.1/` e um nome que **resolva** para `127.0.0.1` — **na porta 80**, ver E12 |
| **S1b** | **`http://127.0.0.1:5434/` recusado pela PORTA** — e a checagem de forma, não a de faixa |
| S2 | `http://169.254.169.254/` |
| S2b | `http://[fd00:ec2::254]/` — IMDS por IPv6 |
| S2c | `http://[::ffff:127.0.0.1]/` — mapped |
| S2d | `http://[64:ff9b::a9fe:a9fe]/` — NAT64 |
| S3 | Domínio público que resolve para IP privado |
| S3b | Resposta DNS com um público e um privado |
| S3c | Rebinding: TTL 0 respondendo diferente na 2ª consulta |
| S4 | Redirect de público para loopback |
| S5 | FQDN com ponto final: um nome **que resolva** no ambiente, com o ponto no fim. `http://postgres./` em `pnpm dev` dá NXDOMAIN e passa pelo motivo errado |
| S6 | 50 MB não comprimidos |
| S6b | 2 MB de gzip que inflam para 40 GB |
| S7 | `file:///etc/passwd`, `gopher://`, `dict://` |
| S7b | Porta isolada: domínio público que resolve normalmente, na porta 6381 |
| S8 | Tenant A lê auditoria de B |
| S9 | Export de A com filtro de B |
| S11 | **Erro uniforme** entre bloqueado, NXDOMAIN e recusado — sem a parte de tempo, §2.8 |
| S12 | Job forjado na fila com tenant de outro |
| S12b | **Replay: mensagem com id de execução válido e `queueJobId` que não bate** |
| S12c | **Retry legítimo do BullMQ não é descartado** — o mesmo `queueJobId` reentra |
| S13 | Dedup de snapshot por hash entre tenants |
| S14 | Sanitizador remove PII antes do snapshot |
| S15 | Userinfo de URL não chega a `sourceReference` |

### Checklist do primeiro deploy — não F0

| # | Teste | Por quê |
|---|---|---|
| **S10** | De dentro do fetcher, `postgres`, `redis` e `gmaps-scraper` **não resolvem como nome**, e conexão a `postgres:5432` / `redis:6379` falha | Exige `--profile full` |
| **S10c** | **O teste falha, não passa, se rodar fora de `--profile full`** | Sem isto, S10 é o healthcheck que grita falso |
| **S11-tempo** | Tempo constante entre rejeições | Problema aberto, §2.8 |

**Nota de método:** se S3 e S3c rodarem contra resolver mockado, passam trivialmente. Precisam da configuração de rede real.

> **Erratum E12 — o S1 como esta política o escreveu passava pelo motivo errado.**
>
> A v3 mandava testar `http://127.0.0.1:5434/`. Mas 5434 não está na allowlist de portas, e a validação de **forma** vem antes da de **endereço** — de propósito, para não gastar consulta DNS com URL que já morreu. O teste seria recusado por `PORTA_PROIBIDA` e **a tabela de faixas nunca seria consultada**.
>
> Verde, e sem provar nada sobre loopback. É o healthcheck que grita falso — desta vez dentro de um teste de segurança, escrito por quem tinha acabado de documentar esse modo de falha duas vezes no mesmo arquivo.
>
> Descoberto ao executar: a expectativa do teste e o comportamento do código divergiram, e o código estava certo.
>
> **A regra geral:** um teste que exercita uma camada precisa passar por todas as anteriores. Cada caso de faixa usa porta 80 ou 443; a recusa por porta tem caso próprio.

---

## 10. Resumo

A v1 tinha o princípio certo e a tabela furada. A v2 corrigiu a tabela e descreveu a infraestrutura de memória. **A v3 é a primeira escrita depois de ler o compose e consultar o banco** — e as sete erratas da §0 são todas dessa leitura.

**O que está fechado:** a tabela de faixas, o filtro de PII no ingresso, a integridade de tenant na escrita.

**O que depende de decisão sua:** RLS ou extensão do Prisma (o E1 da série do `PROVIDER-CONTRACT-v5.md`); e a reclassificação de privacidade do link social, que trava a Fase 3 e o relatório.

> **O ADR-004 não está nesta lista, e uma versão anterior desta seção o punha.** Ele está `Accepted`: a Parte 1 decidiu `FETCHER_MODE=inline` — custo zero, nenhum serviço novo — e a Parte 2 ficou `Deferred` para o primeiro deploy de produção. **Em F0, a camada estrutural da §2.5 não existe por decisão tomada**, não por decisão pendente. Isso significa uma camada contra o T1, não duas, e a §4 registra assim.

**O que continua aberto sem solução escolhida:**

- **Tempo constante contra auto-DoS** (§2.8), e o timeout de DNS que a §2.4 não especifica
- **Onde mora a assinatura de drift esperada**, e como representar arrays (§3.1)
- **`scrapeJobId`, `fromStageId`, `Proposal.leadId`** — bloqueadas pelo `ON DELETE SET NULL`
- **`toStageId` e `pipeline_cards.stageId`** — **não bloqueadas**, fechável com `@@unique([tenantId, id])` em `pipeline_stages`. Estavam classificadas errado, e agora estão na fila
