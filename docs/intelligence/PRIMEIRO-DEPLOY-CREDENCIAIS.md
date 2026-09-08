# Primeiro deploy — credenciais e papéis de banco

**Escopo: só o banco.** Este documento cobre os papéis do PostgreSQL, as senhas
e a ordem em que tudo precisa acontecer. **Não é um checklist de deploy
completo** — não fala de DNS, TLS, orquestração, backup, Redis, fila,
observabilidade ou do provedor de pagamento. Se você chegou aqui procurando o
resto, ele não existe ainda, e fingir que existe seria pior do que não ter.

Escrito em 04/09/2026, fechando o item que o programa de RLS deixou em aberto
desde o passo 1.

---

## ⚠ Antes de escolher onde hospedar: uma exigência que elimina opções

**As migrations criam papéis com `BYPASSRLS`, e `BYPASSRLS` só pode ser
concedido por um superusuário.** Isso é regra do PostgreSQL, não configuração
que se ajuste.

Duas migrations fazem isso:

- `20260826230000_rls_papeis` → `CREATE ROLE propectai_migrator LOGIN BYPASSRLS`
- `20260903120000_rls_papel_sistema` → `CREATE ROLE propectai_sistema LOGIN BYPASSRLS`

**Consequência: a conexão que roda `prisma migrate deploy` precisa ser
superusuária.** Não basta ter `CREATEROLE`.

Localmente isso passa despercebido: a imagem `postgres:16-alpine` faz do
`POSTGRES_USER` um superusuário, então nunca doeu. **Em PostgreSQL gerenciado o
usuário mestre normalmente não é superusuário**, por desenho do provedor.

**Verifique isso no seu provedor antes de qualquer outra coisa**, com o usuário
que você pretende usar para migrar:

```sql
SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user;
```

Se vier `rolsuper = f`, as migrations 15 e 20 falham e o deploy para ali. As
saídas, sem recomendação porque dependem de restrições que este documento não
conhece: hospedar o Postgres onde você tenha superusuário; pedir ao provedor a
criação manual dos papéis fora da migration; ou rever o desenho para não
depender de `BYPASSRLS` — o que é uma mudança grande, porque quatro caminhos do
produto dependem dele.

---

## A ordem, e por que ela não pode ser outra

**Os papéis não existem antes da primeira migration.** São as migrations que os
criam. Isso é um ovo-e-galinha real, e a ordem abaixo é a única que funciona:

### 1. Criar o banco e o dono

O dono é quem roda migrations e é dono das tabelas. Nas variáveis, é o
`DATABASE_URL`.

- Precisa ser **superusuário** (ver a seção acima).
- Precisa de senha. **Inclusive ele** — ver a seção sobre `pg_hba.conf`.
- O nome importa: as migrations fazem
  `ALTER DEFAULT PRIVILEGES FOR ROLE propectai`, **com o nome literal**. Com
  outro dono, os privilégios padrão não se aplicam, e toda tabela criada por
  migration futura nasce invisível para o `propectai_app` — o sintoma é
  "permission denied" numa rota que funcionava ontem, meses depois, sem
  ninguém ligar uma coisa à outra.

### 2. Rodar as migrations

```bash
DATABASE_URL="postgresql://propectai:SENHA@host:porta/propectai?schema=public" \
  pnpm db:deploy
```

`db:deploy` é `prisma migrate deploy` — não `migrate dev`. O segundo cria shadow
database e faz perguntas; sem terminal, uma pergunta vira travamento.

Isto cria os três papéis, as 34 políticas e todas as tabelas.

### 3. Dar senha aos três papéis

**As migrations os criam sem senha, de propósito** — para o repositório não
ganhar um segredo. Sem este passo eles existem e não logam.

```bash
psql -h host -p porta -U propectai -d propectai
```

```
\password propectai_migrator
\password propectai_app
\password propectai_sistema
```

**Use `\password`, e não `ALTER ROLE ... PASSWORD '...'`.** O comando interativo
não deixa a senha no histórico do shell nem no log do PostgreSQL.

E **nunca** aninhe SQL com aspas atravessando PowerShell → docker → sh: as aspas
não sobrevivem. Foi a sexta ocorrência dessa armadilha nesta sessão.

### 4. Definir as quatro variáveis de ambiente

