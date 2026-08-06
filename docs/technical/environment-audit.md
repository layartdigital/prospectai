# Auditoria de Ambiente — Fase 0

**Projeto:** PropectAI
**Versão alvo:** 0.1.1
**Data da auditoria:** 27 de julho de 2026
**Raiz do projeto:** `F:\prospectai`

---

## 1. Método

Inspeção do sistema de arquivos em `F:\prospectai` + execução de `infra/scripts/audit-ambiente.ps1` no Windows em 27/07/2026. **Todas as verificações da Fase 0 estão concluídas.** Saída bruta em `docs/technical/audit-resultado.txt`.

### Ferramentas instaladas

| Ferramenta | Versão | Situação |
|---|---|---|
| Node.js | v24.13.1 | OK |
| pnpm | 10.30.1 | OK |
| Docker | 29.6.1 | OK |
| Git | 2.55.0 | OK |

Nenhuma instalação pendente para iniciar a Fase 1.

---

## 2. Estado atual de `F:\prospectai`

### 2.1 O que existe

```text
F:\prospectai
├── services\
│   └── google-maps-scraper\        Clone do repo gosom/google-maps-scraper
├── data\
│   └── gmapsdata\
│       ├── jobs.db                 SQLite de jobs do scraper (+ -wal, -shm)
│       └── 94c317c2-….csv          1 resultado de coleta já executada
└── PropectAI_Prompt_Ultra_Detalhado_Claude_v0.1.1.md
```

### 2.2 O que não existe

Nenhum artefato do PropectAI propriamente dito foi criado até esta data:

- `apps/web`, `apps/api`, `apps/worker`
- `packages/ui`, `packages/config`, `packages/types`, `packages/sdk`
- `prisma/` (schema, migrations, seed)
- `infra/docker`, `infra/scripts`
- `docs/` (este documento é o primeiro)
- `docker-compose.yml`, `.env.example`
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- `README.md`, `CHANGELOG.md`

**Conclusão:** o projeto está em 0% de implementação. O único componente operacional é o motor de coleta, que é software de terceiros.

### 2.3 Divergências em relação à árvore prevista no prompt

Duas diferenças já existem entre o que está em disco e a estrutura descrita no documento mestre. **Ambas foram aceitas** — o custo de "corrigir" supera o benefício.

| Prompt | Realidade | Decisão |
|---|---|---|
| Sem pasta `services/` | `services/google-maps-scraper/` | **Manter.** É um clone git de terceiros; separá-lo em `services/` é mais correto do que misturá-lo a `apps/` ou `packages/`, que são workspaces pnpm. |
| Volume em `./data/gmaps` | `./data/gmapsdata` | **Manter `gmapsdata`.** Já contém `jobs.db` populado e um CSV de coleta real. Renomear quebraria o histórico sem ganho algum. |

O `docker-compose.yml` e o `.env.example` devem refletir `./data/gmapsdata`.

### 2.4 Tratamento do clone do scraper no versionamento

`services/google-maps-scraper/` tem `.git` próprio, apontando para o upstream. Não commitar o conteúdo dele dentro do repositório PropectAI.

**Decisão:** adicionar ao `.gitignore` da raiz e documentar o clone no README (`git clone https://github.com/gosom/google-maps-scraper services/google-maps-scraper`). Submódulo git é a alternativa mais rigorosa, mas adiciona atrito de setup sem benefício real neste estágio — o scraper é consumido como imagem Docker, não como código-fonte.

`data/gmapsdata/` também vai para o `.gitignore`: é estado de runtime.

---

## 3. Inventário do motor de coleta

**Repositório:** `gosom/google-maps-scraper`
**Papel na arquitetura:** implementação concreta de `LeadSourceProvider`. Roda isolado, acessível apenas por API e worker.

### 3.1 API HTTP disponível

O scraper expõe uma API REST documentada em `api/docs/swagger.yaml`. O mapeamento para a abstração do PropectAI é quase direto:

