# Atualizar o ambiente online — medição e ordem

**Data da medição:** 17/09/2026
**Alvo:** `app.prospectai.com.br`, em `108.174.144.216` (Ubuntu 24.04.4)
**Natureza:** ambiente de teste online, não produção com cliente. Isso muda o
risco aceitável, não o método.

Complementa o `PRIMEIRO-DEPLOY-CREDENCIAIS.md`, que cobre **só o banco** e diz
isso de si mesmo na primeira linha. Este cobre a atualização deste ambiente
específico, que não é primeiro deploy: já existe coisa no ar.

---

## 1. O que está lá, medido

| | |
|---|---|
| Projeto Compose | `prospectai-prod` |
| Arquivo | `/opt/apps/prospectai/compose.prod.yml` |
| Variáveis | `/opt/apps/prospectai/.env.production` |
| Containers | api, worker, web, postgres, redis, gmaps-scraper, gateway |
| No ar desde | **05 e 11/08/2026** |
| Domínio | `app.prospectai.com.br`, com certificado, nginx do host → `127.0.0.1:3102` |
| Dono do banco | `propectai` — **a grafia literal que as migrations exigem** |

O compose é bem-feito e não precisa mudar: rede `internal`, Postgres e Redis
**sem porta publicada**, só o gateway em `3102`, Redis com `requirepass`,
Dockerfiles de produção separados, `env_file` único.

### A máquina não é só nossa

No mesmo daemon Docker rodam `drmind-prod-*` (Bellvia), `adsaudit-*` com
Authentik, uma stack Supabase completa, n8n, Portainer, e um host PHP com cinco
versões de `php-fpm`. **A regra 1 do `CLAUDE.md` deixou de ser sobre uma máquina
de desenvolvimento:** `docker system prune` ali derruba negócio de terceiro.
Nenhum comando global. Nunca.

---

## 2. Os três achados, em ordem de quão silenciosamente falham

### 2.1 `DATABASE_URL_APP` não existe — e é o pior estado possível

O `.env.production` tem `DATABASE_URL` e mais nada da família. Não tem
`DATABASE_URL_APP`, `DATABASE_URL_MIGRATOR` nem `DATABASE_URL_SISTEMA`.

Enquanto não há RLS no banco, isso é inofensivo. **No minuto seguinte à
migration, deixa de ser.** O `PRIMEIRO-DEPLOY-CREDENCIAIS.md` §4:

> Se `DATABASE_URL_APP` faltar, a aplicação cai no `DATABASE_URL` e roda como
> dono superusuário — **que ignora a política inteira**. (…) A defesa é a
> pré-condição `current_user = 'propectai_app'` que abre cada `rls-*.spec.ts`,
> e ela só roda em teste. **Em produção não há quem avise.**

O resultado de migrar sem acrescentar as variáveis: 34 políticas instaladas e
integralmente contornadas. Pior que não ter RLS, porque parece ter.

**Por isso o passo das variáveis vem antes de subir a aplicação, e não depois.**

### 2.2 O repositório de lá não tem commits

```
fatal: your current branch 'main' does not have any commits yet
## No commits yet on main...origin/main [gone]
?? .dockerignore
?? .env.example
```

Há um `.git`, e ele está vazio. O código chegou por cópia. **Não existe SHA que
identifique o que está rodando**, e nenhuma das opções óbvias funciona:
`git pull` não tem base, `git status` não compara com nada.

Consequência prática: a atualização é **substituir a árvore**, não puxar um
diff. E vale consertar isso de vez, porque sem SHA no servidor não há como
responder "qual versão está no ar" na próxima vez — que é a pergunta que abriu
esta medição.

### 2.3 Cinco semanas de migrations não aplicadas

O que está no ar é de 05–11/08. Tudo o que veio depois não está lá:

- os três papéis de banco e as 34 políticas (`20260826230000` em diante)
- o `propectai_sistema` e o estreitamento de privilégios
- o pipeline de auditoria de presença digital
- a D6 inteira — retenção, aviso de expiração, expurgo
- `websiteHasHttps` como `SignalState`
- a correção do retorno do checkout (`/subscription`, não `/settings/subscription`)
- o FREE com **uma** auditoria por mês

Nenhuma delas é destrutiva. A de 16/09 troca o tipo de uma coluna com
`ALTER ... TYPE ... USING`, que converte linha a linha — foi escrita à mão
exatamente para não virar `DROP` + `ADD`.

---

## 3. A ordem

Cada passo tem um motivo de estar onde está. A ordem não é preferência.

### 0. Salvar o que não se recupera

```bash
docker exec prospectai-prod-postgres-1 pg_dump -U propectai propectai \
  | gzip > /opt/backups/propectai-$(date +%Y%m%d-%H%M).sql.gz
```

É ambiente de teste, mas `/opt/data/prospectai/gmapsdata` guarda coletas reais
— o comentário do compose de desenvolvimento diz isso com todas as letras. O
dump do Postgres custa segundos e compra a possibilidade de errar.

### 1. Trocar a árvore de código

Com o repositório vazio, as duas saídas honestas são:

- **Clonar de verdade** noutro caminho e apontar o compose para lá; ou
- `git init` + `remote add` + `fetch` + `checkout` no lugar, preservando
  `.env.production` e `infra/nginx/default.conf`, que não vêm do repositório.

Qualquer uma resolve; a segunda mantém o caminho que o Compose já conhece.
**O que não serve é copiar arquivos de novo** — seria repetir a causa deste item.

### 2. Acrescentar as quatro variáveis ao `.env.production`

Antes de qualquer migration, para não existir uma janela em que a política
exista e a aplicação a ignore.

