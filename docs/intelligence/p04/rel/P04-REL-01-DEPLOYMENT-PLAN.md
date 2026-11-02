# P04-REL-01 — B. Plano de publicação (REL-B a REL-G)

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (Squad DevOps/SRE; Backend/API, Database, AppSec, QA e Documentação como apoio) · **Versão:** 1.1.0 · **Data:** 02/11/2026
**Relação com a homologação:** transforma o resultado do CI #77/#78 em procedimento de implantação. Commit de release: `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79`.
**Nada deste documento foi executado. Os comandos de alteração estão apenas apresentados.** `F:\drmind` (Bellvia) não foi modificado.

> **Condição de uso.** Este plano **não pode ser executado** enquanto os gates da §2 não estiverem `PASS` e enquanto a **regra de parada** abaixo não for resolvida pelo proprietário. **Versão 1.1.0:** o preflight real (E08, 02/11/2026) confirmou o **Cenário C**: o domínio `prospectai-stage.layart.com.br` é a própria stack `prospectai-prod`. Isso **aciona a regra de parada** "domínio de homologação associado diretamente à produção / isolamento insuficiente / banco compartilhado". O que segue é o plano **para quando o proprietário decidir** (Estratégia D, com declaração escrita, ou Estratégia C). **Correções da 1.0.0:** o snapshot de imagens passa a usar o **ID da imagem em execução** (a `api` roda `pre-dbrem06`, não `:latest`), o `pg_dump` usa o usuário de bootstrap do container sem imprimir valores, e há uma alternativa de `git bundle` caso o `git fetch` por SSH não funcione.

## 1. Estratégias avaliadas

| | **A — Imagens imutáveis construídas fora do servidor** | **B — Deploy do SHA em homologação independente existente** | **C — Montar homologação isolada** | **D — Mecanismo atual, com salvaguardas** |
|---|---|---|---|---|
| O que é | CI/estação constrói imagens, publica em registro, servidor só faz `pull` e `up` | Mesmo que D, mas numa stack de homologação **já** separada e comprovada | Novo projeto Compose com override (nome, sub-rede, porta, volumes, env files, banco próprio) | O procedimento já usado em 21–22/09: `git` + `docker compose build` no servidor + `up -d` nomeado, acrescido de retag, backup e verificação de SHA |
| Vantagens | SHA imutável por imagem; menos carga no servidor; rollback = trocar a tag | Zero impacto na stack que atende o uso corrente | Isolamento real; permite testar com segredos e banco próprios | Já existe e já foi executado com sucesso; **não exige infraestrutura nova**; escopo mínimo (2 serviços) |
| Riscos | Exige registro, credenciais de registro e job de deploy que **não existem** (`ci.yml` só tem `contents: read`) — é arquitetura nova | **Não comprovado que exista** (NOT_VERIFIED) | Compose atual **não suporta** (sub-rede/IPs/porta fixos): exige alterar infra; segundo banco e segredos novos; mais carga num servidor compartilhado | Build no servidor consome CPU/RAM/disco de uma máquina compartilhada; recria `api` e `web` da stack em uso; **se for a mesma stack da operação, o ambiente de teste é o próprio ambiente existente** |
| Pré-requisitos | Decisão e trabalho de plataforma | Prova de isolamento (REL-02) | Autorização de infra, capacidade (REL-07), DNS/TLS/vhost | Gates REL-01…REL-10 `PASS` |
| Impacto operacional | Nenhum até a existência | Nenhum na operação | Alto (infra nova) | Segundos de indisponibilidade da API e da web |

### Recomendação (única): **Estratégia D**, condicionada

**Preferida: D** — o mecanismo existente, com cinco salvaguardas (snapshot de imagens por retag, backup, exportação de logs para o GATE-DB-42501, checkout do SHA exato em HEAD destacado e verificação de que os serviços não tocados mantêm o mesmo `StartedAt`). Motivos: é o único caminho **comprovadamente já executado neste projeto**, o delta é só API + web sem migration, e não cria arquitetura paralela (a ordem pede para não criar se já existe mecanismo adequado).

