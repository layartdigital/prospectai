#!/usr/bin/env bash
# =============================================================================
# P04-REL-01C — Leituras complementares SOMENTE LEITURA do servidor do ProspectAI
# Responsavel: Executora (DevOps/SRE, Database, AppSec) · versao 1.0.0 · 02/11/2026
#
# AUTORIZACAO: decisao do proprietario P04-REL-01C (02/11/2026): leituras
#   complementares, SOMENTE LEITURA. Este roteiro e PROPOSTO, NAO EXECUTADO pela
#   Executora (ela nao tem canal para o servidor). Quem roda e o proprietario,
#   como root, e devolve a saida.
#
# O QUE ELE INVESTIGA (uma secao por objetivo da ordem)
#   A  imagem `pre-dbrem06` e o historico de imagens da API
#   B  backups do ProspectAI (so nomes, datas, tamanhos, tipo de arquivo)
#   C  logs dos containers do GATE-DB-42501 (so metadados; o CONTEUDO nao e lido)
#   D  quem escuta a porta 3101
#   E  regra do nginx para /api/v1/auth/register (so diretivas necessarias)
#
# O QUE ELE NAO FAZ (e nunca fara)
#   - nao escreve em disco, nao cria/inicia/para/reinicia/remove container,
#     nao altera etiqueta, imagem, rede, volume, firewall, nginx, banco ou .env;
#   - nao roda `docker exec`, `docker logs`, `docker compose config`,
#     `docker history`, `nginx -T`, `docker inspect` sem filtro;
#   - nao abre conteudo de backup, de log, de .env* nem de arquivo de chave;
#   - nao roda o bloco opcional de catalogo do PostgreSQL;
#   - nao faz POST: so GET/HEAD.
#
# O QUE PODE APARECER NA SAIDA (revise antes de enviar)
#   - nomes de pastas/arquivos do projeto; datas; tamanhos; hashes SHA-256 de logs
#     (hash, nao conteudo); NOMES de variavel (sem valor); usuario (so o nome) de
#     DATABASE_URL_APP/SISTEMA; so o campo "time" da primeira e da ultima linha de
#     cada log; diretivas do nginx de /auth/register com valores sensiveis omitidos.
#   - SECAO D: se a porta 3101 for de OUTRA aplicacao, o nome do container dela
#     aparece na saida (necessario para identificar). A Executora NAO o copiara para
#     documentos do repositorio (publico).
#   - Raramente, a secao A6 imprime linhas do historico do shell do root que citam
#     docker/compose + o projeto, com senha/token/URL com credencial mascarados.
#     Se preferir, rode com  P04_SEM_HISTORICO=1  para pular A6.
#
# USO (no servidor, como root)
#   bash P04-REL-01C-leituras-somente-leitura.sh > rel01c.txt 2>&1
#   (ou, do seu computador:  ssh root@108.174.144.216 "bash /tmp/P04-REL-01C-leituras-somente-leitura.sh" | Out-File -Encoding utf8 rel01c.txt )
#   Depois confira que nao ha segredo no arquivo e envie.
# =============================================================================
set -u
umask 077

RAIZ="${RAIZ:-/opt/apps/prospectai}"
PROJETO="${PROJETO:-prospectai-prod}"
DOMINIO="${DOMINIO:-prospectai-stage.layart.com.br}"
FILTRO='prospectai|propectai'

secao() { printf '\n=================== %s ===================\n' "$1"; }
tem()   { command -v "$1" >/dev/null 2>&1; }
# Mascara o que pode ser segredo em uma linha de texto (usado so quando se imprime texto livre).
mascara() { sed -E 's/((PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_KEY)[A-Z_]*)=[^ ]*/\1=***/Ig; s#(://[^:@/ ]+:)[^@ /]+@#\1***@#g'; }

secao "0. Carimbo"
date -u +'UTC %Y-%m-%dT%H:%M:%SZ'
echo "script: P04-REL-01C-leituras-somente-leitura v1.0.0 (somente leitura)"

