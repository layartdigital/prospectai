# P04-REL-01 — G. Resumo executivo para decisão do proprietário

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora · **Versão:** 1.1.1 · **Data:** 02/11/2026 · **Para:** Uilson Távora, Layart Agência Digital
**Relação com a homologação:** continua o P04-CLOSE-01 (CI #77 e #78 aprovados; PR #7 em rascunho). Commit de release: `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79`.
> **Errata 1.1.1 (P04-REL-01C, 02/11/2026).** A coleta complementar mostrou que **os containers não foram "recriados às 15:38" de 30/10**: foram **criados** entre 13:34 e 14:35 e **iniciados juntos** às 15:38:22 porque o **servidor reiniciou** (uptime de 2 d 21 h no preflight e `docker-proxy` iniciado no mesmo segundo). A hipótese de "reversão deliberada para `pre-dbrem06`" **foi descartada**: a `api` roda a `pre-dbrem06` porque foi criada quando essa era a `:latest`, e a `:latest` atual (build de 15:24) **nunca foi implantada**. A porta `3101` é do **gateway do Bellvia**, não do ProspectAI. Ver `P04-REL-01C-RELATORIO.md` §1–§2 e §4. Os parágrafos abaixo ficam como publicados na 1.1.0, exceto onde marcados "(corrigido)".

**Nada foi publicado, mesclado, migrado ou reiniciado.** A Executora não executou nada no servidor: a observação (E08) foi feita por você, com um roteiro somente leitura. `F:\drmind` (Bellvia) não foi modificado.

## A. Resumo

O Intelligence Explorer está pronto do ponto de vista do código e dos testes automatizados. **O preflight no servidor mostrou que o endereço de homologação (`prospectai-stage.layart.com.br`) é a própria stack `prospectai-prod`**: mesmo gateway, mesmos serviços, **mesmo banco**. Publicar o Explorer "em homologação" é, na prática, **publicar na stack que está no ar**. A ordem manda parar nesse caso até haver decisão do proprietário, e é isso que este relatório faz.

**Parecer: `NOT_READY` para aprovar o deploy.** Não por problema no Explorer (delta pequeno, só leitura, sem migration, sem variável nova), mas por **três bloqueios operacionais** e **uma decisão sua**:

1. **Decisão:** a stack atende usuário ou dado real? (define Estratégia D ou C)
2. **Backup:** não há backup utilizável (último dump com 6 semanas, nunca restaurado).
3. **Rollback:** o plano da primeira versão etiquetaria a imagem errada; já foi corrigido, mas só se prova na execução.
4. **GATE-DB-42501:** recriar a `api` descarta o log; falta sua decisão sobre o que preservar.

A boa notícia: **o servidor tem folga** (193 GB livres, ~8 GB de memória disponível, 6 CPUs) e **está limpo e alinhado** (árvore na `main` `2c4b1b2`, sem alteração local, arquivos de configuração presentes, saúde `ok`).

## B. Ambiente encontrado (observado em 02/11/2026 15:52 UTC)

- **Servidor** `108.174.144.216` (Ubuntu 24.04.4, Docker 29.7.1, Compose v5.3.1), uptime de 2 dias 21 h, carga baixa. `/opt/apps/prospectai`, projeto `prospectai-prod`: **7 serviços em execução**, contadores de reinício em 0, criados em 30/10/2026 (13:34–14:35) e iniciados juntos às 15:38 após reinício do servidor (corrigido na 1.1.1).
- **Domínio:** resolve para o servidor; certificado Let's Encrypt válido até 06/01/2027; o nginx do host entrega ao gateway `127.0.0.1:3102` da stack. **Cenário C confirmado.**
- **Estado de saúde hoje:** `/api/v1/health` = `ok` (`database`, `redis`, `scraper` = `ok`); `/login` 200; `/api/v1/system/version` = `0.1.1`, `production`, **`commit: null`**.
- **Commit implantado:** a **árvore** está em `2c4b1b2` (`main`, merge do PR #6, 30/10). As **imagens** não são identificáveis pelo endpoint. **Achado:** a `api` em execução usa a imagem etiquetada `pre-dbrem06`, **não** a `:latest`.
- **Banco compartilhado:** um único `postgres` e um único `redis`, com volumes únicos. Há também uma **stack de desenvolvimento antiga parada há ~3 semanas** (outro banco, outros volumes), que **não** atende o domínio.
- **Porta `3101`** aberta em todas as interfaces por um processo **ainda não identificado** (o compose do projeto publica só `127.0.0.1:3102`).

## C. Estratégia recomendada (única, condicionada)

**Estratégia D — o mecanismo que o projeto já usa** (git + `docker compose build` no servidor + `up -d` de serviços nomeados), com salvaguardas: snapshot das imagens **pelo ID da imagem em execução**, backup com teste de restauração, exportação dos logs se você decidir preservá-los, checkout do SHA exato e prova de que os serviços não tocados não reiniciaram.

Ela **só vale se você declarar por escrito** que a stack `prospectai-prod` é **ambiente de teste, sem cliente nem dado real**. Se houver cliente ou dado real, publicar ali é publicar em produção — **a recomendação passa a ser a Estratégia C** (homologação isolada), que exige trabalho de infraestrutura próprio: o `compose.prod.yml` atual **não** suporta uma segunda instância (sub-rede, IPs, porta e pasta de dados fixos). A Estratégia B (homologação independente existente) foi **descartada**: o preflight não encontrou nenhuma. A A (imagens construídas fora do servidor) fica como evolução futura.

## D. Impacto esperado numa rodada futura

| Componente | Ação | Efeito |
|---|---|---|
| API (NestJS) | recriar com a imagem nova | segundos de indisponibilidade; sessões continuam |
| Web (Next.js) | recriar com a imagem nova | segundos; recarregar a página |
| Worker, gateway, PostgreSQL, Redis, scraper | **nenhuma** | linha de base: `StartedAt` de 30/10, 0 reinícios |
| Banco / migrations / variáveis / compose / nginx | **nenhuma** | — |
| Outras aplicações do servidor | nenhuma | apenas **carga durante o build**; nenhum container tem limite de recursos |

**Atenção ao raio de impacto:** construir a partir da árvore entrega o Explorer **mais tudo o que a `main` mudou desde a build das imagens atuais**. Pelo histórico, é provavelmente pouco (web de ~3 semanas, `api` de ~3 dias), mas **não está provado**: falta a data de criação das imagens. O Explorer só **lê** (2 endpoints GET) e **não exige merge**; recomendo **não mesclar o PR #7 antes da sua aceitação**.

## E. Segurança

- **Multi-tenant:** leituras sob RLS forçada, filtro por workspace e prova de profundidade assinada (HMAC) com o `JWT_ACCESS_SECRET` já existente (presente no `.env.production`); 27 E2E reais passaram, incluindo Alfa×Beta e troca de sessão. **No destino ainda falta provar** com duas contas de workspaces diferentes.
- **Papéis do banco:** nada nesta ordem tocou `propectai_app`, `_migrator`, `_dono` ou `_sistema`, RLS, ACL ou privilégios; o plano **não usa superusuário** para contornar erro. O `pg_dump` do plano usa o usuário de bootstrap do container **sem imprimir valores**, e só porque a RLS forçada tornaria incompleto um dump feito por papel comum.
- **Segredos:** a saída do preflight foi lida por inteiro; **só há nomes de variável**. A saída bruta **não vai para o repositório** (público): registram-se o hash e excertos sanitizados.
- **Isolamento de terceiros:** o roteiro v1.0 imprimiu, na listagem de `/opt/backups`, **nomes de pastas de outras aplicações**. Não foram copiados para nenhum documento; o roteiro v1.1 filtra por projeto.
- **Porta `3101`** não identificada (§B): risco de exposição direta; precisa de `ss -ltnp` filtrado.
- **Atenção:** a conta de demonstração já teve senha publicada no repositório (rotação documentada em 25/09). Confirmar antes de usá-la.

## F. Backups e rollback

- **Backup — `BLOCKED`.** Há dois dumps (17 e 21/09, 42.560 bytes, `gzip -t` íntegro), **anteriores às janelas DB-REM de outubro**, **nunca restaurados**; nenhuma rotina agendada cita o projeto. As pastas `prospectai-dbrem04/06-…` (30/10) **não foram inspecionadas** e podem ter dump recente. Para `PASS`: dump novo (ou o de 30/10, se existir) **e restauração em container descartável**.
- **Rollback — `BLOCKED` (por construção).** Reetiquetar a imagem anterior e recriar `web`, depois `api`; sem rollback de banco. **Correção:** a primeira versão etiquetaria `:latest`; como a `api` roda a `pre-dbrem06`, isso voltaria a uma versão que não estava no ar. O snapshot agora é **pelo ID da imagem em execução**. O rollback só passa a `PASS` quando o snapshot existir (na execução). Não é destrutivo e não restaura o dump.

## G. Pendências e bloqueadores (precisam de decisão ou de leitura adicional)

| # | Item | Tipo |
|---|---|---|
| 1 | **A stack `prospectai-prod` atende usuário ou dado real?** Declarar a natureza da stack por escrito | **decisão; destrava D × C** |
| 2 | A `api` rodar a imagem `pre-dbrem06` é intencional? (reversão em 30/10?) | esclarecimento |
| 3 | Que logs do GATE-DB-42501 devem sobreviver, e o T1 de 01/11 já foi coletado? | **bloqueador** (`DB_42501_PRESERVATION = BLOCKED`) |
| 4 | Backup: autorizar dump novo + restauração de teste (escrita em `/opt/backups`) | bloqueador (REL-08) |
| 5 | Leituras somente leitura adicionais (roteiro v1.1): processo da `:3101`, data de criação das imagens, bloco do vhost `/auth/register`, nomes/tamanhos das pastas `dbrem04/06` | desbloqueiam REL-03/06/08/12 |
| 6 | Bloco 13 (catálogo do PostgreSQL, sessão somente leitura): papéis e migrations aplicadas | opcional; fecha o estado do banco |
| 7 | O `git fetch` do servidor (SSH) funciona? Se não, usar `git bundle` por `scp` | operacional |
| 8 | Segunda conta/workspace de teste para o smoke S2; decisão sobre D8 (SHA no endpoint); item **"Intelligence" no menu** visível a todos | smoke / produto |
| 9 | Fora do escopo: `upload-artifact@v4` (Node 20) e `ubuntu-latest` → Ubuntu 26 no CI | informativo |

`SEC-DATA-01 = OPEN / NOT_EXECUTED`, `GATE-DB-42501 = OPEN`, `SEC-DB-02 = NOT_STARTED`: **preservados, não executados.**

## H. Próxima autorização necessária

Duas coisas, **independentes e nesta ordem**:

1. **Suas decisões** (itens 1, 2, 3 e 8 da §G). Sem a 1, a Executora **não** prepara nem a Estratégia D nem a C.
2. **`P04-REL-01C — Leituras complementares somente leitura`** (opcional, recomendada): você roda o roteiro **v1.1** (ou o autoriza a Executora por canal somente leitura) e, se quiser, com o bloco 13. Fecha REL-03, 06, 08 (parcial) e 12 **sem nenhuma alteração** no servidor.

**Só depois** faz sentido a ordem `P04-REL-02 — Controlled Staging Deployment & Operational Acceptance`: se a decisão for **D**, ela executa o plano com backup, snapshot e rollback; se for **C**, a ordem correta é antes uma de infraestrutura (`P04-REL-02-INFRA`) para montar a homologação isolada. **Nada será executado, mesclado ou publicado sem sua autorização expressa.**

## Gates (v1.1.0)

| Gate | Resultado | Base |
|---|---|---|
| REL-01 Domínio e destino confirmados | **PASS** | DNS → `108.174.144.216`; TLS válido até 06/01/2027; vhost → `127.0.0.1:3102`; `/`, `/login`, `/api/v1/health`, `/api/v1/system/version` responderam (E08 §9–§11) |
| REL-02 Isolamento comprovado | **FAIL** | o domínio é a stack `prospectai-prod`; banco, redis e volumes únicos; nenhuma segunda stack em execução (E08 §4, §5, §9) |
| REL-03 Commit exato identificado | **PARTIAL** | árvore: `2c4b1b2`, `main`, limpa (observado). Imagens: não identificadas; `commit: null`; `api` em `pre-dbrem06` |
| REL-04 Compatibilidade API/web | **PASS** | mesmo SHA; endpoints aditivos; E2E real da dupla (CI #77); ordem API → web |
| REL-05 Migrations | **PASS** (nenhuma necessária para o delta) | `git diff -- prisma/` sem migration; estado das migrations no banco **NOT_VERIFIED** (bloco 13 não executado) |
| REL-06 Impacto em serviços compartilhados | **PARTIAL** | redes e volumes do projeto só têm containers do projeto; daemon, disco e nginx são compartilhados; porta `:3101` não identificada |
| REL-07 Capacidade | **PASS** | 193 GB livres; ~8,3 GB de memória disponível; 6 CPUs; sem limites nos containers (monitorar o build) |
| REL-08 Backup e restauração | **BLOCKED** | dumps de 17 e 21/09; nunca restaurados; pastas `dbrem04/06` não inspecionadas |
| REL-09 Rollback preparado | **BLOCKED** | plano corrigido (snapshot por ID); a etiqueta só existe na execução |
| REL-10 Pendências DB-42501 / SEC-DATA-01 | **BLOCKED** | preservadas nesta rodada; recriar `api` perderia o log; aguarda decisão |
| REL-11 Smoke tests definidos | **PASS** | `P04-REL-01-SMOKE-TEST-PLAN.md` (v1.1.0, com discriminadores 404→401 e build ID do Next) |
| REL-12 Sem risco não autorizado a outras aplicações | **NOT_VERIFIED** | depende de REL-02, da `:3101` e da carga do build |

**Regra de parada acionada:** domínio de homologação associado diretamente à produção / isolamento insuficiente / banco compartilhado sem estratégia aprovada. Alternativas registradas na §C; **nada foi "consertado" automaticamente**.

## Veredito

```text
PROJECT                         = PROSPECTAI
MODULE                          = INTELLIGENCE_EXPLORER
MODULE_VERSION                  = 0.1.0

P04_IMPLEMENTATION              = COMPLETE
P04_AUTOMATED_HOMOLOGATION      = PASS
P04_DOCUMENTATION               = CLOSED

P04_REL_01_EXECUTION            = COMPLETE
P04_REL_01_RESULT               = NOT_READY

STAGING_DOMAIN_CONFIRMED        = YES
STAGING_ISOLATION               = FAIL   (domínio = stack prospectai-prod; Cenário C)
DEPLOYED_COMMIT_IDENTIFIED      = PARTIAL (árvore 2c4b1b25fac8e4266b3505270bb43e05127c60a7; imagens não identificadas)
RELEASE_COMMIT                  = cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79

DATABASE_SHARED                 = YES
MIGRATIONS_REQUIRED             = NO   (para o delta do Explorer; estado do banco no servidor NOT_VERIFIED)
BACKUP_GATE                     = BLOCKED
ROLLBACK_GATE                   = BLOCKED

CAPACITY_GATE                   = PASS
OTHER_STACK_IMPACT              = PARTIAL (redes/volumes do projeto isolados; host, daemon e nginx compartilhados; porta 3101 não identificada)
DB_42501_PRESERVATION           = BLOCKED

PRODUCTION_RELEASE              = NOT_AUTHORIZED
MERGE_EXECUTED                  = NO
DEPLOY_EXECUTED                 = NO
DATABASE_MUTATIONS              = 0
SERVICE_RESTARTS                = 0
OTHER_STACKS_MODIFIED           = 0

NEXT_STEP                       = AWAIT_OWNER_APPROVAL   (decisões da §G e, se quiser, P04-REL-01C)
```

`P04_REL_01_EXECUTION = COMPLETE` porque REL-A foi executada (por você, com o roteiro somente leitura) e REL-B a REL-G foram produzidas como documentação, como a ordem pede. `NOT_READY` **não** é falha do Explorer: é o resultado honesto de um servidor em que "homologação" e "produção" são o mesmo lugar, sem backup restaurável e com decisões pendentes sobre evidência.