| Endpoint do scraper | Método `LeadSourceProvider` |
|---|---|
| `POST /api/v1/scrape` | `createSearch()` |
| `GET /api/v1/jobs/{job_id}` | `getJob()` e `getResults()` (mesmo endpoint) |
| `DELETE /api/v1/jobs/{job_id}` | `cancelJob()` |
| `GET /api/v1/jobs` | — (listagem, uso operacional) |
| `GET /api/v1/health` | healthcheck do compose |

**Atenção:** o scraper também usa o prefixo `/api/v1`. Como os serviços vivem em containers e portas distintas, não há colisão hoje. Se um dia houver um proxy reverso único na frente dos dois, o scraper precisará ser montado sob outro caminho.

### 3.2 Contrato de entrada (`api.ScrapeRequest`)

| Campo | Tipo | Observação |
|---|---|---|
| `keyword` | string | Ex.: `"dentistas em São Paulo, SP"` — é aqui que nicho + cidade viram consulta |
| `lang` | string | Usar `pt` |
| `geo_coordinates` | string | `"lat,lon"` |
| `radius` | number | Raio em km |
| `zoom` | int | 1–21 |
| `max_depth` | int | Paginação. Default 1, **máximo 100** |
| `timeout` | int | Segundos. **Máximo 300** |
| `email` | bool | Extrai e-mails visitando o site do lead. Custa tempo |
| `fast_mode` | bool | HTTP furtivo em vez de navegador. Mais rápido, menos completo |
| `extra_reviews` | bool | **Manter sempre `false`** — ver seção 4 |

**Restrição operacional relevante:** `timeout` tem teto de 300 segundos. Buscas grandes precisam ser quebradas em vários jobs pelo worker, não enviadas como um job único. Isso precisa estar previsto no desenho da fila desde o início.

### 3.3 Campos retornados

Confirmados a partir do CSV real em `data/gmapsdata/`:

**Diretamente úteis ao produto:**
`title`, `category`, `address`, `complete_address` (objeto com `street`, `borough`, `city`, `state`, `postal_code`, `country`), `website`, `phone`, `emails`, `open_hours`, `review_count`, `review_rating`, `reviews_per_rating`, `latitude`, `longitude`, `status`, `timezone`, `price_range`

**Identificadores para deduplicação:**
`place_id`, `cid`, `data_id`, `link`

**Secundários:**
`plus_code`, `thumbnail`, `images`, `about`, `owner`, `descriptions`, `street_view_url`, `reservations`, `order_online`, `menu`, `credit_cards_accepted`

**Não retornados — e isso importa:**
Não há Instagram, Facebook, nem qualquer indicação de WhatsApp. Ver seção 4.2.

### 3.4 Observações sobre a qualidade dos dados

- `complete_address.state` vem como **nome por extenso** (`"São Paulo"`), não sigla. Os filtros por estado dependem de uma tabela de normalização UF.
- `open_hours` é um JSON com **chaves em português** (`"segunda-feira"`), dependente do `lang` enviado. O parser precisa ser tolerante ao idioma.
- `phone` vem formatado (`"(11) 99755-1555"`). Normalizar para E.164 antes de deduplicar.
- `status` costuma vir vazio; não dá para confiar nele sozinho para detectar empresa fechada.

---

## 4. Riscos identificados

### 4.1 Privacidade — bloqueante

O CSV contém dois campos com **dados pessoais de terceiros**:

- `user_reviews` e `user_reviews_extended`: nome completo, foto de perfil, link do perfil Google e texto de avaliações de pessoas físicas identificadas.
- `owner`: nome e link de perfil do proprietário.

Esses dados **não têm finalidade comercial no PropectAI** e não devem ser persistidos. O produto precisa de *quantas* avaliações e a *média* — não de quem escreveu o quê.