# ---------------------------------------------------------------------------
secao "A1. Imagens: a que cada servico EXECUTA x as etiquetas do projeto (ID completo, criacao, camadas)"
if tem docker; then
  for s in api web worker; do
    c="${PROJETO}-${s}-1"
    id="$(docker inspect -f '{{.Image}}' "$c" 2>/dev/null)"
    if [ -n "$id" ]; then
      printf 'EM EXECUCAO %-6s id=%s\n' "$s" "${id#sha256:}"
      docker image inspect -f '   criada={{.Created}} tags={{.RepoTags}} so={{.Os}}/{{.Architecture}} tamanho={{.Size}} camadas={{len .RootFS.Layers}}' "$id" 2>&1
    else
      echo "EM EXECUCAO $s: container $c nao encontrado"
    fi
  done
  echo "--- etiquetas do projeto (todas) ---"
  docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^prospectai-prod-(api|web|worker):' | while read -r t; do
    docker image inspect -f '{{.Id}} criada={{.Created}} camadas={{len .RootFS.Layers}}' "$t" 2>/dev/null | sed "s#^sha256:#$t -> #"
  done
  echo "--- imagens sem etiqueta (dangling) do projeto, se houver ---"
  docker image ls -f dangling=true --format '{{.ID}} {{.CreatedAt}} {{.Size}}' 2>/dev/null | head -20
  echo "--- camadas em comum entre a imagem EM EXECUCAO da api e a :latest da api ---"
  run="$(docker inspect -f '{{.Image}}' "${PROJETO}-api-1" 2>/dev/null)"
  lat="$(docker image inspect -f '{{.Id}}' "${PROJETO}-api:latest" 2>/dev/null)"
  if [ -n "$run" ] && [ -n "$lat" ]; then
    if [ "$run" = "$lat" ]; then
      echo "a imagem em execucao E a :latest"
    else
      a="$(docker image inspect -f '{{range .RootFS.Layers}}{{println .}}{{end}}' "$run" | sort)"
      b="$(docker image inspect -f '{{range .RootFS.Layers}}{{println .}}{{end}}' "$lat" | sort)"
      echo "camadas so na EM EXECUCAO : $(comm -23 <(printf '%s\n' "$a") <(printf '%s\n' "$b") | grep -c .)"
      echo "camadas so na :latest     : $(comm -13 <(printf '%s\n' "$a") <(printf '%s\n' "$b") | grep -c .)"
      echo "camadas em comum          : $(comm -12 <(printf '%s\n' "$a") <(printf '%s\n' "$b") | grep -c .)"
    fi
  fi
fi

secao "A2. Containers: criacao, inicio, imagem usada na criacao, ID da imagem que o Compose resolveu"
if tem docker; then
  for s in api web worker; do
    c="${PROJETO}-${s}-1"
    docker inspect -f '{{.Name}} | container_criado={{.Created}} | iniciado={{.State.StartedAt}} | config.image={{.Config.Image}} | compose.image={{index .Config.Labels "com.docker.compose.image"}} | reinicios={{.RestartCount}}' "$c" 2>&1
  done
fi

secao "A3. Compatibilidade DB-REM-04/05/06: so NOMES de variavel e o USUARIO do banco (nunca valores)"
if tem docker; then
  for s in api worker web; do
    c="${PROJETO}-${s}-1"
    echo "--- nomes de variavel em $c (valores nunca saem do pipe) ---"
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$c" 2>/dev/null | cut -d= -f1 | grep -E '^[A-Z_][A-Z0-9_]*$' | sort | tr '\n' ' '; echo
  done
  echo "--- usuario (so o nome) nas URLs de banco da API ---"
  for v in DATABASE_URL_APP DATABASE_URL_SISTEMA DATABASE_URL DATABASE_URL_MIGRATOR; do
    r="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${PROJETO}-api-1" 2>/dev/null | sed -nE "s#^${v}=[a-z]+://([^:@/]+)[:@].*#usuario=\\1#p")"
    printf '%-24s %s\n' "$v" "${r:-(nao definida no container)}"
  done
  echo "(esperado: APP e SISTEMA presentes; DATABASE_URL e DATABASE_URL_MIGRATOR AUSENTES na API; usuario de APP = propectai_app)"
fi

secao "A4. Git da arvore x imagens: commits que tocam o runtime e suas datas (a comparar com 'criada' em A1)"
if [ -d "$RAIZ/.git" ] && tem git; then
  cd "$RAIZ" 2>/dev/null || true
  echo "HEAD: $(git rev-parse HEAD 2>&1)"
  for alvo in "apps/api packages prisma/schema.prisma" "apps/web packages" "apps/worker packages"; do
    echo "--- ultimo commit que toca: $alvo ---"
    # shellcheck disable=SC2086
    git log -3 --format='%h %ci %s' -- $alvo 2>&1
  done
  echo "--- commits de runtime desde 2026-10-01 ---"
  git log --since=2026-10-01 --format='%h %ci %s' -- apps packages prisma/schema.prisma infra/docker compose.prod.yml 2>&1 | head -30
  echo "--- compose.prod.yml do servidor difere do commit do HEAD? ---"
  git diff --quiet HEAD -- compose.prod.yml 2>/dev/null && echo "igual ao HEAD" || echo "DIFERE do HEAD (ou git indisponivel)"