**Condições para D valer** (senão a recomendação muda):

1. **Observado (E08):** o domínio de homologação **aponta para a stack `prospectai-prod`** (Cenário C). Falta o proprietário confirmar, **por escrito**, que essa stack é **ambiente de teste sem cliente nem dado real** (como descrito em 17/09). Se houver **dados ou usuários reais** na stack, publicar nela é "associado diretamente à produção": **regra de parada** (§16 da ordem), e a alternativa recomendada passa a ser **C**. A **B** foi descartada: o preflight **não encontrou** homologação independente.
2. REL-08 (backup) e REL-09 (rollback) `PASS`.
3. REL-10: decisão do proprietário sobre os logs do GATE-DB-42501 (§5, passo D1.4).

A Estratégia A fica como **evolução futura** (resolve a falta de SHA e de imagem imutável), mas é trabalho próprio, não deste release. **Não usar `latest` como identificação de versão**: o SHA é registrado em arquivo de release e, se autorizado, no endpoint (§6).

## 2. Gates de entrada (resumo; detalhe no relatório final)

| Gate | Hoje (v1.1.0) | Necessário para executar |
|---|---|---|
| REL-01 Domínio e destino | **PASS** (DNS, TLS e vhost → `127.0.0.1:3102` observados) | — |
| REL-02 Isolamento | **FAIL** (domínio = stack `prospectai-prod`) | decisão escrita do proprietário (stack = teste sem cliente) **ou** Estratégia C |
| REL-03 Commit implantado | PARTIAL (árvore `2c4b1b2` limpa; imagens não identificadas) | `image inspect` das imagens em execução |
| REL-04 Compatibilidade API/web | PASS | — |
| REL-05 Migrations | PASS (nenhuma para o delta); estado do banco NOT_VERIFIED | opcional: bloco 13 |
| REL-06 Serviços compartilhados | PARTIAL (redes/volumes só do projeto; daemon, disco, nginx compartilhados; `:3101` não identificada) | identificar a `:3101` |
| REL-07 Capacidade | **PASS** (193 GB livres; ~8 GB RAM disponíveis) | monitorar durante o build |
| REL-08 Backup | **BLOCKED** (dumps de 6 semanas, sem teste de restauração) | dump novo + restauração em container descartável |
| REL-09 Rollback | **BLOCKED** | snapshot **por ID da imagem em execução** (D1.2) |
| REL-10 Pendências preservadas | **BLOCKED** | decisão sobre logs e T1 |
| REL-11 Smoke tests | PASS | — |
| REL-12 Sem risco a outras apps | NOT_VERIFIED | `:3101` identificada; REL-02 resolvido |

### REL-A — Preflight (**executado em 02/11/2026 pelo proprietário**, somente leitura)
Saída E08 incorporada; gates reclassificados (tabela acima); este plano ajustado (1.1.0). **Itens que ainda faltam e são somente leitura** (roteiro v1.1.0): `ss -ltnp` da porta `3101`, data de criação das imagens em execução e das etiquetas, linhas do vhost do bloco `/api/v1/auth/register`, nomes/tamanhos das pastas de backup `dbrem04/06`, e (sob autorização) o bloco 13 do catálogo.

### REL-B — Preparação (documental; nada construído agora)
Artefatos serão construídos **no servidor** (Estratégia D) a partir do SHA exato, depois da autorização; por isso **nenhuma construção ocorre antes de REL-C**. Preparam-se agora: este plano, o rollback, o smoke, o checklist e o roteiro. Variáveis usadas nos comandos:

```bash
cd /opt/apps/prospectai
C="docker compose --env-file .env.production -f compose.prod.yml"   # prefixo OBRIGATÓRIO neste servidor
SHA=cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79
STAMP=$(date +%Y%m%d-%H%M)
REG=/opt/backups/p04-rel                                            # registro desta publicação
```

