# P04-REL-01 — H. Índice de evidências

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (Documentação) · **Versão:** 1.1.1 · **Data:** 02/11/2026
**Relação com a homologação:** registra de onde veio cada afirmação dos documentos P04-REL-01. Tudo abaixo é **sanitizado**: nenhuma credencial, cookie, token ou valor de variável. `F:\drmind` (Bellvia) não foi modificado.

## 1. Comandos executados nesta rodada (todos somente leitura)

| ID | Onde | Comando (resumo) | Resultado sanitizado |
|---|---|---|---|
| E01 | sessão da Executora | `curl` HTTPS (GET) para `/`, `/login`, `/api/v1/health`, `/api/v1/system/version` do domínio de homologação | `CONNECT tunnel failed, response 403` nas 4 chamadas; o status do proxy registrou `connect_rejected` para `prospectai-stage.layart.com.br:443`. **Nenhuma resposta do domínio.** |
| E02 | sessão da Executora | `getent hosts <domínio>` | sem saída (inconclusivo: rede intermediada pelo proxy) |
| E03 | sessão da Executora | `openssl s_client` no domínio | certificado não obtido (mesmo bloqueio) |
| E04 | sessão da Executora | consulta ao status do proxy da sessão | proxy ativo; falhas `connect_rejected` registradas para o domínio |
| E05 | computador do proprietário | `get_device_info` | dispositivo respondeu; pasta conectada: `C:\ResgateProjetos\prospectai` |
| E06 | computador do proprietário | `device_bash` (DNS/HTTP/SSH) | **falhou ao iniciar a VM:** "too little free disk space … needs up to 17 GB" |
| E07 | sessão da Executora | execução de teste do roteiro `P04-REL-01-preflight-somente-leitura.sh` **no container da própria sessão** | **Não é evidência do servidor.** Provou só: sintaxe válida (`bash -n`), não grava em disco e **degrada sem falhar** quando não há Docker nem as pastas do projeto |

### 1.1 Observações do servidor feitas pelo proprietário (E08 e E09)

| ID | Onde | O que | Resultado |
|---|---|---|---|
| **E08** | servidor (`/opt/apps/prospectai`), como `root`, via `scp` + `ssh` a partir do computador do proprietário | execução **uma única vez**, em **2026-11-02T15:52:26Z**, do roteiro `P04-REL-01-preflight-somente-leitura.sh` **v1.0.0** (somente leitura; sem bloco 13) | saída em UTF-8 com BOM e CRLF, **319 linhas, 21.605 bytes**, **SHA-256 `b39e573ac6cc0b06a36afaec20b28984f0101e47f5fbd9bccbc5d1a23af864e5`** |
| **E09** | servidor, como `root`, via `scp` + `ssh` | execução **uma vez**, em **2026-11-02T16:38:19Z**, do roteiro `P04-REL-01C-leituras-somente-leitura.sh` v1.0.0 | saída (UTF-8, 259 linhas, 21.168 bytes), **SHA-256 `22d0abc521ba3659a8f0b5922fae7625a2c060e0412781fcdb0acd1de936897e`**; **sanitizada e analisada em `P04-REL-01C-RELATORIO.md`** (não é reproduzida aqui; não versionada) |

**Guarda da saída bruta.** O arquivo está com o proprietário em `C:\ResgateProjetos\prospectai\Claude outputs\preflight.txt` e **não é versionado**: o repositório é público e a saída traz caminhos, tamanhos, endereços e pastas do servidor — e, na seção 12, **nomes de pastas de outras aplicações** (defeito do roteiro v1.0, corrigido na v1.1; esses nomes **não** foram copiados para nenhum documento). Revisão da Executora: **sem segredo** (somente nomes de variável, sem valores).
(Uma primeira tentativa do proprietário, no computador pessoal, falhou por o roteiro não existir no caminho; não é evidência do servidor e não foi usada. Seu arquivo, de 7.820 bytes, **não** é E08.)

**Excertos sanitizados, por seção do roteiro** (cada fato dos documentos aponta para uma destas linhas):

