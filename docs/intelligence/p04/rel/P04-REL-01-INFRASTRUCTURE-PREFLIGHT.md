# P04-REL-01 — A. Preflight da infraestrutura

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (Squad DevOps/SRE, com AppSec e Database Engineering) · **Versão do documento:** 1.1.0 · **Data:** 02/11/2026
**Relação com a homologação:** parte do P04-REL-01, posterior ao encerramento P04-CLOSE-01. Commit de release: `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79` (PR #7, rascunho; CI #77 e #78 aprovados, informados pelo proprietário).
**`F:\drmind` (Bellvia) não foi modificado.** Nada foi executado, alterado, reiniciado ou escrito no servidor pela Executora.

> **O que mudou da 1.0.0 para a 1.1.0.** A 1.0.0 foi escrita sem acesso ao servidor. Em 02/11/2026 às 15:52 UTC o proprietário executou o roteiro somente leitura `P04-REL-01-preflight-somente-leitura.sh` (v1.0.0) como `root` e devolveu a saída (E08). Esta versão substitui as hipóteses por **observações**, reclassifica a topologia e **dispara uma regra de parada** (§5).

## 1. Em uma tela

1. **O endereço de homologação é a própria stack `prospectai-prod`.** O *virtual host* do nginx do servidor para `prospectai-stage.layart.com.br` faz `proxy_pass` para `127.0.0.1:3102`, que é a porta do gateway da stack `prospectai-prod`. Não existe segunda stack **em execução**, nem segundo banco ou segundos volumes ativos (há só uma stack de desenvolvimento antiga, parada: §6.4). **Cenário C confirmado.**
2. Portanto, **publicar "em homologação" é publicar na stack em uso** e no banco único dela. A ordem manda parar neste caso (§5) até que o proprietário declare, por escrito, a natureza da stack.
3. O servidor tem folga: **193 GB livres em disco, ~8 GB de memória disponível, 6 CPUs**. Capacidade não é o obstáculo.
4. **Não há backup utilizável**: o último dump do banco tem **6 semanas** e **nunca foi restaurado em teste**; não há rotina agendada que cite o projeto.
5. **O commit implantado é conhecido para a árvore** (`2c4b1b2`, `main`, árvore limpa), **mas não para as imagens**: a `api` em execução usa a imagem etiquetada `pre-dbrem06`, **não** a `:latest`, e o endpoint de versão devolve `commit: null`.
6. Dois achados novos que a 1.0.0 não podia ter: uma **porta `3101` escutando em todas as interfaces** por um processo ainda não identificado, e a **ausência de rotação de log** nos containers (o log de um container recriado se perde).

Parecer: **`NOT_READY`** para aprovar o deploy. Nada no Explorer o impede; o que falta é decisão do proprietário e três provas de segurança operacional (§8).

## 2. Como cada afirmação foi obtida

| Classe | Significado |
|---|---|
| **OBSERVADO** | saída do roteiro executado pelo proprietário em 02/11/2026 15:52 UTC (E08), ou comando da Executora |
| **REPOSITÓRIO** | lido no commit `cebbfa6` |
| **HISTÓRICO** | documento do projeto com data; não é estado atual |
| **HIPÓTESE** | inferência explícita; diz como confirmar |
| **NOT_VERIFIED** | ainda sem evidência |

A saída bruta (`preflight.txt`, 319 linhas, 21.605 bytes) **não é versionada**: o repositório é público e ela traz caminhos, tamanhos, endereços e nomes de pastas do servidor. Registram-se aqui o SHA-256 e trechos sanitizados (E08 no índice de evidências). Conferi a saída inteira: **não contém segredo** (só nomes de variável, sem valores).

## 3. Tentativas de observação da 1.0.0 (mantidas como registro)

O proxy da sessão da Executora recusou o domínio (403) e a máquina virtual do computador do proprietário não iniciou por falta de espaço em disco; por isso a observação foi feita **pelo proprietário**, com o roteiro. A primeira tentativa dele falhou por ter sido feita no computador pessoal e não no servidor (arquivo não encontrado); a segunda, enviando o roteiro por `scp` e executando por `ssh`, funcionou. Nenhuma credencial passou pela Executora.

## 4. As 13 perguntas da ordem (respostas observadas)

| # | Pergunta | Resposta | Classe | Evidência |
|---|---|---|---|---|
| 1 | Onde está implantado? | Servidor `hal-server-848101` (`108.174.144.216`), Ubuntu 24.04.4, kernel 6.8.0-136; projeto em `/opt/apps/prospectai`; projeto Compose `prospectai-prod`, **7 serviços em execução** | OBSERVADO | E08 §1, §4 |
| 2 | O endereço de homologação aponta para qual stack? | `prospectai-stage.layart.com.br` resolve para `108.174.144.216`; o vhost do nginx do host (`server_name` do domínio; `proxy_pass http://127.0.0.1:3102`) entrega ao **gateway da stack `prospectai-prod`** (única que publica `127.0.0.1:3102`). `/api/v1/health` responde 200 tanto pelo domínio quanto pela porta local, e `/login` serve o mesmo identificador de build do Next.js nos dois caminhos | OBSERVADO | E08 §9, §10, §11 |
| 3 | A homologação é isolada? | **Não.** Não há segunda stack. O que existe de "separado" é só o nome do domínio | OBSERVADO | E08 §4, §5, §9 |
| 4 | Compartilha banco, containers, volumes? | **Tudo.** Um `postgres`, um `redis`, volumes `prospectai-prod_prospectai_postgres_data` e `…_redis_data`, scraper com pasta de host única, mesmos `api`/`web`/`worker`/`gateway` | OBSERVADO | E08 §4, §5 |
| 5 | Qual commit está implantado? | **Árvore:** `2c4b1b25fac8e4266b3505270bb43e05127c60a7`, ramo `main` (merge do PR #6, DB-REM-06, 30/10/2026 15:17 -0300), **árvore limpa**. **Imagens:** não identificáveis pelo endpoint (`commit: null`, `builtAt: null`); a `api` roda a imagem `pre-dbrem06` e **não** a `:latest` (§6.2) | OBSERVADO (árvore) / NOT_VERIFIED (imagens) | E08 §7, §8, §10 |
| 6 | Que procedimento de deploy existe? | Manual: `git` no servidor, `docker compose build` no servidor, `up -d` de serviços nomeados. Etiquetas `pre-<janela>` nas imagens mostram que o procedimento **já usa retag para voltar** | REPOSITÓRIO + OBSERVADO | runbook; E08 §8 (imagens) |
| 7 | Como publicar sem modificar outras aplicações? | Só `api` e `web` do projeto, por nome, com `--no-deps` (plano §3, D5/D6). **Observado:** as redes e volumes do projeto contêm só containers do projeto; o resto da máquina é compartilhado (mesmo daemon, mesmo nginx, mesmo disco) | PLANO + OBSERVADO | E08 §5 |
| 8 | Exige merge na `main`? | Não tecnicamente: `cebbfa6` contém `2c4b1b2` (7 commits à frente, 0 atrás). O servidor está **exatamente** na `main` atual. Recomendo não mesclar antes da aceitação | REPOSITÓRIO + OBSERVADO | R02; E08 §7 |
| 9 | Exige migration ou mudança de configuração? | **Migration: não** para o Explorer (0 arquivos em `prisma/migrations`). **Variável nova: não** (usa `JWT_ACCESS_SECRET`, presente no `.env.production`). **compose, Dockerfiles, nginx: inalterados** em relação à `main`, que é o que a árvore do servidor já tem. Estado das migrations **no banco** segue NOT_VERIFIED (bloco 13 não executado) | REPOSITÓRIO + OBSERVADO | R03, R08; E08 §8 |
| 10 | Como voltar? | Reetiquetar a imagem **em execução** e recriar `web`, depois `api` (rollback §3). **Correção da 1.0.0:** a etiqueta de snapshot deve ser feita pelo **ID da imagem do container**, não por `:latest` (§6.2) | PLANO | — |
| 11 | Quais serviços reiniciariam? | `api` e `web`. **Não tocados:** `worker`, `gateway`, `postgres`, `redis`, `gmaps-scraper` (todos com `StartedAt` de 30/10/2026, 0 reinícios — linha de base) | OBSERVADO + REPOSITÓRIO | E08 §4 |
| 12 | Como provar que os módulos anteriores funcionam? | Smoke manual por camadas + `StartedAt` + baseline de 56 testes. **Observado:** `/api/v1/health` = `ok` com `database`, `redis` e `scraper` `ok`; `/login` 200 | PLANO + OBSERVADO | E08 §10, §11 |
| 13 | O que verificar antes de liberar testes humanos? | Gates REL-01…REL-12 e o checklist | PLANO | — |

## 5. Topologia: classificação e regra de parada

**Cadeia observada:** navegador → `prospectai-stage.layart.com.br` (DNS `108.174.144.216`; TLS Let's Encrypt, CN e SAN = o domínio, validade 08/10/2026 → 06/01/2027; HTTP/3 anunciado) → **nginx do host** (vhost próprio do domínio; `proxy_pass` para `127.0.0.1:3102`; bloco `location = /api/v1/auth/register` específico, **cujo conteúdo o roteiro não imprimiu**) → **gateway** (container `nginx:1.27-alpine`, `127.0.0.1:3102->80`) → `web` e `api` → `postgres` / `redis` / `gmaps-scraper`.

**Classificação: `Cenário C — o domínio de homologação apenas aponta para a stack existente`.** Confirmado por observação, não mais hipótese.

**Regra de parada da ordem acionada:** *"domínio de homologação associado diretamente à produção"* / *isolamento insuficiente* / *banco compartilhado sem estratégia aprovada*. A stack se chama `prospectai-prod`, o ambiente reportado pela API é `production` (`"environment":"production"`) e o domínio pelo qual ela é servida se chama `stage`: **o nome não resolve a questão**, e a Executora **não presume** que a stack é só de teste. O registro histórico de 17/09/2026 dizia "ambiente de teste online, não produção com cliente", e **isso pode ter mudado**.

**Alternativas (decisão do proprietário), em ordem de recomendação:**

| | Quando vale | O que exige |
|---|---|---|
| **D — mecanismo atual com salvaguardas** | o proprietário **declara por escrito** que a stack `prospectai-prod` é ambiente de teste **sem cliente nem dado real** e aceita que "homologar" = publicar nela | backup verificado, snapshot de imagem por ID, decisão sobre logs, janela |
| **C — montar homologação isolada** | **há** cliente, usuário ou dado real na stack, ou o proprietário quer isolamento | override do compose (projeto, sub-rede, porta, volumes, env files, banco próprio), vhost/DNS/certificado, segredos próprios, capacidade — **trabalho próprio de infraestrutura**; o `compose.prod.yml` atual **não** suporta uma segunda instância (R04 do índice) |

Não corrijo nada automaticamente: ficou registrado o bloqueio e as alternativas.

## 6. Achados do servidor que mudam o plano

### 6.1 Capacidade (REL-07) — folga confirmada

| Item | Observado |
|---|---|
| CPU | 6 núcleos; carga 0,83 / 1,03 / 0,64; uptime 2 dias 21 h |
| Memória | 15.991 MB total; **8.259 MB disponíveis**; swap 2.047 MB (379 MB em uso) |
| Disco | `/dev/sda3` 393 GB, 184 GB usados, **193 GB livres (49 %)**; `/`, `/opt`, `/opt/backups`, `/opt/data` e `/var/lib/docker` estão **no mesmo sistema de arquivos** |
| Docker | 29.7.1 (cliente e servidor), Compose v5.3.1 |
| `docker system df` | imagens 50 (33,07 GB; 4,1 GB recuperáveis), containers 41 (36 ativos), volumes 31 (1,34 GB), **cache de build 52,74 GB (38,17 GB recuperáveis)** — **não limpar**: é só leitura e sem `prune` |
| Limites | **todos os containers sem limite** de memória ou CPU (`mem=0`, `cpus=0`) |

Duas imagens novas de ~1,7–1,9 GB e o cache do build cabem folgadamente. **Risco residual (HIPÓTESE, não medido):** como nenhum container tem limite, um `next build` pesado compete por memória com todos os vizinhos; mitigação: `nice -n 10`, janela de baixo uso e `free -m` acompanhado. **`CAPACITY_GATE = PASS`** (com monitoramento).

### 6.2 Imagem da `api` em execução ≠ `:latest` (anomalia)

| Serviço | Imagem em execução | Etiquetas e idade |
|---|---|---|
| `api` | `sha256:64b25a48…` | **= `prospectai-prod-api:pre-dbrem06`** (3 dias); a `:latest` é outra (`408bd870aa0a`, 2 dias) |
| `web` | `sha256:dd9dd874…` | = `:latest` (3 semanas) |
| `worker` | `sha256:dddc34b6…` | = `:latest` (4 dias) |

Consequências, por ordem de importância:

1. **Os passos de snapshot da 1.0.0 (`docker tag prospectai-prod-api:latest …`) etiquetariam a imagem errada** e o rollback voltaria para uma imagem que **não era a que estava no ar**. **Corrigido** no plano e no rollback: etiquetar o **ID da imagem do container** (`docker inspect -f '{{.Image}}' prospectai-prod-api-1`).
2. **Por que a `api` roda a imagem `pre-dbrem06`** não está documentado. **HIPÓTESE:** reversão deliberada na janela do DB-REM-06 de 30/10 (o log da API foi escrito pela última vez às 15:38, exatamente no horário em que todos os serviços foram recriados). **Confirmação:** perguntar ao proprietário (§9, pergunta 1) e conferir `docker image inspect --format '{{.Created}}'` das duas imagens (item do roteiro v1.1).
3. **Já existe desalinhamento entre serviços:** `worker` na `:latest` mais nova, `api` na anterior. Não é causado por este release, mas **o release o altera** (a API passaria a ser a construída da árvore).
4. **Delta real entre o que roda e o que seria construído.** A árvore do servidor está na `main` (`2c4b1b2`). O `git log` mostra que, desde 01/10, os commits da `main` que tocam código de runtime são: `1404989` (07/10, web: chamadas same-origin), `077fc9c` e `aba2ee7` (27/10, gateway/`main.ts` da API/nginx), `1e467fa`/`4052aa7` (28/10, DB-REM-01: `prisma*.service`, `packages/types`) e `239ff0e` (30/10, config do worker). DB-REM-02/03/06 são **só migrations** (não entram na imagem de runtime) e `12d3a4d`/`9fe5efa` só alteram o compose. **HIPÓTESE:** como a imagem da web tem ~3 semanas e a da `api` tem ~3 dias (provavelmente de 29–30/10, depois de DB-REM-01, de 28/10), o delta de código da `main` que ainda não está nas imagens é **pequeno ou nulo**, e o delta efetivo do release é o do Explorer. **Não está provado**: só `docker image inspect` (data de criação) e comparação com a árvore confirmam. Até lá, **tratar o blast radius como "tudo o que a `main` mudou desde a build das imagens + Explorer"**, não só "Explorer".

### 6.3 Porta `3101` aberta em todas as interfaces (AppSec)

O roteiro listou `LISTEN 0.0.0.0:3101` e `[::]:3101`. O compose de produção **não publica** a `3101` (só `127.0.0.1:3102`); o container `api` expõe `3101/tcp` apenas na rede interna. Portanto **há outro processo no host** na `3101` (o `docker ps` mostra só `3101/tcp` sem mapeamento para o `api`). **Não identificado** (`ss -ltnp` não foi usado): pode ser outra aplicação do servidor ou um resquício de desenvolvimento. **Risco:** se for ProspectAI (API de desenvolvimento), estaria exposta; se for outra aplicação, **nenhum plano deste release pode usar a `3101`**. Ação (somente leitura): `ss -ltnp | grep ':3101'` (incluído no roteiro v1.1).

### 6.4 Stack de desenvolvimento antiga

O projeto Compose `propectai` (arquivo `docker-compose.yml`, `exited(3)`) tem 3 containers **parados há ~3 semanas** (`propectai-postgres`, `-redis`, `-gmaps-scraper`), com volumes próprios (`propectai-postgres-data`, `propectai-redis-data`) e rede `propectai-network`, sem containers conectados. **Não atende tráfego.** É um **segundo banco** (de desenvolvimento) que **não** é o do domínio de homologação. Não tocar (sem `prune`); só registrar que existe.

### 6.5 Logs e o GATE-DB-42501

Todos os containers usam o driver `json-file` **sem rotação** (`map[]`). Tamanhos (só metadados; conteúdo não lido): `api` 72.823 B (última escrita 30/10 15:38), `worker` 3.541 B, `postgres` 10.429 B (30/10 18:18), `web` 5.124 B, `gateway` 597.842 B, `redis` 2,9 MB, `gmaps-scraper` 4.957 B. **Recriar um container descarta o seu log.** Como `api`, `worker` e `postgres` somam < 90 KB, **exportá-los com hash é barato** (passo D1.4) — mas continua sendo uma decisão do proprietário sobre **quais logs** o GATE-DB-42501 exige e **se o T1 de 01/11 já foi coletado**. Não antecipei o T1 nem toquei nos logs. **`postgres` nunca é recriado neste release.**

### 6.6 Backups (REL-08)

Observado em `/opt/backups`, **só entradas do projeto** (o roteiro v1.0 também imprimiu nomes de pastas de outras aplicações, **que não foram copiados para este documento**; o roteiro v1.1 filtra por projeto):

| Item | Data | Observação |
|---|---|---|
| `propectai-20260917.sql.gz` e `propectai-20260921-1336.sql.gz` | 17/09 e 21/09/2026 | 42.560 bytes cada; **`gzip -t` íntegro**; **~6 semanas**, anteriores às migrations e janelas DB-REM de outubro; **restauração nunca testada** |
| `prospectai-arvore-20260921-1726.tgz` | 21/09 | árvore de código (2,4 MB) |
| `env.production-20260921.bak`, `env.production-20260922-redis.bak` | 11/08 e 21/09 | cópias do `.env.production` anteriores às separações `.env.banco`/`.env.dono` |
| `prospectai-dbrem04-20261030-1230`, `prospectai-dbrem06-20261030-1523` | 30/10 | **pastas de backup das janelas DB-REM**; **conteúdo não inspecionado** (podem conter dump recente) |
| Rotina agendada que cite o projeto | — | **nenhuma** encontrada em `cron.d/daily/weekly` |

Conclusão: **não há backup recente verificado** *comprovado*. Pode haver dump de 30/10 dentro das pastas `dbrem04/06`: listar **só nomes e tamanhos** delas (roteiro v1.1) pode fechar o gate sem novo dump, mas **a restauração em container descartável continua necessária** para `PASS`. **`BACKUP_GATE = BLOCKED`.**

### 6.6.1 Arquivos de configuração

`compose.prod.yml` (30/10 14:29), `.env.production` (13:33), `.env.banco` (12:31), `.env.dono` (16:10, **depois** da recriação das 15:38): `600 root:root`. `infra/nginx/default.conf` `664` (27/10). Nomes de chave: `.env.production` tem `JWT_ACCESS_SECRET` (usado pelo Explorer), `APP_VERSION` **uma vez** (sem duplicata), **sem** `GIT_COMMIT`/`BUILT_AT`; `.env.banco` tem `DATABASE_URL_APP` e `DATABASE_URL_SISTEMA`; `.env.dono` tem `DATABASE_URL`, `DATABASE_URL_MIGRATOR`, `POSTGRES_*` e `SEED_*`. O compose da `main` (que a árvore do servidor tem) exige exatamente esses arquivos: **não há defasagem de configuração** (a ressalva da 1.0.0, R03, fica descartada para o servidor).

### 6.7 Git do servidor

`HEAD` = `2c4b1b2`, ramo `main`, **árvore sem alterações**; o remoto é **SSH** (`git@github.com:layartdigital/prospectai.git`). O objeto `cebbfa6` **não existe localmente** (esperado: nada foi buscado). **Não se sabe se o servidor tem chave SSH que autentique no GitHub** (o runbook de setembro descrevia `git` sem credencial; a mudança para SSH é posterior). Se o `git fetch` falhar, a alternativa **sem credencial no servidor** é enviar um **`git bundle`** por `scp` e buscar do arquivo (plano D2). Não executei nenhuma das duas.

## 7. Estado do Explorer em relação ao servidor

O `/intelligence` sem sessão responde `307 → /login?next=%2Fintelligence` **hoje**, mesmo sem o módulo: o `middleware` da web redireciona toda rota não pública. **Esse teste não discrimina versão antiga de nova.** Discriminam: `GET /api/v1/intelligence/graph` sem sessão (**404** na API antiga; **401** na nova) e o **identificador de build do Next.js** no comentário HTML de `/login` (hoje `KFVH0MaXXOVeIbqOoZ9NV`; muda após novo build da web). O smoke foi ajustado (§S0).

## 8. Gates (resumo; detalhe no resumo executivo)

REL-01 PASS · REL-02 **FAIL** · REL-03 PARTIAL · REL-04 PASS · REL-05 PASS (delta) · REL-06 PARTIAL · REL-07 PASS · REL-08 **BLOCKED** · REL-09 **BLOCKED** · REL-10 **BLOCKED** · REL-11 PASS · REL-12 NOT_VERIFIED.

## 9. Perguntas ao proprietário (decisões, não solicitações de execução)

1. **A `api` rodar a imagem `pre-dbrem06` em vez da `:latest` é intencional?** (reversão na janela do DB-REM-06?) E o que mudou entre as duas?
2. **A stack `prospectai-prod` atende usuários ou dados reais hoje?** (decide D × C — regra de parada)
3. **Quais logs do GATE-DB-42501 precisam sobreviver, e o T1 de 01/11 foi coletado?**
4. **Quem é o processo da porta `3101`?** (ou autorizar `ss -ltnp` filtrado)
5. **As pastas `dbrem04/06` contêm um dump de 30/10?** (ou autorizar listar nomes/tamanhos)
6. **O servidor consegue `git fetch` por SSH?** (ou usar `git bundle` por `scp`)
7. **Autoriza o bloco 13 do roteiro** (catálogo do PostgreSQL, sessão forçada a somente leitura) para fechar o estado das migrations no banco?
8. Conta/workspace de teste para o smoke S2, e decisão sobre D8 e sobre o item "Intelligence" no menu (já listadas no resumo executivo).

## 10. Campos de registro (REL-A)

```text
HOST_ID                = hal-server-848101 (OBSERVADO)
PROJECT_ROOT           = /opt/apps/prospectai (OBSERVADO)
DEPLOYED_COMMIT        = 2c4b1b25fac8e4266b3505270bb43e05127c60a7 (árvore; OBSERVADO) — imagens: NOT_VERIFIED
DEPLOYED_BRANCH        = main (OBSERVADO; árvore limpa)
DEPLOYMENT_METHOD      = MANUAL: git + docker compose build no servidor (sem CI de deploy)
COMPOSE_PROJECT        = prospectai-prod (OBSERVADO)
CURRENT_SERVICE_COUNT  = 7 (OBSERVADO)
CURRENT_SERVICE_HEALTH = health=ok (database, redis, scraper ok); postgres e redis healthy; 0 reinícios (OBSERVADO)
STAGING_ARCHITECTURE   = C — domínio aponta para a stack existente (OBSERVADO)
```