### REL-C — Aprovação
O proprietário recebe o relatório de prontidão, decide e autoriza **expressamente** a ordem `P04-REL-02`, listando: ambiente-alvo, janela, e as decisões da §1 (condições 1–3). Sem isso, nada abaixo roda.

### REL-D — Publicação (futura; escopo: `api` e `web` do projeto `prospectai-prod`)

Cada passo tem **verificação** e **critério de abort**. Abort = parar, não avançar, executar o rollback da fase correspondente (ver `P04-REL-01-ROLLBACK-PLAN.md`).

**D0 — Pré-condições (não toca serviço; só grava o registro em `/opt/backups/p04-rel`)**

```bash
test "$(git rev-parse --show-toplevel)" = /opt/apps/prospectai          # estou no lugar certo
git status --porcelain | grep -v '^??' | head                           # vazio = árvore limpa (alterações rastreadas)
ls -l .env.production .env.banco .env.dono                              # existem, 600 root:root
$C ps                                                                   # todos running/healthy; guardar a saída
df -h /var/lib/docker /opt; free -m                                     # espaço e memória conforme REL-07
umask 077; mkdir -p "$REG" && chmod 700 "$REG"
for c in worker gateway postgres redis gmaps-scraper api web; do
  docker inspect -f '{{.Name}} {{.State.StartedAt}}' prospectai-prod-$c-1
done > "$REG/startedat-antes-$STAMP.txt"                                # linha de base dos NÃO tocados
# NOVO (1.1.0): qual imagem cada serviço usa DE FATO (a api rodava `pre-dbrem06`, não `:latest`)
for s in api web worker; do
  echo "$s $(docker inspect -f '{{.Image}}' prospectai-prod-$s-1) criada=$(docker image inspect -f '{{.Created}}' "$(docker inspect -f '{{.Image}}' prospectai-prod-$s-1)")"
done | tee "$REG/imagens-em-execucao-$STAMP.txt"
# linha de base dos discriminadores de versão (GET; não grava):
curl -s -o /dev/null -w 'graph sem sessao ANTES -> %{http_code}\n' 'http://127.0.0.1:3102/api/v1/intelligence/graph?leadId=00000000-0000-0000-0000-000000000000' | tee -a "$REG/baseline-http-$STAMP.txt"   # esperado 404 (módulo ainda não existe)
curl -s http://127.0.0.1:3102/login | grep -o '<!--[A-Za-z0-9_-]\{15,\}-->' | head -1 | tee -a "$REG/baseline-http-$STAMP.txt"  # build ID atual
```
*Abort:* qualquer serviço não saudável **antes** de começar (o problema seria atribuído ao release); `.env.banco`/`.env.dono` ausentes (a árvore nova traria um compose que os exige — **observado: presentes em 02/11**); árvore com alteração local rastreada inexplicada (**observado: limpa em 02/11**). *Alerta:* se `imagens-em-execucao` mostrar que `api` ≠ `:latest`, **registrar o porquê** (pergunta 1 do preflight) antes de seguir.

**D1 — Salvaguardas (só escrevem em `/opt/backups`; não tocam serviço)**

