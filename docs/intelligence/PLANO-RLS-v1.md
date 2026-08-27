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
→ Verificado com `gate0/verificacoes-rls-passo1.sql`: 5 de 5 consultas com o resultado esperado, 43 de 43 tabelas alcançáveis pelo `propectai_app`, `rolbypassrls` falso nele, zero conexões usando os papéis novos.

**2. Fixtures de teste no `propectai_migrator`.** ✅ *feito em 27/08.* Variável de ambiente própria (`DATABASE_URL_MIGRATOR`); os specs que tocam as tabelas do canário passam a montar cenário com ela.
→ *Nada muda.* `BYPASSRLS` sem RLS ligado é igual a hoje. **Este passo é o que torna o passo 4 reversível** — sem ele, ligar RLS quebra tudo de uma vez e não dá para saber se o problema é a política ou a fixture.
→ Recorte em relação ao que este plano previa: **dois arquivos, não dez.** O canário do passo 4 são duas tabelas, então só `audits-http.spec.ts` e `audit-pipeline.spec.ts` precisam da separação agora. Os demais specs entram no passo 6, junto com as tabelas que eles tocam.

**3. `comTenant` no `PrismaService`, e o `AuditsService` e o `processAuditJob` usando.** ✅ *feito em 27/08.* RLS ainda desligado.
→ *Nada muda no resultado*; só aparecem transações onde antes havia consultas soltas. Aqui se mede o custo real de latência no ambiente de vocês, com RLS fora do caminho — que é a única forma de separar o custo do round trip do custo da política.
→ **Medido com `pnpm rls:bench`**, piso de ruído de 0,2%. Ver *"O custo, medido"* abaixo.
→ Duas armadilhas encontradas ao envolver código existente em transação, ambas de escrita silenciosamente perdida: `.catch()` em torno de `update` (o Postgres aborta a transação e o `COMMIT` vira `ROLLBACK` sem lançar) e recuperação de `P2002` lendo o banco dentro da mesma transação que falhou. Detalhe no `CHANGELOG.md` de 27/08.
→ Varredura por `$queryRaw`/`$executeRaw` feita: só o `SELECT 1` do healthcheck e os dois `set_config`. **Nenhum caminho solto**, que era o pré-requisito do passo 4.

**4. `ENABLE` + `FORCE` + política nas duas tabelas de auditoria. App conecta como `propectai_app`.** ✅ *feito em 27/08 — migration `20260827140000_rls_canario_auditoria`.*
→ *Agora muda.* A suíte inteira roda. Se algo enxergar zero linhas, é um caminho que esqueceu o `comTenant` — e o erro é local.
→ **Correção ao que este plano dizia.** A frase original era "app aponta para `propectai_app`", e a leitura óbvia seria trocar o `DATABASE_URL`. **Isso quebraria o `prisma migrate`**: o Prisma CLI lê essa variável, e `migrate`, `db:seed`, `db:studio` e os scripts de `prisma/` passariam a conectar como um papel sem DDL. `directUrl` resolveria o `migrate` e deixaria o seed e os scripts no mesmo problema. O que foi feito: **`DATABASE_URL_APP`**, lido só por quem executa a aplicação (`PrismaService` na API, `criarPrismaApp()` no worker). O `DATABASE_URL` continua sendo o dono. Reverter o passo 4 é apagar essa linha do `.env`.
→ **A política de tenant é `RESTRICTIVE`**, com uma permissiva mínima ao lado. Permissivas se combinam por OR: uma política futura com `USING (true)` anularia o isolamento para todo mundo, sem erro. Restritivas se combinam por AND.
→ **O dono do banco é superusuário**, e superusuário ignora RLS mesmo com `FORCE`. A proteção inteira depende de a aplicação não conectar com ele — daí o primeiro teste do canário ser `SELECT current_user`.

**5. S8 e S9**, com o client do papel da aplicação: leitura cruzada devolve zero. ✅ *feito em 27/08 — `apps/worker/test/rls-canario.spec.ts`, 10 testes.*
→ **Só depois deles o RLS pode ser considerado ligado.** Os três modos de falha do spike são silenciosos; sem um teste que prove isolamento, RLS é pior que uma extensão do Prisma, porque *parece* mais seguro.
→ A diferença em relação ao S13 do `audit-pipeline.spec.ts`: lá o código sob teste sempre passa `tenantId` na chave composta, então o que se prova é a chave. Aqui as consultas são escritas **sem filtro de tenant nenhum** — quem recusa é a política, ou não há política.
→ Verificação de catálogo em `gate0/verificacoes-rls-passo4.sql`. **Suas consultas 5 e 6 nasceram tautológicas** — mediam "zero visível" contra uma tabela que a suíte deixa vazia, e aquele zero sairia igual sem política nenhuma. Refeitas: `EXPLAIN` (que mostra o `Filter` da política independentemente de haver dado) e contagem com denominador.

