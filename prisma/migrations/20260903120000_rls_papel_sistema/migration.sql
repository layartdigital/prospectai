-- Papel `propectai_sistema` — os caminhos que atravessam tenants por desenho.
--
-- **Nada muda de comportamento aqui.** O papel nasce sem ninguém usando, igual
-- ao passo 1: a aplicação continua conectando como `propectai_app`, e nenhum
-- código pede este papel até a fatia seguinte. Esta migration só cria a
-- credencial e delimita o alcance dela.
--
-- =============================================================================
-- Por que ele precisa existir
-- =============================================================================
--
-- Seis caminhos do produto leem ou escrevem **sem um tenant a declarar**, e não
-- por descuido: em todos, saber qual é o tenant é o resultado da consulta, não
-- a entrada dela.
--
--   1. `TenantGuard`            — escolhe o membership padrão da pessoa
--   2. `AuthService.getSession` — lista os workspaces de uma pessoa
--   3. `TeamService.conviteValido` — acha o convite pelo token
--   4. `BillingService.acharTenant` — acha o tenant pelo webhook do Stripe
--   5. `AdminService`           — painel do provedor, atravessa por definição
--   6. `PrivacyService.anonimizarAtor` — varre as linhas da pessoa em todos
--
-- Nenhum é resolvível por `comTenant`: declarar o contexto exigiria saber a
-- resposta que a consulta existe para descobrir. **A circularidade é real, e
-- nenhum embrulho a desfaz.**
--
-- Os quatro primeiros apareceram um de cada vez, ao converter o código. Os dois
-- últimos eram conhecidos desde o levantamento.
--
-- =============================================================================
-- Por que BYPASSRLS, e por que num papel separado
-- =============================================================================
--
-- Três desenhos foram considerados. Os dois recusados importam tanto quanto o
-- escolhido, porque os dois são tentadores.
--
-- **Recusado 1: `SET ROLE` a partir do papel da aplicação.** Exigiria
-- `GRANT propectai_sistema TO propectai_app`, e `SET ROLE` é um comando SQL
-- comum — qualquer trecho de código, hoje ou daqui a um ano, poderia escalar
-- privilégio com uma linha. A separação viraria convenção, e convenção não é
-- controle. **Este arquivo não concede essa associação, e isso é deliberado.**
--
-- **Recusado 2: um valor sentinela no contexto**, do tipo
-- `current_setting('app.tenant_id') = '*'` permitindo tudo na política. A
-- escalada passaria a ser uma *string*, alcançável por qualquer chamada a
-- `comTenant('*', ...)`. Um erro de digitação vira vazamento entre clientes.
--
-- **Escolhido: papel próprio, com credencial própria, e `BYPASSRLS`.** Para
-- escalar é preciso ter a outra conexão — não basta escrever a linha certa. É a
-- mesma razão de `propectai_app` não ser dono de tabela nenhuma: o controle é
-- estrutural, não disciplinar.
--
-- =============================================================================
-- O alcance é enumerado, e não amplo
-- =============================================================================
--
-- `BYPASSRLS` desliga a política inteira para quem o tem. O que limita o
-- estrago, então, são os `GRANT` — e por isso eles são **tabela por tabela**,
-- em vez de `ON ALL TABLES` como no `propectai_app`.
--
-- O efeito é uma propriedade legível neste arquivo: mesmo com a política fora
-- do caminho, este papel **não alcança `leads`, `lead_notes`,
-- `lead_contact_records`, `proposals`, `contracts`, `outreach_messages` nem
-- `digital_presence_audits`** — o dado do cliente, que é o que a separação de
-- tenants existe para proteger.
--
-- **Não há `ALTER DEFAULT PRIVILEGES` para ele, e é de propósito.** Tabela nova
-- nasce invisível a este papel. Se um dia o painel administrativo precisar de
-- uma, o sintoma será `permission denied` — alto, imediato, e obrigando alguém
-- a decidir conscientemente ampliar o alcance. O contrário — tabela nova
-- entrando no alcance sozinha — é como o escopo cresce sem ninguém notar.
--
-- =============================================================================
-- Idempotência
-- =============================================================================
--
-- Mesma razão do passo 1: papel é objeto de CLUSTER, não de banco, e o
-- `prisma migrate dev` revalida migrations num shadow database. Um `CREATE ROLE`
-- cru rodaria duas vezes e travaria toda migration futura do projeto.
--
-- Os `GRANT ... ON DATABASE` usam `current_database()` pelo mesmo motivo: no
-- shadow o banco tem outro nome.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'propectai_sistema') THEN
    EXECUTE 'CREATE ROLE propectai_sistema LOGIN BYPASSRLS';
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO propectai_sistema',
                 current_database());