| variável | papel | quem usa |
|---|---|---|
| `DATABASE_URL` | o dono, superusuário | `prisma migrate`, e o fallback de tudo |
| `DATABASE_URL_MIGRATOR` | `propectai_migrator` | scripts de `prisma/` e fixtures de teste |
| `DATABASE_URL_APP` | `propectai_app` | **a aplicação** — API e worker |
| `DATABASE_URL_SISTEMA` | `propectai_sistema` | os quatro caminhos que atravessam tenants |

**Se `DATABASE_URL_APP` faltar, a aplicação cai no `DATABASE_URL` e roda como
dono superusuário — que ignora a política inteira.** Não é hipótese: a fase B
inteira depende dessa variável estar certa. A defesa é a pré-condição
`current_user = 'propectai_app'` que abre cada `rls-*.spec.ts`, e ela só roda em
teste. **Em produção não há quem avise.** Confira com a verificação do passo 6.

### 5. Semear, se for ambiente de demonstração

```bash
pnpm db:seed
```

Usa o `DATABASE_URL_MIGRATOR`. **Não rode em produção com dado real** — ele cria
tenant e usuários de demonstração com senha conhecida.

### 6. Verificar

Três arquivos, todos em `docs/intelligence/gate0/`, todos consultas ao catálogo
— o resultado não depende de haver dado:

```bash
psql -h host -U propectai -d propectai -v ON_ERROR_STOP=1 -f docs/intelligence/gate0/gate-rls.sql
psql -h host -U propectai -d propectai -f docs/intelligence/gate0/verificacoes-fase-b.sql
psql -h host -U propectai -d propectai -f docs/intelligence/gate0/verificacoes-papel-sistema.sql
```

O primeiro **falha com saída diferente de zero** se algo estiver errado — é o
portão, e o CI o roda a cada push. Os outros dois imprimem relatório para
leitura humana.

O portão cobre seis invariantes, e dois deles são o que este documento existe
para garantir: **`propectai_app` não é dono de tabela nenhuma** e **não tem
`BYPASSRLS`**. Qualquer um dos dois desfaz o programa inteiro sem que nenhum
outro teste perceba.

---

## `pg_hba.conf`: senha é obrigatória, inclusive para o dono

O comentário final da migration `20260826230000_rls_papeis` diz que "o Postgres
local do projeto autentica por confiança, então os papéis logam sem senha".

**Essa frase é falsa, e não pode ser corrigida lá** — o Prisma valida o checksum
de migration aplicada, e editá-la travaria toda migration futura do projeto.

O que o `pg_hba.conf` da imagem realmente faz: confia **apenas** no socket local
e no `127.0.0.1` de dentro do container. Conexão vinda de fora — da sua máquina,
de outro container, de qualquer lugar — chega pelo gateway da ponte Docker e cai
em `host all all all scram-sha-256`. **Isso inclui o dono.**

Foi medido: sem senha, o papel existe e a conexão é recusada com
`Authentication failed`, três arquivos longe da causa.

---

## ⚠ O nome `propectai_migrator` engana

**Ele não roda migration nenhuma.**

Não existe `GRANT CREATE ON SCHEMA public` para papel algum nas migrations —
foi conferido. DDL é do dono, e continua sendo: `prisma migrate` conecta pelo
`DATABASE_URL`.

O que o papel tem é `ALL` nas tabelas e sequências, mais `BYPASSRLS`. Em uma
frase: **é o papel de escrita administrativa que atravessa a política**. Usado
pelos scripts de `prisma/` e pelas fixtures de teste.

Renomeá-lo custaria uma migration mexendo num papel referenciado por três
variáveis de ambiente e pelo CI. O nome fica; a leitura errada fica registrada
aqui e em `prisma/cliente.ts`.

---

## Isto já foi ensaiado

**O CI executa esta sequência inteira a cada push**, desde 04/09: sobe um
PostgreSQL limpo, roda `db:deploy`, dá senha aos três papéis, semeia, roda 399
testes e passa o portão.

O workflow está em `.github/workflows/ci.yml`, e o passo **"Dar senha aos três
papéis"** é o passo 3 acima, escrito em bash. Se algo neste documento parecer
ambíguo, aquele arquivo é a versão executável.

A diferença entre o ensaio e o real: **em CI o dono é superusuário porque a
imagem Docker o faz assim.** É exatamente a premissa que a primeira seção manda
verificar antes de escolher onde hospedar.
