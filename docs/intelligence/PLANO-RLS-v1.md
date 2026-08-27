# Plano — ligar RLS sem quebrar a suíte

**Versão 1 · 26/08/2026 · executa a decisão D2, medida em `SPIKE-RLS-v1.md`**

O spike respondeu *se* funciona, e a que custo. Este documento responde *como chegar lá* — e a resposta tem uma parte que o spike não podia mostrar, porque só aparece quando se olha para o que já existe.

---

## O maior custo não é o RLS. São as fixtures.

**Todo teste com banco monta o cenário e confere o resultado com Prisma cru, sem contexto de tenant.**

`audits-http.spec.ts` cria tenants, leads e audits direto pelo client. `audit-pipeline.spec.ts` idem, e ainda lê `digitalPresenceCheck.count()` para provar que replay não duplica. `scrape-pipeline.spec.ts`, `business-invariants.spec.ts`, `tenant-isolation.spec.ts` — todos.

Sob `FORCE ROW LEVEL SECURITY`, **cada uma dessas consultas passa a enxergar zero linhas.** Não com erro: com vazio. Os testes falham em cascata com asserções sem sentido, e a causa não aparece na mensagem.

Isso não é acidente do jeito como foram escritos — é o jeito certo de escrever fixture. O conserto não é mudar 300 testes.

### O conserto: dois clients no teste, com papéis diferentes

- **Fixture e limpeza** conectam com um papel `BYPASSRLS`. Montar cenário é operação administrativa; não faz sentido submetê-la à política que se quer testar.
- **Asserção sobre isolamento** conecta com o papel da aplicação. É o único jeito de S8 e S9 provarem alguma coisa: um teste que monta e confere com o mesmo papel privilegiado não prova isolamento nenhum.

**Essa separação é uma melhoria, não um remendo.** Hoje os testes de isolamento usam o mesmo client para tudo, o que significa que provam a chave composta e o `where` — não a política do banco. Com dois papéis, S8 e S9 passam a medir a coisa certa.

Custo: uma variável de ambiente a mais e um helper de client nos specs com banco.

---

## Três papéis, e por que não dois

O spike mostrou que **o dono da tabela ignora RLS**. A conclusão natural — "ligue `FORCE`" — resolve isso e cria outro problema: com `FORCE`, migration de dado e seed também param de funcionar, silenciosamente, com `UPDATE 0`.

Os dois modos de falha são silenciosos. A diferença é onde doem:

| | sem `FORCE` | com `FORCE` |
|---|---|---|
| app apontado para o dono por engano | **perde proteção em produção** | protegido |
| seed e migration de dado | funcionam | **afetam 0 linhas em silêncio** |

O primeiro é falha de segurança em produção; o segundo é falha de desenvolvimento que um teste pega. Então: **`FORCE` ligado, e um papel próprio para migration e seed.**

| papel | atributo | quem usa |
|---|---|---|
| `propectai` | dono das tabelas | DDL das migrations |
| `propectai_migrator` | `BYPASSRLS` | `db:seed`, migrations de dado, fixtures de teste |
| `propectai_app` | nenhum, **não é dono** | api e worker em execução |

O `propectai_app` não ser dono é cinto e suspensório: mesmo que alguém remova o `FORCE` um dia, ele continua sujeito à política.

### Correção: os papéis autenticam por senha, não por confiança

A migration do passo 1 afirma, em comentário, que *"o Postgres local do projeto autentica por confiança, então os papéis logam sem senha"*. **É falso.** O sintoma apareceu na primeira execução do passo 2, com o papel novo:

```
PrismaClientInitializationError: Authentication failed against database server
at `localhost`, the provided database credentials for `propectai_migrator` are not valid.
```

Escrevi aquele comentário sem ler o `.env` — e não ler continua certo, porque a credencial do banco não precisa entrar numa sessão de trabalho. O erro não foi deixar de ler: foi **afirmar como fato o que eu tinha escolhido não verificar**. Diante de algo que se decidiu não olhar, a resposta é perguntar, não deduzir.

O que muda na prática:

- **Cada ambiente define as duas senhas**, fora do controle de versão. Em desenvolvimento:
  ```sql
  ALTER ROLE propectai_migrator PASSWORD 'migrator_dev_only';
  ALTER ROLE propectai_app      PASSWORD 'app_dev_only';
  ```
  E a senha entra na `DATABASE_URL_MIGRATOR` do `.env`.
- **O comentário errado permanece no arquivo da migration, e é assim que tem de ser.** A `20260826230000_rls_papeis` já está aplicada; editar o arquivo muda o checksum e o Prisma passa a recusar **toda** migration seguinte com *"migration modified after being applied"*. Um comentário impreciso custa menos que um repositório que não migra. A correção mora aqui, e este parágrafo é o ponteiro.
- **O passo 4 herda um item de checklist**: apontar a aplicação para o `propectai_app` exige a senha dele na `DATABASE_URL`, e o primeiro deploy exige as duas definidas antes de qualquer migration rodar.

---

## O canário: duas tabelas, um módulo

Ligar RLS em quarenta tabelas de uma vez é apostar que o mecanismo funciona. Ligar em duas é descobrir.

**`digital_presence_audits` e `digital_presence_checks`** são as candidatas óbvias: nasceram há três dias, têm um módulo só escrevendo nelas (`AuditsService` na API, `processAuditJob` no worker), volume baixo, e o caminho inteiro já está exercitado por `audit:e2e`.

