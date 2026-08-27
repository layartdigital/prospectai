# Spike — RLS no Postgres para isolamento na leitura

**Versão 1 · 24/08/2026 · decisão D2 de `DECISOES-ABERTAS-v1.md`**

Executado contra PostgreSQL 16.13 real, com a mesma configuração de propriedade do PropectAI: **o usuário da aplicação é dono das tabelas**, porque as migrations do Prisma rodam com ele.

Tudo abaixo é saída de comando, não dedução.

---

## O achado que muda a recomendação

**RLS mal configurado é indistinguível de RLS funcionando.** Ele não dá erro, não avisa, e devolve os dados de todo mundo.

```sql
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolado ON leads
  USING ("tenantId" = current_setting('app.tenant_id', true));
SET app.tenant_id = 'tenant-a';
SELECT current_user, count(*) FROM leads;
```

```
 current_user | linhas_visiveis
--------------+-----------------
 propectai    |               2      <-- os DOIS tenants
```

**O dono da tabela ignora RLS por padrão.** `ENABLE` sozinho não protege nada quando a aplicação conecta com o mesmo usuário que rodou as migrations — que é exatamente o caso aqui.

O conserto é uma palavra:

```sql
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
```

```
tenant-a  ->  1 linha
tenant-b  ->  1 linha
variavel nao definida  ->  0 linhas      (falha fechado)
INSERT para outro tenant  ->  ERROR: new row violates row-level security policy
```

Com `FORCE`: isola na leitura, **falha fechado** quando a variável não está definida, e de brinde **recusa escrita cruzada** — a cláusula `USING` serve de `WITH CHECK` quando não há uma explícita.

**Isto inverte parte do argumento que eu tinha usado a favor de RLS.** Eu disse que extensão do Prisma é promessa e RLS é restrição. Verdade — mas RLS sem `FORCE` também é só promessa, e **parece igual a uma que funciona**. A diferença entre as duas configurações não aparece em lugar nenhum além de uma consulta que ninguém pensa em fazer.

---

## Segundo modo de falha silenciosa: a variável vaza pelo pool

`SET` de sessão sobrevive ao fim da requisição. Com pool de conexões, a próxima requisição herda o tenant da anterior.

```
BEGIN; SET app.tenant_id='tenant-a'; SELECT count(*); COMMIT;   ->  1
-- requisicao 2, MESMA conexao, sem definir nada:
SELECT count(*)                                                  ->  1   <-- vazou
```

Com escopo de transação, não vaza:

```
BEGIN; SET LOCAL app.tenant_id='tenant-a'; SELECT count(*); COMMIT;  ->  1
SELECT count(*)  (depois do commit)                                  ->  0
```

**E `SET` não aceita parâmetro:**

```
PREPARE tenta(text) AS SET app.tenant_id = $1;
ERROR:  syntax error at or near "SET"
```

Isso não é detalhe de sintaxe — é segurança. Sem parâmetro, a tentação é interpolar o `tenantId` na string, e aí o mecanismo que existe para isolar tenants vira o vetor de injeção. **A forma correta é `set_config`**, que aceita parâmetro e escopo de transação:

```sql
SELECT set_config('app.tenant_id', $1, true);   -- true = local a transacao
```

Consequência prática: **toda leitura com escopo de tenant precisa estar dentro de uma transação.** No Prisma, isso é `$transaction` interativo, que fixa a conexão.

---

## Terceiro modo de falha silenciosa: migration de dado que não faz nada

Uma migration roda fora de qualquer tenant. Sob `FORCE`, como dono:

```
UPDATE leads SET name='backfill' WHERE "tenantId"='tenant-a';
UPDATE 0
```

**Zero linhas, sem erro, e o `prisma migrate` marca como aplicada.** Um backfill de produção passaria em silêncio.

Com papel separado:

```sql
CREATE USER propectai_migrator LOGIN BYPASSRLS;
```
```
UPDATE 50001
```

