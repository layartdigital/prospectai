# Node 24, e nao 20. Trocado em 21/09/2026.
#
# O `package.json` da raiz declara `engines.node >=24` desde setembro, e todos
# os testes do projeto rodam em Node 24. A imagem de agosto usava Node 20 — e
# o build passa assim mesmo (medido: o pnpm nao recusou o `engines`), o que e o
# motivo de esta nota existir. Build verde nao prova runtime: o que quebra numa
# versao errada do Node e uma funcao que nao existe quando e chamada, e isso
# aparece no primeiro uso, nao na compilacao. Producao roda na versao em que os
# testes rodaram.
FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# O pnpm fica DENTRO da imagem, num lugar que o usuario `node` enxerga.
#
# Ate 22/09/2026 o `corepack prepare` rodava como root e guardava o pnpm em
# /root/.cache. O container roda como `node`, que nao ve essa pasta — entao todo
# `pnpm` dentro do container (migration, seed, e o CMD da web) baixava o pnpm
# da internet na hora e parava perguntando "Do you want to continue? [Y/n]".
# Medido no primeiro deploy de setembro. Sem ninguem no terminal, a pergunta
# vira um processo parado.
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable \
    && corepack prepare pnpm@10.30.1 --activate \
    && chmod -R a+rX /opt/corepack

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .

# Remove caches de compilação copiados do ambiente Windows.
# Os diretórios dist não fazem parte do pacote de deploy, portanto um
# tsbuildinfo antigo poderia fazer o TypeScript pular a emissão dos arquivos.
RUN find /app -type f -name '*.tsbuildinfo' -delete \
    && rm -rf \
        /app/packages/types/dist \
        /app/apps/api/dist \
        /app/apps/worker/dist \
        /app/apps/web/.next

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @propectai/types build \
    && pnpm --filter @propectai/web build \
    && chown -R node:node /app

ENV NODE_ENV=production
ENV API_INTERNAL_URL=http://api:3101

USER node

EXPOSE 3100

CMD ["pnpm", "--filter", "@propectai/web", "start"]