```bash
umask 077; mkdir -p "$REG" && chmod 700 "$REG"          # dump e logs podem ter dado pessoal: só root

# D1.1 SHA e estado anterior
git rev-parse HEAD            > "$REG/sha-anterior-$STAMP.txt"
git log -1 --format='%H %ci %s' >> "$REG/sha-anterior-$STAMP.txt"

# D1.2 Snapshot das imagens EM EXECUÇÃO (caminho de volta do rollback). Etiquetar não altera container.
# CORREÇÃO 1.1.0: pelo ID da imagem do CONTAINER, não por `:latest` (a api roda `pre-dbrem06`; a `:latest` é outra).
for s in api web; do
  id=$(docker inspect -f '{{.Image}}' prospectai-prod-$s-1)
  echo "$s $id" >> "$REG/imagens-anteriores-$STAMP.txt"
  docker tag "$id" prospectai-prod-$s:pre-p04-$STAMP
done
cat "$REG/imagens-anteriores-$STAMP.txt"                                  # os IDs têm de bater com imagens-em-execucao

# D1.3 Backup do banco (a publicação não altera o banco, mas é o gate REL-08) + integridade
# usuário e banco vêm do ambiente do próprio container (nada é impresso). Tem de ser o usuário de bootstrap: com RLS forçada,
# um papel sem BYPASSRLS produziria dump incompleto ou com erro.
docker exec prospectai-prod-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$REG/propectai-$STAMP.sql.gz"
test "${PIPESTATUS[0]}" = 0 && gzip -t "$REG/propectai-$STAMP.sql.gz" && sha256sum "$REG/propectai-$STAMP.sql.gz" | tee "$REG/propectai-$STAMP.sha256"

# D1.4 Logs do GATE-DB-42501 — SÓ SE o proprietário decidir preservar (ver §5). Recriar `api` descarta o log do container.
mkdir -p "$REG/logs-$STAMP" && chmod 700 "$REG/logs-$STAMP"
for c in api worker postgres; do docker logs --timestamps prospectai-prod-$c-1 > "$REG/logs-$STAMP/$c.log" 2>&1; done
sha256sum "$REG/logs-$STAMP"/*.log > "$REG/logs-$STAMP/SHA256SUMS"
```
*Nota:* o `pg_dump` segue o runbook de 21/09 (socket local do container), agora sem nome de usuário fixo. **Observado (E08 §8):** `.env.dono` tem `POSTGRES_USER`/`POSTGRES_DB`; **não observado:** que o container os receba nem que o usuário seja superusuário (bloco 13). Se o `pg_dump` falhar, **parar** e reavaliar — não usar outro superusuário como atalho. Antes de gravar um dump novo, **listar nomes e tamanhos** das pastas `prospectai-dbrem04/06-*` em `/opt/backups`: se já houver dump de 30/10, ele pode ser **complemento**, mas a restauração de teste continua obrigatória. Os logs podem conter dados pessoais: arquivos `600`, só em `/opt/backups`, fora do repositório.
*Teste de restauração (recomendado, fecha REL-08):* subir um Postgres descartável **sem volume** (`docker run --rm --name propectai-restoretest -e POSTGRES_PASSWORD=<gerada na hora> -d postgres:16-alpine`; prefixo `propectai-`), restaurar o dump nele (erros de papéis inexistentes são esperados no banco descartável; o critério é o número de tabelas e de linhas de `_prisma_migrations`), remover o container. Não usa o banco real.
*Abort:* dump com erro, `gzip -t` falhando, ou `/opt/backups` sem espaço.

**D2 — Trazer o SHA exato (HEAD destacado; não mexe na branch `main` do servidor)**

```bash
# Opção 1 (se o servidor autenticar por SSH no GitHub — NÃO verificado; o remoto é git@github.com):
git fetch origin feat/prompt-04-intelligence-explorer      # autorização específica: proibido nesta ordem
# Opção 2 (sem credencial no servidor): bundle incremental enviado por scp pelo proprietário
#   git fetch /opt/backups/p04-rel/PROSPECTAI-P04-REL01.bundle feat/prompt-04-intelligence-explorer:refs/p04/candidato
git cat-file -e "$SHA^{commit}"                            # o objeto existe
git checkout --detach "$SHA"                               # falha sem sobrescrever se houver conflito local
test "$(git rev-parse HEAD)" = "$SHA" && echo "SHA confirmado"
git diff --stat "$(cat $REG/sha-anterior-$STAMP.txt | head -1)" HEAD -- compose.prod.yml infra/ prisma/migrations | tail -5
```
*Verificação:* o último comando mostra **o que mudaria de configuração/infra/migration** em relação ao que estava no servidor. Esperado quando o servidor já está na `main`: **vazio** (**confirmado no repositório:** `2c4b1b2` → `cebbfa6` não altera compose, infra nem migrations; **observado:** o servidor está em `2c4b1b2`). Se aparecer `compose.prod.yml`, `infra/` ou migrations, o servidor está defasado: **abort** e voltar ao proprietário (isso é fora do escopo do Explorer).
*Por que `--detach` e não `checkout -B main`:* o runbook antigo usava `-f -B main origin/main` porque a árvore era cópia sem histórico; agora deve haver árvore limpa e nada justifica forçar. `--detach` preserva a branch local e deixa o SHA inequívoco.