**6. Espalhar para as demais tabelas**, uma família por vez, com o mesmo teste replicado.
→ O que o canário deixou pronto para esta etapa, e que não estava previsto aqui: a **regra de escopo** medida no passo 3 (o custo é por chamada de `comTenant`, não por requisição — telas de listagem e dashboard precisam ser envolvidas de uma vez), e o trabalho de fixtures que o passo 2 recortou para dois arquivos. Os outros specs com banco entram aqui, junto com as tabelas que eles tocam.
→ E o `EntitlementsService`, que usa o próprio client e portanto fica fora do `tx` de quem o chama. Sem efeito hoje — `plan_usage` e `subscriptions` não estão no canário —, e é a primeira coisa a resolver quando entrarem.

Os passos 1 a 3 não mudam comportamento. O passo 4 é o único com risco, e ele reverte apagando a linha `DATABASE_URL_APP` do `.env` — sem tocar no banco. O `ALTER TABLE ... NO FORCE` continua disponível, mas deixou de ser o primeiro recurso.

---

## O custo, medido

`pnpm rls:bench` · 300 iterações, braços intercalados, p50 em ms. O braço `controle` é idêntico ao `solto`: a diferença entre os dois é o piso de ruído da máquina, e ele saiu em **0,2%**. Tudo abaixo disso não se lê.

| | solto | transação | `comTenant` | total |
|---|---:|---:|---:|---:|
| leitura por chave | 2,983 | 6,087 | 8,000 | **+168%** |
| lista de 50 | 3,712 | 7,476 | 9,723 | **+162%** |

Os `+159%` do spike se confirmam neste ambiente. E o benchmark responde duas coisas que o spike não separava.

**A transação custa mais que o `set_config`, e por larga margem.** O `BEGIN`/`COMMIT` sozinho já dobra a consulta — +3,1 ms na leitura por chave, +3,8 ms na lista. O `set_config` acrescenta +1,9 e +2,2 ms. A divisão é estável: **cerca de 60% transação, 40% `set_config`**.

Isso importa para a D2. A alternativa recusada — extensão do client injetando `where: { tenantId }` — **não precisa de transação nenhuma**, e portanto não paga nada disto. O custo de adotar RLS não é o `set_config`; é a transação que ele obriga a existir. Quem defender a extensão daqui em diante está defendendo economizar ~5 ms por operação, e a resposta continua sendo a do spike: a extensão não alcança `$queryRaw` e falha em silêncio quando alguém acrescenta um caminho que ela não cobre.

**E a segunda: o custo não se diluiu na consulta maior, ao contrário do que previ.** Em absoluto ele até subiu — +5,0 ms na leitura por chave contra +6,0 ms na lista.

A explicação é que a "lista de 50" não é uma consulta cara: são 3,7 ms contra 3,0 ms da leitura por chave, 0,7 ms de trabalho a mais. As duas formas são baratas, e o overhead é **fixo, entre 5 e 6 ms**. A hipótese da diluição não foi refutada — **não foi testada**, porque o benchmark não tem nenhuma consulta lenta o bastante para testá-la. Fica como está: sem evidência.

### A regra de uso que sai daí

O custo é **por chamada de `comTenant`, não por requisição**. Uma rota que chama o helper cinco vezes paga cinco vezes; as mesmas cinco consultas dentro de um `comTenant` só pagam o `BEGIN`/`COMMIT`/`set_config` uma vez.

**Envolva o escopo mais amplo que fizer sentido, não cada consulta.** Com a ressalva já escrita no helper: nada de I/O externo lá dentro, o que na prática limita o escopo ao bloco de trabalho de banco.

O código de hoje está dentro da regra — `criar` usa duas transações porque a conferência de saldo mora entre elas, `detalhe` usa uma, e o `processAuditJob` usa duas num job que leva 300 ms. **Onde isso vai doer é no passo 6**: telas de listagem e o dashboard, que fazem várias consultas por requisição, precisam ser envolvidas de uma vez, não consulta a consulta.

---

## O que este plano não resolve

**O `$queryRaw` continua sendo o buraco que só o RLS fecha** — e é exatamente por isso que ele vale a pena. Mas o `comTenant` não alcança quem chama `$queryRaw` fora dele. Sob RLS o resultado é zero linhas, o que é falha barulhenta e local; ainda assim, vale uma varredura por `$queryRaw` e `$executeRaw` antes do passo 4.

**PgBouncer não está no caminho hoje** e não foi testado. Se entrar, em modo *transaction*, o `set_config` local à transação continua correto — mas isso é afirmação minha, não medição. Fica para quando existir.

**O custo em consulta barata é real**: +168% no ambiente de vocês, ~5 ms absolutos por chamada de `comTenant`. Se aparecer um endpoint de leitura frequente e barata, ele merece medição própria antes de assumir que o número é aceitável — e a primeira pergunta a fazer é quantas vezes ele chama o helper.

---

## Antes de começar

Este plano depende da D2 estar decidida. A recomendação do spike é adotar RLS; se a escolha for a extensão do Prisma, **os passos 1, 2 e 3 são desperdício** e o documento inteiro perde o propósito.

`F:\drmind` não foi modificado.