fi

secao "A5. Eventos do Docker ainda disponiveis sobre imagens/containers do projeto (nomes e horas; vazio e possivel)"
if tem docker; then
  desde="$(date -u -d '2026-10-25' +%s 2>/dev/null)"; ate="$(date -u +%s)"
  timeout 20 docker events --since "$desde" --until "$ate" --filter type=image --filter type=container \
    --format '{{.Time}} {{.Type}} {{.Action}} {{.Actor.Attributes.name}}' 2>/dev/null \
    | grep -iE "$FILTRO" | grep -E ' (tag|untag|delete|create|start|die|destroy|kill|stop|restart) ' | head -60 \
    | while read -r t resto; do printf '%s %s\n' "$(date -u -d "@$t" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" "$resto"; done
  echo "(fim; se nada acima, o Docker nao guarda esse historico: IMAGE_HISTORY fica INCONCLUSIVE sem A6)"
fi

secao "A6. Historico do shell do root: so linhas docker/compose que citam o projeto (mascaradas)"
if [ "${P04_SEM_HISTORICO:-0}" = "1" ]; then
  echo "(pulado por P04_SEM_HISTORICO=1)"
else
  for h in /root/.bash_history; do
    [ -r "$h" ] || { echo "(sem $h legivel)"; continue; }
    grep -aE 'docker[[:space:]]+(compose|tag|build|image|rmi)' "$h" | grep -aiE "$FILTRO|compose\.prod|pre-db|pre-net|pre-p0" | tail -40 | mascara
  done
fi

# ---------------------------------------------------------------------------
secao "B1. Backups do projeto em /opt/backups: so nomes, datas, tamanhos (conteudo NAO e aberto)"
if [ -d /opt/backups ]; then
  find /opt/backups -maxdepth 1 \( -iname '*prospectai*' -o -iname '*propectai*' -o -name 'env.production-*' -o -name 'imagens-agosto-*' \) \
    -printf '%TY-%Tm-%Td %TH:%TM  %10s  %y  %M  %u  %f\n' 2>/dev/null | sort
else
  echo "/opt/backups nao existe"
fi

secao "B2. Dentro das pastas de backup do projeto (so nomes, datas, tamanhos; 2 niveis)"
for d in /opt/backups/prospectai-dbrem04-* /opt/backups/prospectai-dbrem06-* /opt/backups/prospectai-s0-* /opt/backups/prospectai /opt/backups/p04-rel; do
  [ -d "$d" ] || continue
  echo "--- $d  (total $(du -sk "$d" 2>/dev/null | cut -f1) KB) ---"
  find "$d" -maxdepth 2 -printf '%TY-%Tm-%Td %TH:%TM  %10s  %y  %M  %P\n' 2>/dev/null | sort | head -60
done

secao "B3. Integridade do CONTAINER gzip/tgz dos candidatos (gzip -t; nao prova restauracao nem mostra conteudo)"
for f in $(find /opt/backups -maxdepth 3 \( -iname '*prospectai*' -o -iname '*propectai*' -o -path '*/prospectai-dbrem0*' \) -type f \( -name '*.gz' -o -name '*.tgz' \) 2>/dev/null | sort); do
  if gzip -t "$f" 2>/dev/null; then echo "integro: $f"; else echo "ERRO no gzip: $f"; fi
done

