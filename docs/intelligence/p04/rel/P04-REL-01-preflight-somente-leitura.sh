#!/usr/bin/env bash
# =============================================================================
# P04-REL-01 — Preflight SOMENTE LEITURA do servidor do ProspectAI
# Responsavel: Executora (Squad DevOps/SRE) · versao 1.1.0 · 02/11/2026
#
# FINALIDADE
#   Responder, com evidencia observada, as perguntas da fase REL-A do P04-REL-01
#   (topologia, isolamento, commit implantado, capacidade, backup, logs). O
#   resultado alimenta os gates REL-01, 02, 03, 06, 07, 08 e 10.
#
# STATUS: a v1.0.0 foi EXECUTADA pelo proprietario em 02/11/2026 15:52 UTC (saida E08).
#   Esta v1.1.0 e PROPOSTA, NAO EXECUTADA. Mudancas em relacao a v1.0.0:
#     - a secao 12 passa a listar so entradas do projeto (a v1.0.0 imprimiu tambem
#       nomes de pastas de outras aplicacoes em /opt/backups: isolamento violado);
#     - nova secao 8b: criacao das imagens em execucao e das etiquetas do projeto;
#     - nova secao 9b: processo da porta 3101 e bloco do vhost de /auth/register;
#     - nova secao 12b: nomes e tamanhos (so isso) das pastas dbrem04/dbrem06.
#   Continua somente leitura. Quem rodar e o proprietario, ou a Executora depois de
#   uma autorizacao especifica.
#
# O QUE ELE FAZ
#   Somente comandos que leem: `docker ps/inspect/ls/version`, `docker compose
#   ps/ls`, `git rev-parse/status/log/diff`, `ls`, `stat`, `df`, `free`, `ss`,
#   `curl` (GET/HEAD), `openssl s_client` e `gzip -t`.
#   NAO escreve em disco (a saida vai para o stdout; redirecione se quiser:
#   `bash este.sh > preflight.txt 2>&1`), NAO altera container, rede, volume,
#   arquivo de configuracao nem banco.
#
# O QUE ELE NUNCA IMPRIME
#   Valores de variaveis de ambiente, conteudo de `.env*`, `docker compose
#   config`, `docker inspect` sem filtro (que mostraria `Config.Env`), conteudo
#   de logs, chaves privadas, URLs com credencial (o `git remote` passa por
#   sanitizacao). Dos arquivos `.env*` saem so permissao, dono, data e NOMES de
#   chave.
#
# ISOLAMENTO ENTRE PROJETOS
#   O servidor hospeda outras aplicacoes. Todo filtro abaixo limita a saida ao
#   que casa com `prospectai|propectai`. Nenhum inventario das outras stacks.
#
# BLOCO OPCIONAL (desligado por padrao): consulta de catalogo do PostgreSQL
#   (papeis e migrations aplicadas), com a sessao forcada para somente leitura.
#   So roda com  P04_LER_CATALOGO=1  e depois de autorizacao do proprietario.
#
# USO
#   bash P04-REL-01-preflight-somente-leitura.sh                 # tudo, menos o catalogo
#   DOMINIO=outro.exemplo.com bash ...                           # outro dominio
#   P04_LER_CATALOGO=1 bash ...                                  # inclui o catalogo
# =============================================================================
set -u
# Sem `set -e`: um comando que falha nao pode esconder as secoes seguintes.
umask 077

RAIZ="${RAIZ:-/opt/apps/prospectai}"
PROJETO="${PROJETO:-prospectai-prod}"
DOMINIO="${DOMINIO:-prospectai-stage.layart.com.br}"
FILTRO='prospectai|propectai'

secao() { printf '\n=================== %s ===================\n' "$1"; }
tem()   { command -v "$1" >/dev/null 2>&1; }
# Executa o comando; se falhar, registra e segue.
tente() { "$@" 2>&1 || echo "[aviso] comando falhou ou indisponivel: $1"; }

secao "0. Carimbo"
date -u +'UTC %Y-%m-%dT%H:%M:%SZ'
echo "script: P04-REL-01-preflight-somente-leitura v1.1.0 (somente leitura)"