END $$;

GRANT USAGE ON SCHEMA public TO propectai_sistema;

-- -----------------------------------------------------------------------------
-- Leitura
-- -----------------------------------------------------------------------------
--
-- Uma linha por tabela, com o caminho que a justifica. Tabela sem justificativa
-- escrita não entra.

GRANT SELECT ON "tenants"            TO propectai_sistema; -- guard, billing, admin
GRANT SELECT ON "memberships"        TO propectai_sistema; -- guard, getSession, admin
GRANT SELECT ON "users"              TO propectai_sistema; -- getSession (raiz da consulta)
GRANT SELECT ON "subscriptions"      TO propectai_sistema; -- guard, getSession, admin
GRANT SELECT ON "plans"              TO propectai_sistema; -- guard (plano do tenant), admin
GRANT SELECT ON "plan_usages"        TO propectai_sistema; -- admin (consumo por tenant)
GRANT SELECT ON "lead_activities"    TO propectai_sistema; -- admin (contagem de atividade)
GRANT SELECT ON "onboarding_states"  TO propectai_sistema; -- getSession
GRANT SELECT ON "invitations"        TO propectai_sistema; -- conviteValido (busca por token)
GRANT SELECT ON "audit_logs"         TO propectai_sistema; -- anonimizarAtor, admin
GRANT SELECT ON "refresh_tokens"     TO propectai_sistema; -- admin (revogar sessões)

-- **`lead_activities` é contagem, não conteúdo.** O painel agrega atividade por
-- tenant; não lê `leads`. Se um dia precisar do conteúdo, a mudança tem que
-- passar por aqui — que é exatamente o ponto.

-- -----------------------------------------------------------------------------
-- Escrita
-- -----------------------------------------------------------------------------
--
-- Bem menor que a leitura, e essa assimetria é intencional. Cinco operações, em
-- quatro tabelas.

GRANT UPDATE         ON "tenants"        TO propectai_sistema; -- admin: suspender e reativar
GRANT INSERT, UPDATE ON "subscriptions"  TO propectai_sistema; -- admin: trocar plano (upsert)
GRANT INSERT, UPDATE ON "audit_logs"     TO propectai_sistema; -- admin registra; anonimizarAtor reescreve o ator
GRANT UPDATE         ON "refresh_tokens" TO propectai_sistema; -- admin: revogar sessões

-- Nenhum `DELETE` em lugar nenhum. Nada que este papel faz apaga linha: o
-- painel suspende (não remove), e a eliminação do ator **substitui** o
-- identificador em vez de apagar o registro — é a decisão D4, e é o que
-- preserva o evento para quem investiga um incidente depois.

-- Sequências: só as das tabelas em que ele insere.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO propectai_sistema;

-- **Senha: NÃO fica aqui**, mesma regra do passo 1. O Postgres local autentica
-- por confiança; cada ambiente define a sua com `ALTER ROLE ... PASSWORD`, fora
-- do controle de versão. Item do checklist do primeiro deploy — e agora são
-- três credenciais a provisionar, não duas.
