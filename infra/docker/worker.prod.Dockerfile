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
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable \
    && corepack prepare pnpm@10.30.1 --activate

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
    && pnpm db:generate \
    && pnpm --filter @propectai/types build \
    && pnpm --filter @propectai/worker build \
    && chown -R node:node /app

ENV NODE_ENV=production

USER node

CMD ["node", "apps/worker/dist/index.js"]