secao "1. Host (HOST_ID)"
hostname 2>&1
grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release 2>&1
uname -r
uptime

secao "2. Capacidade (CAPACITY_GATE) — sem limpeza de nada"
echo "CPUs: $(nproc 2>/dev/null)"
tente free -m
for p in / "$RAIZ" /opt/backups /opt/data/prospectai /var/lib/docker; do
  [ -e "$p" ] && df -h "$p" | tail -n +2
done
echo "--- uso do Docker (resumo; NAO e prune) ---"
tem docker && tente docker system df

secao "3. Docker e Compose"
if tem docker; then
  tente docker version --format 'docker cliente={{.Client.Version}} servidor={{.Server.Version}}'
  tente docker compose version
else
  echo "docker nao encontrado neste host"
fi

secao "4. Containers do ProspectAI (projeto $PROJETO e qualquer outro com o nome)"
if tem docker; then
  docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>&1 | grep -iE "$FILTRO" || echo "(nenhum container casa com $FILTRO)"
  echo "--- projetos Compose cujo nome casa (outros projetos nao sao listados) ---"
  docker compose ls -a 2>&1 | head -1
  docker compose ls -a 2>&1 | grep -iE "$FILTRO|stage|homolog" || echo "(nenhum projeto Compose casa)"
  echo "--- estado por container: inicio, reinicios, saude, imagem, rotulos do Compose ---"
  for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -iE "$FILTRO"); do
    docker inspect -f '{{.Name}} | inicio={{.State.StartedAt}} | status={{.State.Status}} | reinicios={{.RestartCount}} | saude={{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}} | imagem={{.Image}} | projeto={{index .Config.Labels "com.docker.compose.project"}} | pasta={{index .Config.Labels "com.docker.compose.project.working_dir"}} | arquivos={{index .Config.Labels "com.docker.compose.project.config_files"}}' "$c" 2>&1
  done
else
  echo "docker nao encontrado"
fi

secao "5. Redes e volumes (so os que casam) — isolamento e compartilhamento"
if tem docker; then
  for n in $(docker network ls --format '{{.Name}}' 2>/dev/null | grep -iE "$FILTRO"); do
    docker network inspect -f '{{.Name}} | driver={{.Driver}} | sub-rede={{range .IPAM.Config}}{{.Subnet}} {{end}}| containers_conectados={{range .Containers}}{{.Name}} {{end}}' "$n" 2>&1
  done
  echo "--- volumes ---"
  docker volume ls --format '{{.Name}}' 2>&1 | grep -iE "$FILTRO" || echo "(nenhum volume casa)"
  echo "--- bind mounts do scraper/dados (so caminhos) ---"
  for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -iE "$FILTRO"); do
    docker inspect -f '{{.Name}} mounts: {{range .Mounts}}[{{.Type}} {{.Source}} -> {{.Destination}}] {{end}}' "$c" 2>&1
  done
fi

secao "6. Limites de recurso, politica de restart e rotacao de log (DB_42501_PRESERVATION)"
if tem docker; then
  for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -iE "$FILTRO"); do
    docker inspect -f '{{.Name}} | mem={{.HostConfig.Memory}} | cpus={{.HostConfig.NanoCpus}} | restart={{.HostConfig.RestartPolicy.Name}} | driver_log={{.HostConfig.LogConfig.Type}} {{.HostConfig.LogConfig.Config}} | arquivo_log={{.LogPath}}' "$c" 2>&1
    lp="$(docker inspect -f '{{.LogPath}}' "$c" 2>/dev/null)"
    [ -n "$lp" ] && [ -e "$lp" ] && stat -c '   tamanho_log=%s bytes  modificado=%y' "$lp" 2>&1
  done
  echo "(so tamanho e data do arquivo de log; o CONTEUDO nao e lido)"
fi