**D3 — Validações sem tocar serviço**

```bash
bash infra/scripts/checar-segredos-compose.sh             # a mesma regra que o CI aplica ao compose
# Só se infra/nginx/default.conf diferir do que o gateway usa (esperado: não difere):
# docker run --rm -v "$PWD/infra/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t
```

**D4 — Construir só `api` e `web` (cria imagem nova ao lado da antiga; não toca container)**

```bash
nice -n 10 $C build api web                               # NÃO construir o worker: nada nele mudou
docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}' | grep -E '^prospectai-prod-(api|web)'
```
*Verificação:* exit 0 nos dois; imagem `:latest` com ID **diferente** do registrado em D1.2; gravar `imagens-novas-$STAMP.txt` (IDs e `Created`). *Capacidade:* sem limites de recurso nos containers (E08 §6): acompanhar `free -m` e `uptime` em outra sessão durante o build; abortar se a memória disponível cair abaixo de ~2 GB. **Efeito colateral a saber:** o build desloca a etiqueta `:latest` das duas imagens; o snapshot de D1.2 já guardou as anteriores por ID. `.dockerignore` exclui `.env*` e `.git`: nenhum segredo entra na imagem.
*Abort:* falha de build (nada foi alterado em runtime), falta de disco/memória, ou carga que afete outras aplicações (acompanhar `uptime`/`free`).

**D5 — Recriar a API (primeiro: os endpoints novos são aditivos e a web antiga os ignora)**

```bash
$C up -d --no-build --no-deps api                         # recria só a api; IP fixo 172.30.250.3 preservado
for i in $(seq 1 30); do
  s=$(curl -s http://127.0.0.1:3102/api/v1/health | grep -o '"status":"[a-z]*"'); echo "$i $s"
  echo "$s" | grep -q '"status":"ok"' && break; sleep 3
done
curl -s -o /dev/null -w 'intelligence sem sessao -> %{http_code} (esperado 401)\n' 'http://127.0.0.1:3102/api/v1/intelligence/graph?leadId=00000000-0000-0000-0000-000000000000'
$C exec -T api printenv DATABASE_URL_APP | sed -E 's#:[0-9a-f]{48}@#:***@#'   # tem de mostrar propectai_app (nunca o dono)
docker logs --since 3m prospectai-prod-api-1 2>&1 | grep -ciE 'CredencialDeBancoAusente|ECONNREFUSED|Nest application failed' # esperado 0
docker inspect -f '{{.RestartCount}}' prospectai-prod-api-1                  # esperado 0
```
*Critérios de sucesso:* `status` `ok` (**estado observado em 02/11: `ok`**, com `database`, `redis` e `scraper` `ok`; `degraded` só pelo scraper se for o estado de D0); `intelligence/graph` sem sessão **401**; usuário do banco `propectai_app`; sem erro no log; sem reinício. *Abort:* `status` ≠ `ok`/estado anterior após 90 s; 404 em `/intelligence` (módulo não carregou); `RestartCount` > 0; qualquer erro de credencial. → **Rollback da API** (§ do plano de rollback).

**D6 — Recriar a web**

