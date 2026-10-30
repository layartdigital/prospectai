#!/usr/bin/env bash
# Segredos por servico no compose.prod.yml — DB-REM-04 (SEC-DB-01.N), 30/10/2026.
#
# Verifica a FIACAO, e nao o conteudo dos arquivos reais: monta o compose numa
# pasta temporaria, com tres arquivos de ambiente falsos (chaves sentinela, sem
# nenhum segredo), pede ao proprio Compose a configuracao resolvida e confere o
# ambiente final de cada servico.
#
# Pega, por exemplo: alguem pondo `.env.dono` no `web`; a `api` voltando a ler
# o `DATABASE_URL`; um servico novo que ninguem classificou.
#
# Nao pega: uma chave do dono escrita de volta no `.env.production` do servidor.
# Isso so se mede la (rodada M1 do roteiro do DB-REM-04, so nomes).
#
# Nunca le nem escreve os arquivos de ambiente do repositorio: tudo acontece
# dentro do `mktemp -d`, apagado na saida. Pode rodar no servidor sem risco.
#
# Uso: bash infra/scripts/checar-segredos-compose.sh   (precisa de docker compose v2 e jq)

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

cp "$RAIZ/compose.prod.yml" "$T/compose.prod.yml"

printf '%s\n' \
  'REDIS_PASSWORD=sentinela-redis' \
  'JWT_ACCESS_SECRET=sentinela-comum' \
  'COMUM_SENTINELA=1' > "$T/.env.production"

printf '%s\n' \
  'DATABASE_URL_APP=sentinela-app' \
  'DATABASE_URL_SISTEMA=sentinela-sistema' > "$T/.env.banco"

printf '%s\n' \
  'DATABASE_URL=sentinela-dono' \
  'DATABASE_URL_MIGRATOR=sentinela-migrator' \
  'POSTGRES_USER=sentinela' \
  'POSTGRES_PASSWORD=sentinela' \
  'POSTGRES_DB=sentinela' \
  'SEED_OWNER_PASSWORD=sentinela' \
  'SEED_SDR_PASSWORD=sentinela' > "$T/.env.dono"

docker compose -f "$T/compose.prod.yml" --env-file "$T/.env.production" \
  --profile ops config --format json > "$T/resolvido.json"

# Chaves do dono: superusuario, migrator (BYPASSRLS), senhas do seed.
DONO='^(DATABASE_URL|DATABASE_URL_MIGRATOR|POSTGRES_[A-Z_]+|SEED_[A-Z_]+)$'
# Chaves de runtime do banco: papeis com RLS (app) e sistema.
BANCO='^DATABASE_URL_(APP|SISTEMA)$'

falhas=0
falhar() { echo "FALHA  $1"; falhas=$((falhas + 1)); }

chaves() {
  jq -r --arg s "$1" '.services[$s].environment // {} | keys[]' "$T/resolvido.json"
}

proibir() { # servico regex rotulo
  local achou
  achou="$(chaves "$1" | grep -E "$2" || true)"
  if [ -n "$achou" ]; then
    falhar "$1 recebe chave $3: $(echo "$achou" | tr '\n' ' ')"
  fi
}

exigir() { # servico chave
  if ! chaves "$1" | grep -qx "$2"; then
    falhar "$1 nao recebe $2"
  fi
}

conhecidos=' postgres redis gmaps-scraper api worker web gateway ops '

for s in $(jq -r '.services | keys[]' "$T/resolvido.json"); do
  case "$conhecidos" in
    *" $s "*) ;;
    *) falhar "servico novo sem classificacao neste script: $s" ;;
  esac
done

proibir postgres "$BANCO" 'de runtime'
exigir  postgres POSTGRES_PASSWORD

proibir redis "$DONO" 'do dono'
proibir redis "$BANCO" 'de runtime'
exigir  redis REDIS_PASSWORD

for s in api worker; do
  proibir "$s" "$DONO" 'do dono'
  exigir  "$s" DATABASE_URL_APP
  exigir  "$s" DATABASE_URL_SISTEMA
done

for s in web gateway gmaps-scraper; do
  proibir "$s" "$DONO" 'do dono'
  proibir "$s" "$BANCO" 'de runtime'
done

exigir ops DATABASE_URL
exigir ops DATABASE_URL_MIGRATOR
exigir ops DATABASE_URL_APP

if [ "$falhas" -gt 0 ]; then
  echo "SEGREDOS_POR_SERVICO = FALHA ($falhas)"
  exit 1
fi
echo "SEGREDOS_POR_SERVICO = OK"
