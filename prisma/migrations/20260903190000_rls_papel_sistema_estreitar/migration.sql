-- Estreita o `propectai_sistema` ao que a fase A provou que ele usa.
--
-- =============================================================================
-- Por que existe: a enumeração de 03/09 foi generosa demais
-- =============================================================================
--
-- A migration `20260903120000_rls_papel_sistema` concedeu escrita em quatro
-- tabelas porque o levantamento classificava o `AdminService` inteiro como
-- "atravessa tenants de propósito". A conversão dele (fatia 8c) mostrou que a
-- classificação estava certa sobre o arquivo e errada sobre a granularidade:
--
--   - `listTenants` atravessa mesmo — agrega `plan_usages` e `lead_activities`
--     de todos os tenants ao mesmo tempo, e não há um tenant a declarar porque
--     a resposta é sobre o conjunto;
--   - `changePlan`, `suspend` e `reactivate` recebem o `tenantId` por
--     parâmetro e agem sobre **um** workspace. Foram para o `comTenant`, que
--     para eles é mais apertado: sob política, um defeito que calculasse o
--     tenant errado é recusado pelo `WITH CHECK` em vez de gravar no vizinho
--     em silêncio.
--
-- Com os três sob a política, as escritas que eu havia concedido ao papel do
-- sistema **passaram para o papel da aplicação** e deixaram de ser necessárias.
--
-- **Esta migration vem depois da 8c, e a ordem não é negociável.** Estreitar o
-- privilégio antes de estreitar o código derrubaria o painel administrativo com
-- `permission denied`. Primeiro o código deixa de precisar; depois o banco
-- deixa de conceder.
--
-- =============================================================================
-- O que sobra
-- =============================================================================
--
-- Leitura em 10 tabelas e **uma única escrita**: o `UPDATE` em `audit_logs`,
-- que é a eliminação do ator da decisão D4 — a operação que varre as linhas de
-- uma pessoa em todos os workspaces dela, e por isso não tem tenant a declarar.
--
-- Nenhum `INSERT`. Nenhum `DELETE`. Nenhuma sequência.
--
-- `refresh_tokens` sai inteiramente do alcance: a revogação de sessões vive no
-- `suspend`, que agora roda sob `comTenant`. Sessão é da pessoa e não do
-- workspace — a tabela não tem `tenantId` e nenhuma política a filtra —, mas o
-- recorte de **quais** sessões morrem vem do `membership.findMany`, que é
-- escopado e está sob a política.

REVOKE UPDATE          ON "tenants"        FROM propectai_sistema;
REVOKE INSERT, UPDATE  ON "subscriptions"  FROM propectai_sistema;
REVOKE INSERT          ON "audit_logs"     FROM propectai_sistema;
REVOKE ALL             ON "refresh_tokens" FROM propectai_sistema;

-- Sem nenhum `INSERT`, nenhuma sequência é alcançada. Se um dia for preciso, o
-- sintoma será `permission denied` — alto e imediato —, que é o mesmo princípio
-- de não haver `ALTER DEFAULT PRIVILEGES` para este papel.
REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM propectai_sistema;

-- `REVOKE` de privilégio que não existe é operação nula, não erro — então isto
-- é idempotente por natureza e sobrevive à revalidação no shadow database.
