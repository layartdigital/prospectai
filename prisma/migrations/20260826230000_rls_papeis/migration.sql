-- Passo 1 do `PLANO-RLS-v1.md` — papéis e privilégios.
--
-- **Nada muda de comportamento aqui.** Os papéis nascem sem ninguém usando:
-- a aplicação continua conectando como hoje até o passo 4. Este arquivo só
-- prepara o terreno para que o passo 4 seja reversível.
--
-- ---
--
-- **Tudo é idempotente, e não é preciosismo.** O `prisma migrate dev` valida
-- migrations replicando-as num shadow database. Papéis são objetos de CLUSTER,
-- não de banco — então um `CREATE ROLE` cru rodaria uma segunda vez no shadow e
-- falharia com "role already exists", travando toda migration futura do
-- projeto.
--
-- Pelo mesmo motivo os `GRANT ... ON DATABASE` usam `current_database()`: no
-- shadow o banco tem outro nome, e um literal apontaria para o lugar errado.

DO $$
BEGIN
  -- Papel de migration e seed. **`BYPASSRLS` é o que o torna necessário.**
  --
  -- Com `FORCE ROW LEVEL SECURITY` ligado no passo 4, até o dono da tabela fica
  -- sujeito à política — e uma migration de dado passa a afetar zero linhas
  -- **sem erro**, com a migration marcada como aplicada. Medido no spike:
  -- `UPDATE 0` como dono, `UPDATE 50001` com este atributo.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'propectai_migrator') THEN
    EXECUTE 'CREATE ROLE propectai_migrator LOGIN BYPASSRLS';
  END IF;

  -- Papel de execução. Sem `BYPASSRLS`, e **deliberadamente não é dono** de
  -- tabela nenhuma.
  --
  -- Não ser dono é cinto e suspensório: o spike mostrou que o dono ignora RLS
  -- por padrão, e `ENABLE` sem `FORCE` não protege absolutamente nada. Se um dia
  -- alguém remover o `FORCE`, este papel continua sujeito à política porque não
  -- é dono de nada.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'propectai_app') THEN
    EXECUTE 'CREATE ROLE propectai_app LOGIN';
  END IF;
END $$;

-- Conexão e uso do schema.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO propectai_app, propectai_migrator',
                 current_database());
END $$;

GRANT USAGE ON SCHEMA public TO propectai_app, propectai_migrator;

-- O papel da aplicação escreve e lê dado. **Não recebe DDL**: criar e alterar
-- tabela continua sendo trabalho de migration, com outro papel.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO propectai_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO propectai_app;

-- O de migration precisa de tudo, inclusive para o `db:seed`.
GRANT ALL ON ALL TABLES IN SCHEMA public TO propectai_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO propectai_migrator;

-- **Tabelas futuras.** Sem isto, toda migration nova criaria tabela invisível
-- para o `propectai_app`, e o sintoma seria "permission denied" numa rota que
-- funcionava ontem — meses depois, sem ninguém ligar uma coisa à outra.
--
-- `FOR ROLE propectai` porque privilégio padrão se aplica ao que um papel
-- específico cria, e quem cria tabela aqui é o dono que roda as migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE propectai IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO propectai_app;
ALTER DEFAULT PRIVILEGES FOR ROLE propectai IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO propectai_app;
ALTER DEFAULT PRIVILEGES FOR ROLE propectai IN SCHEMA public
  GRANT ALL ON TABLES TO propectai_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE propectai IN SCHEMA public
  GRANT ALL ON SEQUENCES TO propectai_migrator;

-- Senha: NÃO fica aqui.
--
-- O Postgres local do projeto autentica por confiança, então os papéis logam
-- sem senha e o repositório não ganha um segredo. **Em produção isso não
-- serve** — cada ambiente define a sua com `ALTER ROLE ... PASSWORD`, fora do
-- controle de versão, e é item do checklist do primeiro deploy.