**Decisões:**
1. `extra_reviews` fica permanentemente em `false`.
2. A camada de normalização descarta `user_reviews` e `user_reviews_extended` **antes** de gravar o payload bruto em `LeadSourceRecord`.
3. `owner` é reduzido apenas ao nome de exibição do negócio, sem link de perfil pessoal.

### 4.2 Sinais que o produto promete e o scraper não entrega

O modelo de score previsto no prompt depende de sinais que **não vêm da fonte**:

| Sinal | Situação real |
|---|---|
| Instagram / Facebook | Não retornado. Só descobrível varrendo o site do lead |
| WhatsApp | Não retornado. Só inferível pelo formato do telefone |
| Site responsivo | Exige buscar e renderizar o site |
| Site com HTTPS | Inferível do próprio campo `website` (barato) |
| E-mail corporativo | Disponível apenas com `email: true`, que encarece a busca |

**A regra que vale para todos:** ausência de sinal é `DESCONHECIDO`, nunca `NÃO POSSUI`. Marcar um lead como "Sem Instagram" quando o sistema simplesmente nunca olhou é um falso negativo que destrói a confiança no score — é o defeito mais visível nos produtos concorrentes analisados.

O tratamento detalhado está em `docs/technical/scoring.md`.

### 4.3 Espaço em disco no drive C: — atenção imediata

| Drive | Usado | Livre |
|---|---:|---:|
| C: | 105,1 GB | **5,4 GB** |
| F: | 578,9 GB | 352,6 GB |

Dois consumidores gravam em C: por padrão. O tratamento de cada um é diferente, e a diferença importa porque o Bellvia divide a mesma máquina.

#### Store do pnpm — resolver, com escopo local

O store fica em `%LOCALAPPDATA%\pnpm\store` e um monorepo Next + Nest passa fácil de 1,5 GB. Há um agravante silencioso: **pnpm usa hardlinks, que só funcionam dentro do mesmo volume.** Com store em C: e projeto em F:, o pnpm copia em vez de linkar — gasta espaço nos dois drives e instala mais devagar.

A correção vai num `.npmrc` **na raiz do PropectAI**, não na configuração global:

```ini
# F:\prospectai\.npmrc
store-dir=F:\.pnpm-store
```

Escopo local de propósito. `pnpm config set store-dir` escreveria na configuração global do usuário e passaria a valer também para `F:\drmind`, que é um monorepo pnpm ativo. Mudar a infraestrutura de dependências de outro projeto sem necessidade não se justifica.

**Não executar `pnpm store prune`.** O comando opera sobre o store compartilhado e não há benefício que compense mexer nele com o Bellvia em desenvolvimento corrente.

#### Disco do Docker — não mover

O `ext4.vhdx` do WSL2 fica em `%LOCALAPPDATA%\Docker\wsl` e contém **todas** as imagens, containers e volumes da máquina, incluindo os seis volumes de dados do Bellvia. Movê-lo exige parar o Docker inteiro e migrar o arquivo.

A migração é um recurso oficial do Docker Desktop e costuma funcionar. Mas o custo-benefício não fecha: o consumo real da Fase 1 em C: é pequeno.

| Item | Espaço em C: |
|---|---:|
| `postgres:16-alpine` | ~250 MB |
| `redis:7-alpine` | **0** — imagem já presente, o Bellvia usa a mesma tag |
| Volume do banco com o seed (25 leads) | Poucos MB |
| **Total estimado** | **~300 MB de 5,4 GB livres** |

Reutilizar `redis:7-alpine` — a mesma tag que o Bellvia já baixou — significa que o Docker aproveita a imagem existente sem baixar nada. Isso não cria acoplamento algum: imagem compartilhada é só um arquivo somente-leitura em cache. Container, volume, rede e porta continuam separados.

**Decisão:** manter o disco do Docker onde está. Monitorar C: durante a Fase 1 e reavaliar apenas se cair abaixo de 3 GB.

### 4.4 Bloqueio pela fonte

