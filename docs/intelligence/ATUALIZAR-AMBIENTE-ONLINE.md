# Atualizar o ambiente online — medição e ordem

**Data da medição:** 17/09/2026
**Alvo:** `108.174.144.216` (Ubuntu 24.04.4), acessado pelo IP — o nome `app.prospectai.com.br` não resolve (ver §1)
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
| Domínio | **não resolve** — ver a correção abaixo. nginx do host → `127.0.0.1:3102`, acesso pelo IP |
| Dono do banco | `propectai` — **a grafia literal que as migrations exigem** |

> **Correção de 21/09.** A versão de 17/09 desta tabela dizia *"`app.prospectai.com.br`,
> com certificado"*, e a §4 concluía que o domínio não era bloqueio. As duas
> afirmações vinham da **configuração** do nginx, sem resolver o nome. Em 18/09
> o dono do projeto informou que `nslookup app.prospectai.com.br` não responde e
> que o ambiente roda direto no IP; o `GATE-1-LACUNA.md` §7 registra o domínio
> como o primeiro elo da corrente que falta. Ler a configuração e chamar de
> medição foi o erro — o mesmo tipo de erro que este documento existe para
> evitar.

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

> **Três correções de 21/09/2026, medidas no servidor antes de executar.** A
> versão de 17/09 desta seção teria falhado de três jeitos diferentes:
>
> 1. **Todo `docker compose` neste servidor leva `--env-file .env.production`.**
>    O `env_file:` do compose entrega variáveis *aos containers*; as expressões
>    `${...}` *dentro do* `compose.prod.yml` são preenchidas por outra fonte. Sem
>    o parâmetro, `REDIS_PASSWORD` e `NEXT_PUBLIC_API_URL` saem em branco — a web
>    seria construída chamando lugar nenhum. Medido: os containers atuais foram
>    criados com `--env-file` (rótulo `com.docker.compose.project.environment_file`),
>    e `docker compose ps` sem ele imprime os dois avisos.
> 2. **A imagem é construída antes da migration.** `docker compose run` usa a
>    imagem que já existe; a versão anterior migrava com a imagem de agosto, que
>    não tem as migrations novas, e o comando terminaria "com sucesso" sem aplicar
>    nada.
> 3. **A configuração de produção não estava no repositório.** O
>    `compose.prod.yml`, os três Dockerfiles de produção, o `nginx/default.conf` e o
>    `.dockerignore` existiam só no servidor. Entraram no repositório em 21/09, e
>    os Dockerfiles subiram de Node 20 para Node 24 — a versão que o `package.json`
>    exige e em que todos os testes rodam. API e worker foram construídos e
>    conferidos (`node --version` → `v24.21.0`) na máquina de desenvolvimento antes
>    de qualquer coisa chegar aqui.
>
> Nos blocos abaixo, `$C` abrevia o prefixo obrigatório:
>
> ```bash
> cd /opt/apps/prospectai
> C="docker compose --env-file .env.production -f compose.prod.yml"
> ```

### 0. Salvar o que não se recupera

```bash
docker exec prospectai-prod-postgres-1 pg_dump -U propectai propectai \
  | gzip > /opt/backups/propectai-$(date +%Y%m%d-%H%M).sql.gz
```

É ambiente de teste, mas `/opt/data/prospectai/gmapsdata` guarda coletas reais
— o comentário do compose de desenvolvimento diz isso com todas as letras. O
dump do Postgres custa segundos e compra a possibilidade de errar.

Feito em 21/09/2026: `/opt/backups/propectai-20260921-1336.sql.gz`, 42 KB,
39 tabelas, `PIPESTATUS` `0 0`.

### 1. Trocar a árvore de código

Medido em 21/09: o `.git` do servidor já aponta para `origin`, e o `git fetch`
funciona sem credencial. Comparando a pasta com o repositório, os únicos
arquivos que existiam só aqui eram a configuração de produção (agora
versionada), o `.env.production`, lixo de build e o clone do scraper — nenhum
arquivo de código órfão.

Antes de trocar, uma cópia da árvore atual, para poder voltar:

```bash
tar czf /opt/backups/prospectai-arvore-$(date +%Y%m%d-%H%M).tgz --exclude=node_modules --exclude=services/google-maps-scraper -C /opt/apps prospectai
```

Depois, o código no lugar, no caminho que o Compose já conhece:

```bash
git fetch origin main
git checkout -f -B main origin/main
git log -1 --format='%h %s'
```

O `-f` é necessário e é seguro aqui: o `compose.prod.yml` e os Dockerfiles
existem como arquivos soltos e passam a vir do repositório. O `.env.production`
não é tocado — está no `.gitignore` desde 21/09, e nunca é rastreado. Os
containers em execução não percebem nada: continuam das imagens antigas até o
passo 6.

**O que não serve é copiar arquivos de novo** — foi a causa de o servidor não
ter SHA nenhum que dissesse o que estava rodando.

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

Medido em 21/09 (só os nomes, com `grep -o '^[A-Z_]*=' .env.production`):
faltam exatamente as três URLs acima e o `SITE_AUDIT_PROVIDER`. O
`PAYMENT_PROVIDER` também falta, e está certo faltar — o padrão é `mock`. O
`APP_VERSION` aparece **duas vezes**; vale a última linha, e a primeira deve
sair na mesma edição, antes que alguém altere a de cima e não entenda por que
nada muda.

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