É a mesma classe do `prisma generate` que falhou em 24/08 e deixou cinco pacotes checando contra tipos velhos: **a operação diz que funcionou.**

---

## O custo, medido

### Planejador: zero

100 mil linhas, 50 mil por tenant, índice em `tenantId`.

```
-- COM RLS
Index Only Scan using "leads_tenantId_idx"
  Index Cond: ("tenantId" = current_setting('app.tenant_id'::text, true))

-- filtro escrito a mao, SEM RLS
Index Only Scan using "leads_tenantId_idx"
  Index Cond: ("tenantId" = 'tenant-a'::text)
```

**Planos idênticos.** `current_setting` é `STABLE`, então vira condição de índice igual a um literal. A objeção de performance ao RLS, na forma que este produto usa, não existe.

### Round trips: aí sim

`pgbench`, 4 clientes, 5s, localhost.

| consulta | sem RLS | com RLS | |
|---|---|---|---|
| pesada (varre 50k) | 4,42 ms · 905 tps | 4,67 ms · 857 tps | **+5%** |
| barata (1 linha por PK) | 0,24 ms · 16.580 tps | 0,62 ms · 6.432 tps | **+159% latência, −61% vazão** |

O custo **não é do RLS** — é dos round trips. Uma consulta vira quatro: `BEGIN`, `set_config`, a consulta, `COMMIT`. Em consulta pesada some no ruído; em consulta barata triplica a latência.

E isto foi medido em **socket local**. Sobre rede, o multiplicador se aplica à latência de rede, que é o número que dói.

---

## O que este spike NÃO provou

**O comportamento do Prisma.** Provei a mecânica em SQL. Não provei:

- se `$transaction` interativo do Prisma mantém a mesma conexão de forma confiável sob carga;
- o custo de uma extensão de client que embrulhe toda operação numa transação;
- o comportamento com PgBouncer em modo *transaction*, se ele entrar no caminho.

São três perguntas para um segundo spike, e nenhuma delas muda o que está acima.

---

## Recomendação

**Adotar RLS**, com quatro amarras — e a quarta é a que faz as outras três valerem:

1. **`FORCE ROW LEVEL SECURITY` em toda tabela com `tenantId`.** Sem `FORCE` não há proteção alguma.
2. **`set_config(..., true)` dentro de transação.** Nunca `SET` de sessão, nunca string interpolada.
3. **Papel separado com `BYPASSRLS`** para migrations e seed, e **só** para isso. O papel da aplicação nunca o tem.
4. **Um teste que prove que a leitura cruzada devolve zero** — e que rode em CI.

A quarta não é burocracia. Os três modos de falha acima são silenciosos: cada um deixa o sistema parecendo protegido enquanto não protege nada. **RLS sem esse teste é pior que uma extensão do Prisma, porque parece mais seguro.**

E esse teste tem nome: são **S8 e S9** de F0, que estavam bloqueadas esperando esta decisão. A coisa que torna o RLS confiável é exatamente a que a decisão destravava.

### Sobre o custo

Os 159% de latência valem a pena, com uma ressalva honesta: se aparecer um endpoint de leitura barata e muito frequente, ele merece medição própria antes de assumir que o custo é aceitável. Não é um número para aplicar sem olhar.

### Ordem sugerida

1. Papel `propectai_migrator` com `BYPASSRLS`; o papel da aplicação perde qualquer privilégio de bypass.
2. Migration ligando `ENABLE` **e** `FORCE` nas tabelas com `tenantId`, com a política de leitura.
3. O embrulho de transação no acesso da API.
4. S8 e S9 — e só depois delas o RLS pode ser considerado ligado.

---

## Reprodução

Todos os comandos acima rodam contra um Postgres limpo. O que os torna verificáveis é a configuração de propriedade: **crie o banco com o mesmo usuário que cria as tabelas**, senão o primeiro achado não aparece — e é ele que importa.

`F:\drmind` não foi modificado. O Postgres deste spike subiu efêmero no container da sessão, em porta própria, e não tocou em nenhum container Docker da sua máquina.