Coleta em volume é sujeita a bloqueio. O scraper documenta suporte a proxies em `services/google-maps-scraper/docs/proxies.md`.

A v0.1.1 precisa, no mínimo: limite de jobs concorrentes por tenant, backoff em falha, e um estado `FAILED` que devolve a cota consumida ao tenant. Sem isso o primeiro uso sério do produto queima crédito do cliente sem entregar lead.

---

## 5. Portas — confirmadas

Verificação de 27/07/2026. **O plano de portas está integralmente validado.**

| Serviço | Container | Porta host | Situação |
|---|---:|---:|---|
| Web (Next.js) | `propectai-web` | 3100 | Livre |
| API (NestJS) | `propectai-api` | 3101 | Livre |
| Worker | `propectai-worker` | — | Sem porta exposta |
| PostgreSQL | `propectai-postgres` | 5434 | Livre |
| Redis | `propectai-redis` | 6381 | Livre |
| Google Maps Scraper | `propectai-gmaps-scraper` | 8081 | Ocupada **pelo próprio scraper do PropectAI** — ver 5.1 |
| Prisma Studio | — | 5556 | Livre |

Nenhuma alteração necessária. `wslrelay` aparecendo como dono da 8081 é apenas o proxy do Docker Desktop sob WSL2 — é assim que toda porta publicada por container se apresenta ao Windows.

### 5.1 O container do scraper já existe, e precisa ser adotado

```
propectai-scraper   gosom/google-maps-scraper:latest   Up 4 hours   0.0.0.0:8081->8080/tcp
```

É o container que gerou o CSV em `data/gmapsdata/`. Foi criado à mão, fora de um `docker-compose.yml` — que ainda não existe. Duas correções ao trazê-lo para o compose:

| Item | Como está | Como deve ficar |
|---|---|---|
| Nome | `propectai-scraper` | `propectai-gmaps-scraper` |
| Publicação | `0.0.0.0:8081->8080` — **exposto a toda a rede local** | `127.0.0.1:8081:8080`, e não publicado em produção |
| Rede | Bridge padrão | `propectai-network` |
| Telemetria | Desconhecida | `DISABLE_TELEMETRY=1` |

Publicar em `0.0.0.0` significa que qualquer máquina na mesma rede alcança o scraper sem autenticação. Em rede doméstica o risco é baixo, mas não há motivo para manter.

Antes de escrever o compose, capturar como o container foi criado:

```powershell
docker inspect propectai-scraper | Out-File F:\prospectai\docs\technical\scraper-inspect.json
```

A adoção é feita com `docker rm -f propectai-scraper` seguido de `docker compose up -d`. **É seguro** — o container não guarda estado próprio: os dados vivem no bind mount `./data/gmapsdata`, que permanece intacto. Este é o único container que pode ser removido nesta máquina.

### 5.2 Rede e volumes

**Rede:** `propectai-network`, criada exclusivamente para este projeto.
**Volumes:** prefixo `propectai-`, exceto o do scraper, que faz bind em `./data/gmapsdata`.

Em produção a porta do scraper não é publicada — API e worker o acessam pelo nome de serviço na rede Docker.

---

## 6. Inventário do Bellvia — intocável

`F:\drmind` confirmado como projeto ativo e grande (monorepo pnpm, `apps/`, `packages/`, dezenas de documentos de auditoria, backups internos). Última escrita em 25/07/2026 — está em desenvolvimento corrente.

### 6.1 Recursos Docker do Bellvia

**Containers — nenhum pode ser parado, removido ou reutilizado:**

| Container | Imagem | Porta |
|---|---|---:|
| `drm-postgres-dev` | postgres:15-alpine | 5432 |
| `drm-redis-dev` | redis:7-alpine | 6379 |
| `drm-mailhog` | mailhog/mailhog | 1025, 8025 |
| `drm-minio-dev` | minio/minio | 9000, 9001 |