secao "7. Git do servidor (DEPLOYED_COMMIT / DEPLOYED_BRANCH)"
if [ -d "$RAIZ/.git" ]; then
  git -C "$RAIZ" rev-parse HEAD 2>&1
  echo "ramo: $(git -C "$RAIZ" branch --show-current 2>&1)  (vazio = HEAD destacado)"
  git -C "$RAIZ" log -1 --format='%h %ci %s' 2>&1
  echo "--- remote (credenciais mascaradas) ---"
  git -C "$RAIZ" remote -v 2>&1 | sed -E 's#//[^@/ ]+@#//***@#'
  echo "--- alteracoes locais (so nomes; vazio = arvore limpa) ---"
  git -C "$RAIZ" status --porcelain 2>&1 | head -40
  echo "--- o commit homologado existe localmente? (nao faz fetch) ---"
  git -C "$RAIZ" cat-file -t cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79 2>&1 | head -1
else
  echo "$RAIZ/.git nao existe"
fi

secao "8. Arquivos de configuracao (so metadados e NOMES de chave)"
for f in compose.prod.yml .env.production .env.banco .env.dono infra/nginx/default.conf; do
  [ -e "$RAIZ/$f" ] && stat -c '%A %U:%G %y %n' "$RAIZ/$f" 2>&1 || echo "ausente: $f"
done
for f in .env.production .env.banco .env.dono; do
  if [ -r "$RAIZ/$f" ]; then
    echo "--- nomes de chave em $f (sem valores) ---"
    grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$RAIZ/$f" | tr -d '=' | sort | uniq -c | awk '{ if ($1>1) print $2" (x"$1", DUPLICADA)"; else print $2 }'
  fi
done
echo "--- tem GIT_COMMIT / BUILT_AT no .env.production? ---"
grep -cE '^(GIT_COMMIT|BUILT_AT)=' "$RAIZ/.env.production" 2>/dev/null || true
echo "--- imagens do projeto ---"
tem docker && docker image ls --format '{{.Repository}}:{{.Tag}} | {{.ID}} | {{.CreatedSince}} | {{.Size}}' 2>&1 | grep -iE "$FILTRO"

secao "8b. Imagens em execucao x etiquetas: ID completo e data de criacao (so metadados)"
if tem docker; then
  for s in api web worker; do
    c="${PROJETO}-${s}-1"
    id="$(docker inspect -f '{{.Image}}' "$c" 2>/dev/null)"
    [ -n "$id" ] && echo "em execucao: $s -> ${id#sha256:} criada=$(docker image inspect -f '{{.Created}}' "$id" 2>/dev/null)"
  done
  docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^prospectai-prod-(api|web|worker):' | while read -r t; do
    echo "etiqueta: $t -> $(docker image inspect -f '{{.Id}} criada={{.Created}}' "$t" 2>/dev/null | sed 's/^sha256://')"
  done
fi

secao "9. Proxy do host (so as linhas que importam, so dos arquivos do ProspectAI)"
for d in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
  [ -d "$d" ] || continue
  for f in $(grep -rlE "$FILTRO|3102|$DOMINIO" "$d" 2>/dev/null); do
    echo "--- $f ---"
    grep -nE '^\s*(server_name|listen|proxy_pass|ssl_certificate |return|include|root|location)\b' "$f" 2>&1
  done
done
echo "--- portas locais relevantes (so estas) ---"
tem ss && ss -ltn 2>/dev/null | grep -E ':(3100|3101|3102|3103|5434|6381|8081)\b'

secao "9b. Quem escuta a 3101 (so esta porta) e bloco do vhost de /auth/register"
tem ss && ss -ltnp 2>/dev/null | grep -E ':3101\b' | sed -E 's/users:\(\(/processo: (/'
VH="/etc/nginx/sites-enabled/${DOMINIO}.conf"
if [ -r "$VH" ]; then
  echo "--- bloco 'location = /api/v1/auth/register' em $VH (ate 20 linhas; sem diretivas de TLS) ---"
  grep -n -A20 -E '^\s*location = /api/v1/auth/register' "$VH" 2>&1 | grep -viE 'ssl_|certificate|key' | head -22
fi