| Seção | Fato observado | Gate |
|---|---|---|
| §1–§3 | host `hal-server-848101`; Ubuntu 24.04.4; kernel 6.8.0-136; uptime 2 d 21 h, carga 0,83; 6 CPUs; RAM 15.991 MB (disponível 8.259); swap 2.047 MB; `/dev/sda3` 393 GB, 193 GB livres, único sistema de arquivos de `/`, `/opt` e `/var/lib/docker`; imagens 33,07 GB, cache de build 52,74 GB (38,17 GB recuperáveis); Docker 29.7.1, Compose v5.3.1 | REL-07 |
| §4 | projeto `prospectai-prod` `running(7)`: `web`, `worker`, `postgres` (healthy), `redis` (healthy), `api`, `gateway` (`127.0.0.1:3102->80`), `gmaps-scraper`; todos com `StartedAt` 2026-10-30T18:38:22Z e 0 reinícios; projeto `propectai` (dev) `exited(3)`, 3 containers parados há ~3 semanas | REL-02, REL-06 |
| §4 | imagem em execução da `api` = `sha256:64b25a48…`; `web` = `sha256:dd9dd874…`; `worker` = `sha256:dddc34b6…` | REL-03 |
| §5 | redes `prospectai-prod_internal` (172.21.0.0/16) e `…_proxy_api` (172.30.250.0/29) só com containers do projeto; volumes `prospectai-prod_prospectai_{postgres,redis}_data`; bind do scraper `/opt/data/prospectai/gmapsdata`; bind do gateway `/opt/apps/prospectai/infra/nginx/default.conf` | REL-02, REL-06 |
| §6 | todos `mem=0`, `cpus=0`, `restart=unless-stopped`, `json-file` sem rotação; tamanhos de log `api` 72.823 B, `worker` 3.541 B, `postgres` 10.429 B, `web` 5.124 B, `gateway` 597.842 B, `redis` 2.947.718 B, `scraper` 4.957 B (só metadados) | REL-10 |
| §7 | `HEAD` `2c4b1b25fac8e4266b3505270bb43e05127c60a7`, ramo `main`, merge do PR #6 (30/10/2026 15:17 -0300), **árvore sem alterações**; remoto SSH; objeto `cebbfa6` ausente (esperado) | REL-03 |
| §8 | `compose.prod.yml`, `.env.production`, `.env.banco`, `.env.dono` `600 root:root`; só nomes de chave; sem `GIT_COMMIT`/`BUILT_AT`; imagens `prospectai-prod-api:latest` (`408bd870aa0a`, 2 d), `…api:pre-dbrem06` (`64b25a48f647`, 3 d), `…worker:latest` (4 d), `…web:latest` (3 semanas), `…web:pre-net-2b1-20261007` (4 semanas) | REL-03 |
| §9 | vhost `prospectai-stage.layart.com.br.conf`: `server_name` do domínio; `proxy_pass http://127.0.0.1:3102`; `location = /api/v1/auth/register` (conteúdo não impresso); portas `0.0.0.0:3101` e `[::]:3101` escutando, `127.0.0.1:3102` | REL-01, REL-02, REL-06 |
| §10 | pela porta local: `/login` HTML (build ID `KFVH0MaXXOVeIbqOoZ9NV`); `/api/v1/health` 200 `ok`; `/api/v1/system/version` 200 `0.1.1`, `production`, `commit: null`; `/intelligence` sem sessão 307 → `/login?next=%2Fintelligence` | REL-01, REL-03 |
| §11 | DNS → `108.174.144.216`; TLS Let's Encrypt, CN e SAN = o domínio, 2026-10-08 → 2027-01-06; HTTPS: `/` 307 `/login`; `/login` 200; `/api/v1/health` 200; `/api/v1/system/version` 200 | REL-01 |
| §12 | só entradas do projeto: `propectai-20260917.sql.gz` e `propectai-20260921-1336.sql.gz` (42.560 B, `gzip -t` íntegro), `prospectai-arvore-20260921-1726.tgz`, dois `env.production-*.bak`, pastas `prospectai-dbrem04-20261030-1230` e `prospectai-dbrem06-20261030-1523` (conteúdo não inspecionado); nenhuma rotina agendada cita o projeto | REL-08 |
| §13 | **pulado** (catálogo desligado) | REL-05 |

