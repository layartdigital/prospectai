# PropectAI

Plataforma SaaS multi-tenant de prospecção de clientes locais. Conceito de marca: **Prospect + AI**.

**Versão:** 0.1.1 · **Estado:** Fase 1 concluída (fundação)

---

## Começando do zero

Dez passos. Se algum falhar, veja [Problemas comuns](#problemas-comuns) no fim.

### 1. Pré-requisitos

Já verificados nesta máquina em 27/07/2026:

| Ferramenta | Mínimo | Instalado |
|---|---|---|
| Node.js | 20.11 | 24.13.1 |
| pnpm | 9 | 10.30.1 |
| Docker Desktop | 24 | 29.6.1 |
| Git | 2.40 | 2.55.0 |

### 2. Clonar o motor de coleta

O scraper é software de terceiros e não é versionado neste repositório.

```powershell
cd C:\ResgateProjetos\prospectai
git clone https://github.com/gosom/google-maps-scraper services/google-maps-scraper
```

Se a pasta já existir, pule este passo.

### 3. Instalar dependências

```powershell
cd C:\ResgateProjetos\prospectai
pnpm install
```

O store do pnpm precisa ficar **no mesmo volume do projeto** — é o que permite hardlink em vez de cópia, e a diferença é de gigabytes.

Até 06/08/2026 o `.npmrc` da raiz fixava `store-dir=F:\.pnpm-store`. Com a migração para o C:, essa linha passou a apontar para outro volume, e um externo com falha de hardware — pior dos dois mundos. Foi removida: sem ela o pnpm usa o padrão do usuário, que já vive no C:.

Se precisar fixar de novo, use um caminho no mesmo volume da raiz.

### 4. Criar o arquivo de ambiente

```powershell
Copy-Item .env.example .env
```

Para uso local os valores padrão bastam. Antes de qualquer uso fora do seu computador, troque `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 5. Subir a infraestrutura

```powershell
pnpm docker:up
```

Sobe três containers: `propectai-postgres`, `propectai-redis` e `propectai-gmaps-scraper`.

> **Já existe um container `propectai-scraper` rodando?** Ele foi criado à mão, fora do compose, e está publicado em `0.0.0.0` — alcançável por toda a rede local. Remova antes: `docker rm -f propectai-scraper`. Os dados em `data/gmapsdata` não são afetados.

Conferir:

```powershell
pnpm docker:ps
```

### 6. Gerar o client do Prisma

```powershell
pnpm db:generate
```

### 7. Criar o banco

```powershell
pnpm db:migrate
```

Na primeira execução o Prisma pede um nome para a migration. Use `init`.

### 8. Popular dados de demonstração

```powershell
pnpm db:seed
```

> Disponível a partir da **Fase 2**. Hoje o comando ainda não tem efeito.

### 9. Rodar a aplicação

```powershell
pnpm dev
```

| Serviço | URL |
|---|---|
| Web | http://localhost:3100 |
| API | http://localhost:3101/api/v1 |
| Swagger | http://localhost:3101/api/docs |
| Health | http://localhost:3101/api/v1/health |
| Prisma Studio | `pnpm db:studio` → http://localhost:5556 |

### 10. Encerrar

```powershell
pnpm docker:down
```

Os volumes são preservados. Para apagar os dados do PropectAI — **e somente dele**:

```powershell
docker volume rm propectai-postgres-data propectai-redis-data
```

---

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Web, API e worker em paralelo com hot reload |
| `pnpm build` | Build de todas as aplicações |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript sem emitir |
| `pnpm test` | Testes |
| `pnpm docker:up` / `:down` / `:logs` / `:ps` | Infraestrutura |
| `pnpm db:generate` / `:migrate` / `:seed` / `:studio` / `:reset` | Banco |

---

## Arquitetura

Modo **híbrido** de desenvolvimento: Postgres, Redis e scraper em Docker; web, API e worker rodando local. O ciclo diário não passa por rebuild de imagem.

```
apps/
  web/        Next.js App Router · Tailwind · porta 3100
  api/        NestJS · Prisma · Swagger · porta 3101
  worker/     BullMQ · consome a fila do Redis
packages/
  config/     tsconfig compartilhado
  types/      contratos entre api, web e worker
prisma/       schema, migrations e seed
services/
  google-maps-scraper/   clone de terceiros (não versionado)
data/
  gmapsdata/  estado de runtime do scraper (não versionado)
docs/         técnica, estratégica e comercial
```

### Portas

| Serviço | Porta | Por quê |
|---|---:|---|
| Web | 3100 | |
| API | 3101 | |
| PostgreSQL | 5434 | Deslocada de 5432 — 5432 é do Bellvia |
| Redis | 6381 | Deslocada de 6379 — 6379 é do Bellvia |
| Scraper | 8081 | Só em dev, publicado em `127.0.0.1` |
| Prisma Studio | 5556 | |

O deslocamento é intencional: uma string de conexão errada não alcança o banco do outro projeto, ela simplesmente falha.

---

## Regras do projeto

Leia [`CLAUDE.md`](./CLAUDE.md) antes de qualquer alteração. Em resumo:

1. **Não tocar no Bellvia** (`F:\drmind`). Nunca rodar `docker system prune`, `volume prune` ou `network prune`.
2. **O módulo "Construtor de Sites" não existe** — sem rota, menu, tabela ou menção.
3. **Ausência de sinal é `DESCONHECIDO`, nunca `AUSENTE`.** Marcar "sem Instagram" sem ter verificado é falso negativo.
4. **Nenhum modal de bloqueio abre sozinho.**
5. **Dados pessoais de terceiros não são persistidos** — avaliações com nome e foto são descartadas na normalização.
6. **Zero mock no front-end.** Se a tela mostra um número, veio de query.

---

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`docs/technical/environment-audit.md`](./docs/technical/environment-audit.md) | Auditoria do ambiente, portas, isolamento |
| [`docs/strategic/scope-v0.1.1.md`](./docs/strategic/scope-v0.1.1.md) | Escopo aprovado, fases, critérios de aceite |
| [`docs/technical/data-model.md`](./docs/technical/data-model.md) | Entidades, deduplicação, multi-tenancy |
| [`docs/technical/scoring.md`](./docs/technical/scoring.md) | Motor de score, pesos, explicabilidade |

---

## Problemas comuns

**`pnpm install` falha por falta de espaço**
O drive C: tem pouco espaço livre. Confirme que o `.npmrc` da raiz existe com `store-dir=F:\.pnpm-store`.

**`pnpm db:migrate` não conecta**
O Postgres pode ainda estar subindo. `pnpm docker:ps` deve mostrar `healthy`. Confirme que `DATABASE_URL` aponta para a porta **5434**, não 5432 — 5432 é o banco do Bellvia.

**Porta 8081 ocupada**
Provavelmente o container antigo `propectai-scraper`. Remova com `docker rm -f propectai-scraper` e rode `pnpm docker:up`.

**`@prisma/client` não encontrado**
Rode `pnpm db:generate`. O client é gerado, não instalado.

**Erro de tipo em `@propectai/types`**
O pacote compila para `dist/`. Rode `pnpm build` uma vez antes do `pnpm dev`, ou deixe o Turborepo resolver — `dev` já depende de `^build`.