```bash
$C up -d --no-build --no-deps web
for p in /login /dashboard; do curl -s -o /dev/null -w "$p -> %{http_code}\n" "http://127.0.0.1:3102$p"; done
curl -s -o /dev/null -w '/intelligence sem sessao -> %{http_code} %{redirect_url}\n' http://127.0.0.1:3102/intelligence   # 307 -> /login?next=...  (NÃO discrimina versão: já é assim hoje)
curl -s http://127.0.0.1:3102/login | grep -o '<!--[A-Za-z0-9_-]\{15,\}-->' | head -1   # build ID do Next: hoje <!--KFVH0MaXXOVeIbqOoZ9NV-->; tem de MUDAR
docker inspect -f '{{.RestartCount}}' prospectai-prod-web-1
```
*Abort:* `/login` ≠ 200; `RestartCount` > 0; erro de renderização. → **Rollback da web**, depois da API se necessário.

**D7 — Prova de que nada mais foi tocado**

```bash
for c in worker gateway postgres redis gmaps-scraper; do docker inspect -f '{{.Name}} {{.State.StartedAt}}' prospectai-prod-$c-1; done > "$REG/startedat-depois-$STAMP.txt"
diff <(grep -v -E '/prospectai-prod-(api|web)-1' "$REG/startedat-antes-$STAMP.txt") "$REG/startedat-depois-$STAMP.txt" && echo "serviços não tocados: StartedAt idêntico"
```
*Abort:* qualquer diferença nos serviços que não deveriam reiniciar.

**D8 — Registro do SHA no endpoint (opcional; exige autorização própria)**
Hoje `/api/v1/system/version` devolve `commit: null` porque `GIT_COMMIT` nunca é definido. Sem alterar código, basta acrescentar ao `.env.production` (lido pela `api` via `env_file`) duas linhas **sem segredo**: `GIT_COMMIT=<SHA>` e `BUILT_AT=<data ISO UTC>`, seguidas de `$C up -d --no-build --no-deps api`. É uma **edição de arquivo de ambiente** (proibida nesta ordem) e **recria a API mais uma vez**; por isso é opcional e fica para decisão do proprietário. Sem ela, o SHA é provado pelo arquivo de release (§6) e por `git rev-parse HEAD` no servidor.

### REL-E — Smoke tests
Executar `P04-REL-01-SMOKE-TEST-PLAN.md` (camadas S0 a S4). **Critério de saída:** todos os testes obrigatórios `PASS`, nenhuma evidência de vazamento entre workspaces, serviços não tocados com `StartedAt` idêntico.

### REL-F — Aceitação
O proprietário testa com contas de homologação autorizadas. Aceita ou aciona o rollback (gatilhos no plano de rollback). **Só depois da aceitação** decide-se o merge do PR #7 (a árvore já implantada é idêntica à da `main` pós-merge se o merge for sem alteração; conferir com `git diff <SHA> main --stat`).

### REL-G — Encerramento
Preencher o registro de release, atualizar índice e changelog (commit só documental), anexar ao índice o ID/expiração/SHA-256 do artefato do CI #77 (§6 do índice de evidências).

## 4. Impacto operacional esperado

| Serviço | Ação | Indisponibilidade esperada | Efeito para usuário |
|---|---|---|---|
| `api` | recriar (nova imagem) | segundos | requisições em curso falham uma vez; **sessões permanecem** (mesmo `JWT_ACCESS_SECRET`) |
| `web` | recriar (nova imagem) | segundos | recarregar a página |
| `gateway` | nenhuma (resolve `api`/`web` a cada 10 s) | — | — |
| `worker`, `postgres`, `redis`, `gmaps-scraper` | **nenhuma** | — | filas e coletas seguem |
| Outras aplicações do servidor | nenhuma | — | só há **carga de CPU/RAM/disco durante o build (D4)**; acompanhar |

## 5. GATE-DB-42501 e a recriação de containers