## 2. Evidências do repositório (commit `cebbfa6`)

| ID | Comando / arquivo | O que prova |
|---|---|---|
| R01 | `git rev-parse HEAD` → `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79` | o commit de release está na cópia de trabalho da Executora; o push foi feito pelo proprietário (log informado: `78e9fe2..cebbfa6`). A referência `origin/*` local está desatualizada: não usei o remoto para confirmar |
| R02 | `git rev-list --count origin/main..HEAD` = 7; `HEAD..origin/main` = 0; `git merge-base` = `2c4b1b2…` | a branch contém a `main` (`2c4b1b2`) e está 7 commits à frente, sem divergência |
| R03 | `git diff --stat origin/main..HEAD -- . ':!docs'` | 46 arquivos, +7.464/−9; **nenhum** arquivo em `prisma/migrations/`, `prisma/schema.prisma`, `compose.prod.yml`, `infra/` |
| R04 | `compose.prod.yml` (linhas: `name`, `proxy_api` `172.30.250.0/29`, `ipv4_address` fixos, `ports 127.0.0.1:3102`, volume `/opt/data/prospectai/gmapsdata`, volumes `prospectai_*`) | não suporta segunda stack sem override |
| R05 | `infra/nginx/default.conf` | gateway re-resolve `api`/`web` a cada 10 s; `/api/` restrito por `allow` |
| R06 | `apps/api/src/system/system.controller.ts:71-72` + busca por `GIT_COMMIT`/`BUILT_AT` em todo o repositório | o endpoint de versão lê `GIT_COMMIT`/`BUILT_AT`, **que nenhum arquivo define** → `commit: null` |
| R07 | `apps/api/src/intelligence/intelligence.controller.ts` | só `@Get('graph')` e `@Get('expand')`, com `JwtAuthGuard` + `TenantGuard` |
| R08 | `apps/api/src/intelligence/intelligence.service.ts:110` e `depth-proof.ts` | usa `JWT_ACCESS_SECRET` já existente (`getOrThrow`); nenhuma variável nova |
| R09 | `apps/web/src/lib/nav.ts` | acrescenta o item "Intelligence" ao menu |
| R10 | `.dockerignore` | exclui `.env`, `.env.*` e `.git` das imagens |
| R11 | `.github/workflows/ci.yml` | sem job de deploy; `permissions: contents: read` |
| R12 | `docs/intelligence/ATUALIZAR-AMBIENTE-ONLINE.md` (medições de 17, 21 e 22/09/2026; notas de 30/10) | **histórico** da topologia e do procedimento de deploy; **não é estado atual** |
| R13 | busca textual por `prospectai-stage` no commit | **0 ocorrências**: o domínio de homologação não está documentado no repositório |
| R14 | `docs/intelligence/p04/P04-RELATORIO-FINAL.md` §G e `P04-SEC-DATA-01-HANDOFF.md` | os contêineres de produção "preservam logs do GATE-DB-42501"; T1 de 01/11/2026 não antecipado; SEC-DATA-01 independente |

## 3. Informações fornecidas pelo proprietário (**não verificadas pela Executora**)

| ID | Informação | Observação |
|---|---|---|
| O01 | PR #7: https://github.com/layartdigital/prospectai/pull/7 | rascunho |
| O02 | CI #77: https://github.com/layartdigital/prospectai/actions/runs/41450846331 — PASS; Explorer 27/27; regressão 29/29 | as contagens foram lidas no log pelo texto do passo "Resumo dos testes" (P04-CLOSE-01) |
| O03 | CI #78: https://github.com/layartdigital/prospectai/actions/runs/41465972020 — PASS; 5/5 jobs | informado na ordem; não inspecionado |
| O04 | Artefato `e2e-evidencias` do CI #77: **ID `13143194553`**, **expiração `2026-12-02T13:15:34Z`**, **SHA-256 `7dc407ef63f8c7cf940228ebce435c326ac6bd26f4e18035bae792742fbccac6`** | consistente com `retention-days: 30` do workflow (upload em 02/11/2026). Conteúdo não inspecionado pela Executora. Entra no índice do release, **sem commit só para isso**, como a ordem determina |