```
DATABASE_URL_MIGRATOR=postgresql://propectai_migrator:SENHA@postgres:5432/propectai?schema=public
DATABASE_URL_APP=postgresql://propectai_app:SENHA@postgres:5432/propectai?schema=public&connection_limit=15
DATABASE_URL_SISTEMA=postgresql://propectai_sistema:SENHA@postgres:5432/propectai?schema=public
```

`DATABASE_URL` já existe e continua sendo o dono. As senhas são definidas no
passo 4 — então na prática escreve-se o arquivo entre o passo 4 e o 5, mas a
**decisão** de que elas vão existir tem de estar tomada antes de migrar.

O host é `postgres`, o nome do serviço na rede `internal` — não `localhost`,
não `127.0.0.1`.

#### O `connection_limit=15` na URL da aplicação, e só nela

Acrescentado em 18/09/2026, depois de um `P2028` — *"Unable to start a
transaction in the given time"* — aparecer no log de uma suíte e2e **que passou
verde**. A ficha de um lead falhou ao carregar uma vez; o teste afirmava que
nenhum modal abre, e página que explode não abre modal.

**A causa é arquitetural, não acidental.** Por causa do RLS, `comTenant` faz de
**toda leitura** uma transação — o `set_config(..., is_local)` só vale dentro de
uma, e sem ela não há isolamento. Num app comum o pool é gasto por escrita;
aqui é gasto por **abrir tela**. O padrão do Prisma — `núcleos físicos × 2 + 1`,
que na máquina de desenvolvimento medida dá **5** — foi calculado para a outra
premissa.

Uma ficha de lead abre quatro transações em paralelo. Uma cabe em cinco; duas
renderizações concorrentes, não — e o Next faz prefetch de rota ligada.

Vai **só na URL da aplicação** de propósito. O `migrator` roda um comando por
vez, o `sistema` é do worker, e o dono é para scripts: nenhum deles tem
concorrência de tela.

**Onde mais isto precisa existir:** o `.env` da máquina de desenvolvimento e o
ambiente do CI, se a URL for montada lá. Pool é por processo, e a fragilidade
acompanha a URL, não o servidor.

### 3. Aplicar as migrations

```bash
cd /opt/apps/prospectai
docker compose -f compose.prod.yml run --rm api pnpm db:deploy
```

`db:deploy` é `prisma migrate deploy`, não `migrate dev` — o segundo cria shadow
database e faz perguntas, e pergunta sem terminal vira travamento.

> **A verificar antes:** se a imagem `api.prod.Dockerfile` carrega o CLI do
> Prisma. Imagem de produção enxuta costuma não carregar. Se não carregar, a
> saída é um container de uso único a partir do `Dockerfile` de desenvolvimento,
> na mesma rede. Conferir com:
> `docker compose -f compose.prod.yml run --rm api pnpm prisma -v`

Isto cria os três papéis, as 34 políticas e as tabelas novas.

### 4. Dar senha aos três papéis

```bash
docker exec -it prospectai-prod-postgres-1 psql -U propectai -d propectai
```

```
\password propectai_migrator
\password propectai_app
\password propectai_sistema
```

`\password` e não `ALTER ROLE ... PASSWORD`: o interativo não deixa a senha no
histórico do shell nem no log do Postgres.

**E não aninhar aspas atravessando PowerShell → ssh → docker → psql.** Foi a
sétima ocorrência dessa armadilha neste programa, e a última delas aconteceu
hoje, comigo, com template do Docker.

### 5. Semear

```bash
docker compose -f compose.prod.yml run --rm api pnpm db:seed
```

Aqui é obrigatório, e não opcional como em produção real: é o seed que grava
`Plan.limits`, e é por ele que o **FREE com uma auditoria** chega ao banco. Sem
este passo, o ambiente online continua entregando três diagnósticos de graça —
que é exatamente o que o Gate 1 precisa que deixe de acontecer.

### 6. Subir com as variáveis novas

```bash
docker compose -f compose.prod.yml up -d --build api worker web
```

Serviços nomeados, um a um. **Sem `down`, sem `--remove-orphans`** — a máquina
tem stacks de terceiros e o segundo argumento já removeu container alheio em
mais de um projeto por aí.

### 7. Verificar, e é aqui que se descobre se deu certo

```bash
docker exec -i prospectai-prod-postgres-1 psql -U propectai -d propectai \
  -v ON_ERROR_STOP=1 < docs/intelligence/gate0/gate-rls.sql
```

O portão falha com saída diferente de zero se algo estiver errado. Dois dos seis
invariantes que ele cobre são o motivo deste documento existir: **`propectai_app`
não é dono de tabela nenhuma** e **não tem `BYPASSRLS`**.

E a verificação que o portão **não** faz, porque é sobre a aplicação e não sobre
o catálogo — a única que prova o §2.1:

```bash
docker exec prospectai-prod-api-1 printenv DATABASE_URL_APP | head -c 30
```

Se vier vazio, a aplicação está rodando como dono e todo o resto foi teatro.

---

## 4. O que este documento não cobre

Backup automatizado, observabilidade, rotação de segredo, e o provedor de
pagamento. O último é o próximo passo do Gate 1 e depende de decisão comercial
já tomada (assinatura) mas de configuração ainda não feita: conta na Stripe,
quatro `stripePriceId`, e as variáveis `STRIPE_SECRET_KEY` e
`STRIPE_WEBHOOK_SECRET` — que também não estão no `.env.production`.

O endereço que a Stripe vai chamar, esse já existe:
`https://app.prospectai.com.br` com certificado válido, proxy para o gateway.
Era o item que eu havia classificado como bloqueio, e não era.