Se o mecanismo estiver errado, ele erra ali — onde o estrago é uma auditoria, não o produto.

---

## Os dois processos

**API e worker escrevem nessas tabelas**, e os dois precisam definir a variável de sessão.

Na API, o tenant vem do `TenantGuard`, que já resolve por requisição. No worker, vem no payload do job — o `processAuditJob` recebe `tenantId` e já o usa na chave composta.

Nenhum dos dois precisa de mágica. O que precisa existir é um lugar só onde a transação é aberta e a variável definida, e nada abaixo dele tocando o Prisma direto.

### Explícito, não interceptado

Duas formas de fazer:

**(a) Extensão do client + `AsyncLocalStorage`** — toda operação vira transação automaticamente. Menos código nos chamadores, e **custo de round trip em toda consulta**, inclusive nas que não têm tenant. Também é mágica: quem lê `prisma.lead.findMany()` não vê que há uma transação ali.

**(b) Helper explícito** — `prisma.comTenant(tenantId, (tx) => ...)`. Quem chama vê o que acontece, e paga o custo só onde precisa.

**Recomendo (b)**, e o argumento vem do próprio repositório: o `tenant.guard.ts` já registra que *"lista envelhece em silêncio: alguém cria um endpoint novo, esquece de incluir, e a regra fica diferente do que se decidiu sem ninguém notar"*. Interceptação tem a mesma propriedade — funciona até alguém adicionar um caminho que ela não cobre, e aí falha sem avisar.

Com (b), quem esquece de embrulhar recebe **zero linhas**, que é ruidoso e local. O teste de isolamento pega.

---

## Ordem, e o que cada passo garante

**1. Papéis.** ✅ *feito em 26/08 — migration `20260826230000_rls_papeis`.* `propectai_migrator` com `BYPASSRLS`, `propectai_app` sem nada. Grants nas tabelas existentes e nas futuras (`ALTER DEFAULT PRIVILEGES`).
→ *Nada muda.* Ninguém usa os papéis novos ainda.
→ Verificado com `docs/intelligence/gate0/verificacoes-rls-passo1.sql`: 5 de 5 consultas com o resultado esperado, 43 de 43 tabelas alcançáveis pelo `propectai_app`, `rolbypassrls` falso nele, zero conexões usando os papéis novos.

**2. Fixtures de teste no `propectai_migrator`.** ✅ *feito em 27/08.* Variável de ambiente própria (`DATABASE_URL_MIGRATOR`); os specs que tocam as tabelas do canário passam a montar cenário com ela.
→ *Nada muda.* `BYPASSRLS` sem RLS ligado é igual a hoje. **Este passo é o que torna o passo 4 reversível** — sem ele, ligar RLS quebra tudo de uma vez e não dá para saber se o problema é a política ou a fixture.
→ Recorte em relação ao que este plano previa: **dois arquivos, não dez.** O canário do passo 4 são duas tabelas, então só `audits-http.spec.ts` e `audit-pipeline.spec.ts` precisam da separação agora. Os demais specs entram no passo 6, junto com as tabelas que eles tocam.

**3. `comTenant` no `PrismaService`, e o `AuditsService` e o `processAuditJob` usando.** RLS ainda desligado.
→ *Nada muda no resultado*; só aparecem transações onde antes havia consultas soltas. Aqui se mede o custo real de latência no ambiente de vocês, com RLS fora do caminho — que é a única forma de separar o custo do round trip do custo da política.

**4. `ENABLE` + `FORCE` + política nas duas tabelas de auditoria. App aponta para `propectai_app`.**
→ *Agora muda.* A suíte inteira roda. `audit:e2e` roda. Se algo enxergar zero linhas, é um caminho que esqueceu o `comTenant` — e o erro é local.

**5. S8 e S9**, com o client do papel da aplicação: leitura cruzada devolve zero.
→ **Só depois deles o RLS pode ser considerado ligado.** Os três modos de falha do spike são silenciosos; sem um teste que prove isolamento, RLS é pior que uma extensão do Prisma, porque *parece* mais seguro.

**6. Espalhar para as demais tabelas**, uma família por vez, com o mesmo teste replicado.

Os passos 1 a 3 não mudam comportamento. O passo 4 é o único com risco, e ele reverte com um `ALTER TABLE ... NO FORCE`.

---

## O que este plano não resolve

**O `$queryRaw` continua sendo o buraco que só o RLS fecha** — e é exatamente por isso que ele vale a pena. Mas o `comTenant` não alcança quem chama `$queryRaw` fora dele. Sob RLS o resultado é zero linhas, o que é falha barulhenta e local; ainda assim, vale uma varredura por `$queryRaw` e `$executeRaw` antes do passo 4.

**PgBouncer não está no caminho hoje** e não foi testado. Se entrar, em modo *transaction*, o `set_config` local à transação continua correto — mas isso é afirmação minha, não medição. Fica para quando existir.

**O custo em consulta barata é real**: +159% de latência, medido. Se aparecer um endpoint de leitura frequente e barata, ele merece medição própria antes de assumir que o número é aceitável.

---

## Antes de começar

Este plano depende da D2 estar decidida. A recomendação do spike é adotar RLS; se a escolha for a extensão do Prisma, **os passos 1, 2 e 3 são desperdício** e o documento inteiro perde o propósito.

`F:\drmind` não foi modificado.