#### `SITE_AUDIT_PROVIDER=native` — acrescentada em 21/09/2026

```
SITE_AUDIT_PROVIDER=native
```

**Sem ela, o relatório de diagnóstico não existe neste ambiente.** A fábrica do
worker cai no provedor simulado quando a variável falta, toda auditoria sai
marcada como simulada, e a página `/relatorio/:auditId` se recusa a emitir
documento de medição simulada — de propósito. O link "Ver diagnóstico" nunca
aparece.

**O que ela liga:** o worker passa a abrir DNS e socket reais contra o site
cadastrado no lead, a partir deste servidor. Três fatos pesaram na decisão, que
é do dono do projeto e foi tomada em 21/09:

- **Tudo passa pelo módulo de egress** (`apps/worker/src/egress`, 115 testes).
  Destino que resolve para faixa interna — as redes Docker desta máquina, o
  loopback, o endereço de metadados de nuvem — é recusado antes de conectar, e
  não há segunda resolução de DNS entre validar e conectar. É o que impede um
  lead com site malicioso de fazer o worker falar com o Bellvia ou o Supabase
  pela rede interna.
- **Site que aponta para o próprio IP público deste servidor** chega ao nginx do
  host como qualquer visitante da internet chegaria. O egress não bloqueia isso,
  e não precisa: a sonda guarda status e saltos, nunca o corpo, e não ganha
  acesso que um navegador qualquer não tenha.
- **É uma auditoria por clique**, no máximo duas requisições HTTP por site, com
  teto de tempo. As duas lacunas registradas no
  `FLOWSINT-EGRESS-REFERENCIA-INTERNA.md` — sem limite de taxa por domínio, sem
  `robots.txt` — são de crawler em escala, e voltam a importar no dia em que a
  auditoria virar lote. Hoje não viram.

**Testado antes na máquina de desenvolvimento, em 21/09**, contra um site real:
o primeiro relatório com medição real encontrou três defeitos no documento
(corrigidos em `a9dfc7b` e `00efaf4`). Ligar em ambiente online sem esse teste
teria entregue esses três defeitos a quem abrisse o relatório.

### 3. Construir, parar, migrar

**3a. Construir as três imagens.** Não toca em container nenhum — só cria imagem
nova ao lado da antiga. É também o primeiro build da web em Node 24.

```bash
$C build api worker web
```

**3b. Parar só a API e o worker.** A partir da migration, o código de agosto
passa a ler um banco que mudou por baixo dele — a de 16/09 troca o tipo de uma
coluna. Melhor fora do ar que respondendo errado. Serviços nomeados; nada de
`down`.

```bash
$C stop api worker
```

**3c. Migrar**, com a imagem nova:

```bash
$C run --rm api pnpm db:deploy
```

`db:deploy` é `prisma migrate deploy`, não `migrate dev` — o segundo cria shadow
database e faz perguntas, e pergunta sem terminal vira travamento. Conecta pelo
`DATABASE_URL`, o dono (`schema.prisma`, `datasource db`), e por isso consegue
criar os papéis que as migrations de RLS introduzem.

O CLI do Prisma está na imagem: o Dockerfile instala as dependências de
desenvolvimento antes do build, e o `prisma` é uma delas.

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
$C run --rm api pnpm db:seed
```

Aqui é obrigatório, e não opcional como em produção real: é o seed que grava
`Plan.limits`, e é por ele que o **FREE com uma auditoria** chega ao banco. Sem
este passo, o ambiente online continua entregando três diagnósticos de graça —
que é exatamente o que o Gate 1 precisa que deixe de acontecer.

### 6. Subir com as variáveis novas

```bash
$C up -d api worker web
```

Sem `--build`: as imagens foram construídas no passo 3a. Serviços nomeados. **Sem `down`, sem `--remove-orphans`** — a máquina
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

E o provedor de auditoria, que falha em silêncio pelo outro lado — nada quebra,
só nenhum relatório aparece:

```bash
docker logs prospectai-prod-worker-1 2>&1 | grep "Provider de auditoria"
```

Tem de dizer `nativo (DNS e socket reais)`. Se disser `mock`, a variável não
chegou ao container: conferir o `.env.production` e recriar **só o worker** —
`$C up -d --force-recreate worker`. Nunca
`down`, nunca comando sem o nome do serviço.

---

## 4. O que este documento não cobre

Backup automatizado, observabilidade, rotação de segredo, e o provedor de
pagamento. O último é o próximo passo do Gate 1 e depende de decisão comercial
já tomada (assinatura) mas de configuração ainda não feita: conta na Stripe,
quatro `stripePriceId`, e as variáveis `STRIPE_SECRET_KEY` e
`STRIPE_WEBHOOK_SECRET` — que também não estão no `.env.production`.

O endereço que a Stripe vai chamar **ainda não existe**: o nome não resolve, e
o webhook precisa de HTTPS com certificado válido num nome. A versão de 17/09
deste parágrafo dizia o contrário — ver a correção na §1. O domínio continua
sendo bloqueio, e a decisão sobre ele está com o dono do projeto, porque o nome
do produto pode mudar.