**Observado (E08 §6):** todos os containers usam `json-file` **sem rotação**; os logs de `api` (72.823 B), `worker` (3.541 B) e `postgres` (10.429 B) somam menos de 90 KB, então exportá-los com hash é barato. Isso **não** decide o que o GATE-DB-42501 exige.

O log de um container Docker pertence ao container: **recriar `api` descarta o log da instância anterior** (e o do `web`). O repositório registra que os contêineres de produção "preservam logs do GATE-DB-42501", sem dizer **de quais serviços** nem o estado do T1 (data planejada: 01/11/2026, já passada). Por isso:

1. O proprietário precisa dizer **quais logs** precisam sobreviver e se o T1 já foi coletado.
2. Se precisarem, D1.4 exporta os logs com `sha256sum` **antes** de recriar. Isso é uma **escrita de arquivo no servidor** (autorização).
3. **Nunca recriar `postgres`** neste release (ele não está no escopo); recriá-lo destruiria o log do banco, que é a evidência mais provável.
4. O Explorer **não** altera o GATE-DB-42501, o SEC-DATA-01 (`SEC-DATA-01 = OPEN / NOT_EXECUTED`) nem o SEC-DB-02 (`NOT_STARTED`).

Até a decisão, **`DB_42501_PRESERVATION = BLOCKED`**.

## 6. Versionamento e identificação

| Item | Valor |
|---|---|
| Versão da aplicação | `0.1.1` (variável `APP_VERSION` já exigida pelo compose; **não alterar** por causa da homologação) |
| Versão do módulo | `0.1.0` (documentos do P04; a UI não a exibe) |
| Commit implantado | SHA em HEAD destacado + `sha-anterior-<STAMP>.txt`; endpoint **só** com a opção D8 |
| Imagens | IDs registrados em `imagens-anteriores-<STAMP>.txt` e `imagens-novas-<STAMP>.txt` |
| Registro de release | arquivo `$REG/release-<STAMP>.txt` com: SHA, data/hora UTC, ambiente, versão da app e do módulo, referência ao CI (#77, #78), resultado do smoke, e histórico de rollback se houver |

Como o usuário consulta a versão: o rodapé mostra `PropectAI v0.1.1`; `/api/v1/system/version` mostra nome, versão, ambiente e (com D8) commit e hora de build.

## 7. Comandos que **nunca** entram neste plano

`docker system/volume/network prune`, `docker compose down`, `--remove-orphans`, `up -d` sem nome de serviço, `docker compose config` (imprimiria segredos), `docker restart` em massa, `git reset --hard`, `git pull`, qualquer comando em outro projeto Compose, qualquer `ALTER/GRANT/REVOKE` e qualquer uso de superusuário para "consertar" privilégio.

## 7.1 Raio de impacto real (observado + hipótese)

Recriar `api` e `web` a partir da árvore `cebbfa6` entrega **o Explorer mais tudo o que a `main` mudou desde a build das imagens em execução**. Pelo `git log`, os commits de runtime desde 01/10 são `1404989`, `077fc9c`, `aba2ee7`, `1e467fa`, `4052aa7` e `239ff0e`; as demais mudanças de 30/10 são migrations ou compose. **Hipótese (não provada):** as imagens atuais já os contêm (web ~3 semanas, `api` ~3 dias), e o delta efetivo é só o Explorer. **Prova:** comparar `Created` das imagens (D0) com as datas desses commits. Se a diferença for maior, o teste de regressão do smoke S3 deixa de ser opcional.

## 8. Evidências a coletar na execução

`startedat-antes/depois`, `sha-anterior`, `imagens-anteriores/novas`, dump + `sha256`, logs exportados + `SHA256SUMS`, saídas de D5/D6 (códigos HTTP, `RestartCount`, usuário do banco), resultado do smoke com capturas sintéticas, registro de release. Nenhuma contém segredo; conferir antes de anexar.