secao "B4. Outros arquivos de dump/backup dentro da arvore e dos dados do projeto (so nomes)"
find "$RAIZ" /opt/data/prospectai -maxdepth 3 \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.dump' -o -name '*.bak' -o -name '*.tgz' \) \
  -not -path '*/node_modules/*' -not -path '*/.git/*' -printf '%TY-%Tm-%Td %TH:%TM  %10s  %p\n' 2>/dev/null | sort | head -30

secao "B5. Rotinas agendadas que citam o projeto (so nomes de arquivo/unidade)"
grep -rIl -iE "$FILTRO|pg_dump" /etc/cron.d /etc/cron.daily /etc/cron.weekly /var/spool/cron/crontabs 2>/dev/null
tem crontab && crontab -l 2>/dev/null | grep -iE "$FILTRO|pg_dump" | mascara
tem systemctl && systemctl list-timers --all --no-pager 2>/dev/null | grep -iE "$FILTRO"
echo "(fim; vazio = nenhuma rotina encontrada)"

# ---------------------------------------------------------------------------
secao "C1. Logs dos containers do GATE-DB-42501: metadados (periodo = so o campo \"time\" da 1a e da ultima linha)"
if tem docker; then
  echo "driver global: $(docker info --format '{{.LoggingDriver}}' 2>/dev/null)"
  if [ -r /etc/docker/daemon.json ]; then
    echo "--- /etc/docker/daemon.json: so chaves de log ---"
    grep -E '"log-(driver|opts)"|"max-(size|file)"|"compress"' /etc/docker/daemon.json
  else
    echo "(sem /etc/docker/daemon.json legivel: padrao do Docker = json-file sem rotacao)"
  fi
  for s in postgres api worker web; do
    c="${PROJETO}-${s}-1"
    lp="$(docker inspect -f '{{.LogPath}}' "$c" 2>/dev/null)"
    echo "--- $c ---"
    docker inspect -f '   container_criado={{.Created}} iniciado={{.State.StartedAt}} status={{.State.Status}} log_driver={{.HostConfig.LogConfig.Type}} log_opts={{.HostConfig.LogConfig.Config}}' "$c" 2>&1
    if [ -n "$lp" ] && [ -f "$lp" ]; then
      echo "   arquivo=$lp"
      stat -c '   tamanho=%s bytes  modificado=%y  dono=%U:%G  modo=%a' "$lp"
      echo "   linhas=$(wc -l < "$lp")"
      echo "   primeira_linha_time=$(head -n1 "$lp" | grep -o '"time":"[^"]*"' | head -1)"
      echo "   ultima_linha_time=$(tail -n1 "$lp" | grep -o '"time":"[^"]*"' | head -1)"
      echo "   sha256_referencia=$(sha256sum "$lp" | cut -d' ' -f1)   (hash de custodia; o arquivo muda se o container continuar escrevendo)"
    else
      echo "   (log nao encontrado ou ilegivel)"
    fi
  done
  echo "--- postgres: opcoes de linha de comando do servidor (log_*), sem valores sensiveis ---"
  docker inspect -f '{{range .Config.Cmd}}{{println .}}{{end}}' "${PROJETO}-postgres-1" 2>/dev/null | mascara | head -20
  echo "--- espaco livre onde o Docker guarda os logs ---"
  df -h /var/lib/docker 2>/dev/null | tail -1
fi

# ---------------------------------------------------------------------------
secao "D1. Quem escuta a porta 3101 (so esta porta)"
if tem ss; then
  ss -ltnp 2>/dev/null | grep -E ':3101\b'
  pid="$(ss -ltnpH 2>/dev/null | grep -E ':3101\b' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
  if [ -n "${pid:-}" ]; then
    echo "--- processo pid=$pid (sem linha de comando: ela pode conter segredo) ---"
    ps -o pid=,ppid=,user=,lstart=,etime=,comm= -p "$pid" 2>&1
    echo "exe = $(readlink "/proc/$pid/exe" 2>&1)"
    echo "cwd = $(readlink "/proc/$pid/cwd" 2>&1)"
    cg="$(grep -oE '[0-9a-f]{64}' "/proc/$pid/cgroup" 2>/dev/null | head -1)"
    if [ -n "$cg" ] && tem docker; then
      echo "--- esse processo roda dentro de um container? ---"
      cn="$(docker ps --no-trunc --format '{{.ID}} {{.Names}} {{.Image}} {{.Ports}}' 2>/dev/null | grep "^$cg" | cut -d' ' -f2-)"
      echo "${cn:-(cgroup cita um container que nao foi encontrado)}"
    else
      echo "(o processo NAO esta em cgroup de container: e um processo do host)"
    fi
  fi
fi
if tem docker; then
  echo "--- algum container publica a 3101? ---"
  docker ps --filter publish=3101 --format '{{.Names}} | {{.Image}} | {{.Ports}}' 2>/dev/null
fi
echo "--- regras de firewall que citam 3101 (so linhas que casam) ---"
tem ufw && ufw status 2>/dev/null | grep -E '3101|Status'
tem iptables && iptables -S 2>/dev/null | grep -E '3101' | head -10
tem nft && nft list ruleset 2>/dev/null | grep -E '3101' | head -10
if tem curl; then
  echo "--- HEAD/GET local na 3101 (so status e 3 cabecalhos; sem cookie, sem corpo) ---"
  for p in / /api/v1/health /api/v1/system/version; do
    printf 'GET 127.0.0.1:3101%s -> ' "$p"
    curl -sS -m 5 -o /dev/null -D - "http://127.0.0.1:3101$p" 2>&1 | grep -iE '^(HTTP/|server:|x-powered-by:|content-type:)' | tr -d '\r' | tr '\n' ' '; echo
  done
  echo "--- corpo (200 bytes) de /api/v1/health e /api/v1/system/version, se for ProspectAI ---"
  for p in /api/v1/health /api/v1/system/version; do
    curl -sS -m 5 "http://127.0.0.1:3101$p" 2>/dev/null | head -c 200; echo
  done
fi

# ---------------------------------------------------------------------------
secao "E1. nginx do host: bloco de /api/v1/auth/register (so diretivas necessarias; valores sensiveis omitidos)"
VH="/etc/nginx/sites-enabled/${DOMINIO}.conf"
if [ -r "$VH" ]; then
  bloco="$(awk -v pat='location[[:space:]]*=[[:space:]]*/api/v1/auth/register' '
      !f && $0 ~ pat { f=1; depth=0 }
      f { print NR": "$0; n=gsub(/\{/,"{"); m=gsub(/\}/,"}"); depth+=n-m; if (depth<=0 && (n>0||m>0)) exit }
    ' "$VH")"
  if [ -z "$bloco" ]; then
    echo "(bloco 'location = /api/v1/auth/register' nao encontrado em $VH)"
  else
    printf '%s\n' "$bloco" \
      | grep -viE 'ssl_|certificate|key|password|secret|token|auth_basic_user_file' \
      | sed -E 's/(allow|deny)[[:space:]]+[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?/\1 <ip-omitido>/; s/(allow|deny)[[:space:]]+[0-9a-fA-F]*:[0-9a-fA-F:]+(\/[0-9]+)?/\1 <ip-omitido>/; s/(proxy_set_header[[:space:]]+[A-Za-z0-9_-]+)[[:space:]]+([^$"][^;]*|"[^$][^;]*");/\1 [valor omitido];/; s/(add_header[[:space:]]+[A-Za-z0-9_-]+)[[:space:]]+([^$"][^;]*|"[^$][^;]*")/\1 [valor omitido]/; s/(set[[:space:]]+\$[A-Za-z0-9_]+)[[:space:]]+([^$"][^;]*|"[^$][^;]*");/\1 [valor omitido];/'
    echo "--- zonas de limite referenciadas pelo bloco: definicoes ---"
    for z in $(printf '%s\n' "$bloco" | grep -oE 'zone=[A-Za-z0-9_]+' | cut -d= -f2 | sort -u); do
      grep -rhsE "limit_(req|conn)_zone[^;]*zone=$z:" /etc/nginx/nginx.conf /etc/nginx/conf.d "$VH" 2>/dev/null | head -2
    done
  fi
  echo "--- linhas de contexto: onde o bloco fica em relacao a location / e ao @reverse_proxy (so nomes de location) ---"
  grep -nE '^\s*location[[:space:]]' "$VH"
else
  echo "(vhost $VH nao legivel)"
fi

secao "E2. Comportamento observado de /api/v1/auth/register por HEAD/GET (a rota e POST: nao ha POST aqui)"
if tem curl; then
  for m in HEAD GET; do
    for base in "http://127.0.0.1:3102" "https://$DOMINIO"; do
      if [ "$m" = "HEAD" ]; then
        printf 'HEAD %s/api/v1/auth/register -> ' "$base"; curl -sS -m 10 -I "$base/api/v1/auth/register" 2>&1 | grep -iE '^(HTTP/|allow:|server:)' | tr -d '\r' | tr '\n' ' '; echo
      else
        printf 'GET  %s/api/v1/auth/register -> ' "$base"; curl -sS -m 10 -o /dev/null -w 'http=%{http_code}' "$base/api/v1/auth/register" 2>&1; echo
      fi
    done
  done
fi

secao "FIM"
echo "Nada foi alterado. Revise a saida antes de compartilha-la (A6 e D1 podem conter nomes do servidor)."