## 4. O que **ainda não** tem evidência

| Tema | Estado | Como fechar |
|---|---|---|
| Natureza da stack (teste sem cliente × operacional) | NOT_VERIFIED | **declaração escrita do proprietário** |
| Origem e data de criação das imagens em execução; por que a `api` roda `pre-dbrem06` | NOT_VERIFIED | roteiro v1.1, seção 8b; resposta do proprietário |
| Processo na porta `3101` | NOT_VERIFIED | roteiro v1.1, seção 9b |
| Conteúdo do bloco `/api/v1/auth/register` do vhost | NOT_VERIFIED | roteiro v1.1, seção 9b |
| Conteúdo das pastas `dbrem04/06` (existe dump de 30/10?) | NOT_VERIFIED | roteiro v1.1, seção 12b (só nomes e tamanhos) |
| Restauração de backup | NOT_VERIFIED | teste em container descartável (execução futura, com autorização) |
| Estado do banco (migrations aplicadas, papéis) | NOT_VERIFIED | bloco 13 do roteiro, sob autorização |
| Estado do GATE-DB-42501 (T1) | NOT_VERIFIED | informação do proprietário |
| `git fetch` por SSH no servidor | NOT_VERIFIED | decisão: tentar sob autorização, ou `git bundle` + `scp` |

## 5. Mapa das seções do roteiro para os gates

Seções 1–3 → REL-07; 4–6 → REL-02/06/10; 7–8 → REL-03; 9–11 → REL-01; 12 → REL-08; 13 (opcional) → REL-05/estado do banco. Em E08, 1–12 foram executadas; a 13 foi pulada de propósito. O roteiro **v1.1.0** acrescenta as seções 8b, 9b e 12b (E09 será a saída dele, se for executado).

## 6. Hashes SHA-256 dos arquivos desta rodada

(v1.1.1; calculados sobre o conteúdo dos arquivos no commit; este índice não se auto-referencia. O roteiro está na **v1.1.0**; a v1.0.0, executada em E08, está no commit `1da1936`, SHA-256 `b60e70a955a1a8cedfaa4ab23e57995047d8a0012478919c3eea29e064372020`.)

```text
1f77e2b3ee791073ce9bc1ee753b2c6671dc33ced319dc6c8e98056f9f89023e  P04-REL-01-INFRASTRUCTURE-PREFLIGHT.md
096662e8344ac8a46044d85ac9ab9af6ccd536353fc38767461e6fe81e36895a  P04-REL-01-DEPLOYMENT-PLAN.md
db29dfa76d59e1d580c5f505dc5045783897c2f364fe85fcd938c8a1d2c6005a  P04-REL-01-ROLLBACK-PLAN.md
0a9dc697c92fd378d46ad60b6817b0e073e4344cd11b91b2cfef94c449c94694  P04-REL-01-RISK-REGISTER.md
e629e1b7fc56c38c36ea72dae6a89cf194a7540a738ee9cd2ca93fc3fca672b8  P04-REL-01-SMOKE-TEST-PLAN.md
a94c7a21ad52793d346913dc8215dfd88715c5d4ee3ae7cdf5ac77b051c3ab89  P04-REL-01-RELEASE-CHECKLIST.md
6f891aebeac429efc8bd2125b8e5cf6dfad0d0d362ddbce4c3a6f71502153bfd  P04-REL-01-EXECUTIVE-SUMMARY.md
1cde721946530ae77480e5e14df895f0c8602612c8d4c9e9604b5554d313388e  P04-REL-01-preflight-somente-leitura.sh
```
