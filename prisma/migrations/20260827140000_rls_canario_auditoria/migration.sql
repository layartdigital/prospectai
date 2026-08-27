-- Passo 4 do `PLANO-RLS-v1.md` — a politica, nas duas tabelas do canario.
--
-- **Este e o unico passo que muda comportamento.** Os passos 1 a 3 prepararam
-- o terreno justamente para que este pudesse ser revertido sem drama.
--
-- Reverter: `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` nas duas tabelas, ou
-- — mais simples ainda — apagar a linha `DATABASE_URL_APP` do `.env`, porque
-- sem ela a aplicacao volta a conectar como dono e o `FORCE` some do caminho.
--
-- ---
--
-- Duas tabelas, e nao quarenta. `digital_presence_audits` e
-- `digital_presence_checks` nasceram ha tres dias, tem um modulo so escrevendo
-- nelas, volume baixo, e o caminho inteiro ja e exercitado por `audit:e2e`.
-- Se o mecanismo estiver errado, ele erra ali — onde o estrago e uma auditoria,
-- nao o produto.

-- =====================================================================
-- digital_presence_audits
-- =====================================================================

ALTER TABLE "digital_presence_audits" ENABLE ROW LEVEL SECURITY;

-- **`ENABLE` sozinho nao protege nada.** Medido no spike: o dono da tabela
-- ignora RLS por padrao, e a aplicacao conectava como dono. `FORCE` e o que
-- sujeita o proprio dono a politica.
--
-- O preco vem no outro lado — migration de dado e `db:seed` passariam a afetar
-- zero linhas em silencio — e e por isso que o passo 1 criou o
-- `propectai_migrator` com `BYPASSRLS`.
ALTER TABLE "digital_presence_audits" FORCE ROW LEVEL SECURITY;

-- **Duas politicas, e a segunda e restritiva. Isso nao e preciosismo.**
--
-- Politicas permissivas se combinam por OR. Uma unica politica permissiva de
-- isolamento funciona hoje e some no dia em que alguem acrescentar
-- `CREATE POLICY leitura_admin ... USING (true)` para uma tela nova: o OR
-- anula o isolamento **para todo mundo**, sem erro, sem sintoma.
--
-- Politicas restritivas se combinam por AND, e o AND nao tem como ser anulado
-- por adicao. Entao a regra de tenant mora numa restritiva, e uma permissiva
-- minima existe so para dar a base — porque tabela sem nenhuma politica
-- permissiva nao mostra linha nenhuma.
--
-- Resultado: qualquer politica futura, permissiva ou nao, continua obrigada a
-- passar pelo filtro de tenant. E o mesmo argumento de o `propectai_app` nao
-- ser dono: defender contra a edicao futura, nao so contra o estado de hoje.
CREATE POLICY "acesso_base" ON "digital_presence_audits"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

-- `current_setting(..., true)` devolve NULL quando o parametro nunca foi
-- definido — e `"tenantId" = NULL` e NULL, que nao e verdadeiro. **A ausencia
-- de contexto nega por padrao**, que e o comportamento certo: um caminho que
-- esqueceu o `comTenant` enxerga zero linhas, ruidoso e local, em vez de
-- enxergar tudo.
--
-- `WITH CHECK` nao e redundante com `USING`. `USING` decide o que se ve;
-- `WITH CHECK` decide o que se pode gravar. Sem ele, um INSERT poderia
-- escrever uma linha com o `tenantId` do vizinho — invisivel para quem
-- escreveu, e bem visivel para o vizinho.
CREATE POLICY "tenant_isolamento" ON "digital_presence_audits"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- =====================================================================
-- digital_presence_checks
-- =====================================================================

ALTER TABLE "digital_presence_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "digital_presence_checks" FORCE ROW LEVEL SECURITY;

CREATE POLICY "acesso_base" ON "digital_presence_checks"
  AS PERMISSIVE FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_isolamento" ON "digital_presence_checks"
  AS RESTRICTIVE FOR ALL
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- =====================================================================
-- O que esta politica NAO cobre, e por que esta tudo bem
-- =====================================================================
--
-- **Integridade referencial ignora RLS, por desenho do Postgres.** As FKs
-- compostas `(tenantId, auditId) -> (tenantId, id)` e o cascade de `Lead`
-- continuam funcionando com a politica ligada. Isso e documentado e
-- deliberado: sem essa isencao, uma FK poderia ser violada so porque a linha
-- referenciada esta invisivel.
--
-- O efeito colateral conhecido dessa isencao e um canal lateral: uma violacao
-- de unicidade revela que existe uma linha que voce nao pode ver. **Aqui isso
-- nao vaza nada**, porque os dois indices unicos comecam por `tenantId` —
-- `@@unique([tenantId, id])` e `@@unique([tenantId, idempotencyKey])`. Nao ha
-- como colidir com a linha de outro tenant sem ja saber o `tenantId` dele.
--
-- Os nomes de coluna vao entre aspas porque o schema usa `@@map` nas tabelas e
-- **nao** usa `@map` nos campos: as colunas sao camelCase no banco.