**Redes:** `drmind_default`, `drmind_drmind-dev`, `drmind_drmind-net`

**Volumes:** `drmind_postgres_data`, `drmind_postgres_dev_data`, `drmind_redis_data`, `drmind_redis_dev_data`, `drmind_minio_data`, `drmind_minio_dev_data`

Há também dois volumes anônimos (`896e1a…`, `31805e…`) de origem não identificada. **Não remover** — volume anônimo órfão é exatamente o que `docker volume prune` apaga, e não há como saber a quem pertencem.

### 6.2 Confirmação de não colisão

| Dimensão | Bellvia | PropectAI | Conflito |
|---|---|---|---|
| Portas | 5432, 6379, 1025, 8025, 9000, 9001 | 3100, 3101, 5434, 6381, 8081, 5556 | Nenhum |
| Prefixo de container | `drm-` | `propectai-` | Nenhum |
| Redes | `drmind_*` | `propectai-network` | Nenhum |
| Volumes | `drmind_*` | `propectai-*` | Nenhum |
| PostgreSQL | 15-alpine | 16 | Imagens distintas |
| Redis | 7-alpine | 7 | Instâncias distintas, portas distintas |

**Separação limpa em todas as dimensões.** O deslocamento de 5432→5434 e 6379→6381 cumpre seu propósito: uma string de conexão errada não alcança o banco do Bellvia, ela simplesmente falha.

### 6.3 Compromissos permanentes

1. Nenhum arquivo, pasta, container, rede, volume ou porta do Bellvia é modificado, movido, renomeado, parado ou reutilizado.
2. Todo recurso Docker do PropectAI usa o prefixo `propectai-`.
3. **Nunca executar** `docker system prune`, `docker volume prune`, `docker network prune` ou qualquer remoção global. Os volumes do Bellvia contêm dados de desenvolvimento reais.
4. O único container removível nesta máquina é `propectai-scraper`, e apenas para adoção pelo compose (ver 5.1).
5. O relatório final de cada fase declara explicitamente que `F:\drmind` não foi modificado.

---

## 7. Conclusão da Fase 0 — aprovada

O ambiente está apto para a Fase 1. Plano de portas confirmado sem uma única alteração, isolamento do Bellvia verificado em todas as dimensões, e as quatro ferramentas necessárias já instaladas em versões atuais.

O motor de coleta é mais capaz do que o documento mestre assume (API REST completa, deduplicação interna, 30+ campos por lead) e já está rodando com dados reais coletados. Sua limitação relevante — não entregar sinais de redes sociais nem de WhatsApp — está absorvida pelo escopo aprovado através da regra de sinal `DESCONHECIDO`.

### Checklist antes de iniciar a Fase 1

| # | Ação | Impacto no Bellvia |
|---|---|---|
| 1 | Criar `F:\prospectai\.npmrc` com `store-dir=F:\.pnpm-store` | Nenhum — escopo restrito à pasta do PropectAI |
| 2 | `docker inspect propectai-scraper` → salvar JSON | Nenhum — leitura |
| 3 | `docker rm -f propectai-scraper` e recriar pelo compose | Nenhum — container exclusivo do PropectAI, sem estado próprio |
| 4 | Republicar o scraper em `127.0.0.1:8081` | Nenhum — corrige exposição do PropectAI à rede local |

Nenhuma das quatro ações toca container, volume, rede, porta, arquivo ou configuração do Bellvia.

**Descartado:** mover o disco do Docker Desktop para F:. A migração arrastaria os volumes do Bellvia junto e exigiria parar todos os containers dele, para economizar ~300 MB. Risco desproporcional ao ganho — ver 4.3.

**Declaração:** nenhum arquivo, container, rede ou volume de `F:\drmind` foi modificado durante esta auditoria. Todos os comandos executados foram de leitura.

**Próximo passo:** Fase 1 — fundação do monorepo, conforme `docs/strategic/scope-v0.1.1.md`.