secao "10. HTTP local pela porta do gateway (GET/HEAD; nao cria nada)"
if tem curl; then
  for p in /login /api/v1/health /api/v1/system/version; do
    echo "--- GET http://127.0.0.1:3102$p ---"
    # O corpo vai para uma variavel (nada e gravado em disco).
    r="$(curl -sS -m 10 -w '\nhttp=%{http_code}' "http://127.0.0.1:3102$p" 2>&1)"
    printf '%s\n' "$r" | head -c 700; echo
  done
  echo "--- /intelligence sem sessao (esperado: redirecionamento ao login, nao 200) ---"
  curl -sS -m 10 -o /dev/null -w 'http=%{http_code} destino=%{redirect_url}\n' "http://127.0.0.1:3102/intelligence" 2>&1
fi

secao "11. Lado publico: DNS, TLS e HTTP de $DOMINIO (rode tambem de FORA do servidor)"
getent hosts "$DOMINIO" 2>&1 || echo "(nome nao resolve neste ponto)"
if tem openssl; then
  echo | timeout 15 openssl s_client -connect "$DOMINIO:443" -servername "$DOMINIO" 2>/dev/null \
    | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>&1 | head -8
fi
if tem curl; then
  for p in / /login /api/v1/health /api/v1/system/version; do
    echo "--- GET https://$DOMINIO$p ---"
    r="$(curl -sS -m 15 -D - -w '\nhttp=%{http_code}' "https://$DOMINIO$p" 2>&1 | grep -iv '^set-cookie')"
    printf '%s\n' "$r" | head -c 900; echo
  done
fi

secao "12. Backups (BACKUP_GATE) — existencia, data, integridade do gzip; NAO restaura"
if [ -d /opt/backups ]; then
  # v1.1.0: SO entradas do projeto (a v1.0.0 listava tudo e expunha nomes de outras aplicacoes)
  ls -l --time-style=long-iso /opt/backups 2>&1 | grep -iE "$FILTRO|^total"
  for f in $(ls -t /opt/backups/*.sql.gz 2>/dev/null | head -3); do
    if gzip -t "$f" 2>/dev/null; then echo "gzip integro: $f"; else echo "GZIP COM ERRO: $f"; fi
  done
else
  echo "/opt/backups nao existe"
fi
secao "12b. Pastas de backup das janelas DB-REM (so nomes e tamanhos; conteudo NAO e lido)"
for d in /opt/backups/prospectai-dbrem04-* /opt/backups/prospectai-dbrem06-*; do
  [ -d "$d" ] || continue
  echo "--- $d ---"
  ls -l --time-style=long-iso "$d" 2>&1 | awk 'NR>1 {printf "%s %s %s %s\n", $5, $6, $7, $8}'
done
echo "--- rotinas agendadas que citam o projeto (so nomes de arquivo) ---"
grep -rIl -iE "$FILTRO" /etc/cron.d /etc/cron.daily /etc/cron.weekly 2>/dev/null
echo "(integridade do gzip NAO prova restauracao; o teste de restauracao esta no plano de rollback)"

secao "13. OPCIONAL — catalogo do PostgreSQL (somente leitura; exige P04_LER_CATALOGO=1)"
if [ "${P04_LER_CATALOGO:-0}" = "1" ] && tem docker; then
  PG="$(docker ps --format '{{.Names}}' | grep -E '^prospectai-prod-postgres-1$' | head -1)"
  if [ -n "$PG" ]; then
    # PGOPTIONS forca a sessao a recusar qualquer escrita.
    docker exec -e PGOPTIONS='-c default_transaction_read_only=on' -i "$PG" \
      psql -U propectai -d propectai -At -v ON_ERROR_STOP=1 <<'SQL' 2>&1
select 'sessao_somente_leitura=' || current_setting('transaction_read_only');
select 'papel: ' || rolname || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls from pg_roles where rolname like 'propectai%' order by 1;
select 'migrations aplicadas=' || count(*) || ' ultima=' || coalesce(max(migration_name),'-') from _prisma_migrations where finished_at is not null;
select 'migrations com falha/pendentes=' || count(*) from _prisma_migrations where finished_at is null;
SQL
  else
    echo "container prospectai-prod-postgres-1 nao encontrado"
  fi
else
  echo "(pulado: catalogo desligado por padrao. Ligar so com autorizacao.)"
fi

secao "FIM"
echo "Nada foi alterado. Revise a saida antes de compartilha-la: ela nao deve conter segredos, mas confira."
