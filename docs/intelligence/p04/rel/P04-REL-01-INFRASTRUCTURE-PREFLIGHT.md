# P04-REL-01 — A. Preflight da infraestrutura

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (Squad DevOps/SRE, com AppSec e Database Engineering) · **Versão do documento:** 1.0.0 · **Data:** 02/11/2026
**Relação com a homologação:** parte do P04-REL-01, posterior ao encerramento P04-CLOSE-01. Commit de release: `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79` (PR #7, rascunho; CI #77 e #78 aprovados, informados pelo proprietário).
**`F:\drmind` (Bellvia) não foi modificado.** Nada foi executado no servidor.

## 1. Em uma tela

A fase REL-A pedia para observar o servidor. **Não consegui observá-lo**: a sessão da Executora não tem canal para ele (ver §2). Por isso este documento separa quatro tipos de afirmação e não mistura:

| Classe | Significado | Exemplo |
|---|---|---|
| **OBSERVADO** | visto por comando executado agora | resposta 403 do proxy ao tentar o domínio de homologação |
| **REPOSITÓRIO** | lido no código do commit `cebbfa6` | `compose.prod.yml` tem projeto, sub-rede e IPs fixos |
| **HISTÓRICO** | registrado em documento do projeto, com data; **não é estado atual** | runbook de 21–22/09: nginx do host → `127.0.0.1:3102` |
| **NOT_VERIFIED** | depende do servidor e não foi visto | commit implantado, isolamento, backup, capacidade |

O que o repositório prova com firmeza: **o delta do Explorer é pequeno e aditivo** (API + web, sem migration, sem variável nova, sem mudança de compose/Dockerfile/nginx, só leitura). O que ele **não** prova: onde o domínio `prospectai-stage.layart.com.br` aponta, se existe uma stack de homologação separada, qual commit está no ar, se há backup restaurável e se há espaço. Essas respostas precisam de uma execução somente leitura no servidor (roteiro pronto: `P04-REL-01-preflight-somente-leitura.sh`).

## 2. Tentativas de observação desta rodada

| # | Canal | O que foi tentado | Resultado | Classe |
|---|---|---|---|---|
| 1 | Sessão da Executora → internet | `GET https://prospectai-stage.layart.com.br/` (e `/login`, `/api/v1/health`, `/api/v1/system/version`) | O túnel foi recusado pelo proxy da sessão: `CONNECT tunnel failed, response 403` (`connect_rejected` no status do proxy). **Nenhuma requisição chegou ao domínio.** | OBSERVADO |
| 2 | Sessão da Executora | Resolução DNS do domínio (`getent hosts`) | Sem resposta neste ponto de rede. Não prova que o domínio não resolve: o proxy intermedeia a rede. | OBSERVADO (inconclusivo) |
| 3 | Sessão da Executora | Certificado TLS (`openssl s_client`) | Não obtido (mesmo bloqueio) | OBSERVADO (inconclusivo) |
| 4 | Computador do proprietário (VM do Cowork) | `device_bash` para DNS/HTTP/SSH | A VM **não iniciou**: "this device has too little free disk space to set up the environment, which needs up to 17 GB" | OBSERVADO |
| 5 | SSH/Docker no servidor | — | **Não há** credencial, chave nem canal autorizado nesta sessão; nada foi tentado | — |
| 6 | Repositório local (commit `cebbfa6`) | leitura de `compose.prod.yml`, Dockerfiles, nginx, docs, `git diff`, migrations | Concluído (ver §3, §5, §6) | REPOSITÓRIO |

Não contornei o bloqueio do proxy (ele é uma política da sessão) e não há outra via que a ordem autorize sem o servidor.

## 3. As 13 perguntas da ordem

| # | Pergunta | Resposta | Classe | Evidência |
|---|---|---|---|---|
| 1 | Onde o ProspectAI está implantado? | Registrado: `108.174.144.216`, `/opt/apps/prospectai`, projeto Compose `prospectai-prod`. **Hoje: não confirmado.** | HISTÓRICO / NOT_VERIFIED | `docs/intelligence/ATUALIZAR-AMBIENTE-ONLINE.md` §1; `compose.prod.yml:1` |
| 2 | O endereço de homologação aponta para qual aplicação/stack? | **Não sei.** O domínio `prospectai-stage.layart.com.br` **não aparece em nenhum arquivo do repositório**. | NOT_VERIFIED | busca textual no commit `cebbfa6` (0 ocorrências) |
| 3 | A homologação é realmente isolada? | **Não comprovado.** O repositório só define **uma** stack (`prospectai-prod`); não há compose de homologação. | NOT_VERIFIED | ver §4 |
| 4 | Compartilha banco, containers ou volumes com a operação atual? | **Não comprovado.** Se o domínio for só um *virtual host* na frente da porta `3102`, compartilha **tudo**. | NOT_VERIFIED (hipótese) | `compose.prod.yml`: um `postgres`, um `redis`, volumes únicos |
| 5 | Qual commit está implantado? | **Não identificável pelo endpoint.** `/api/v1/system/version` devolve `commit` a partir de `GIT_COMMIT`, e **nenhum arquivo do projeto define `GIT_COMMIT` nem `BUILT_AT`**: o campo sai `null`. Último SHA registrado: `991f459` em 22/09/2026, antes das janelas DB-REM de 28–30/10, cujo resultado no servidor não está documentado. | NOT_VERIFIED | `system.controller.ts:71-72`; busca por `GIT_COMMIT`; runbook §5 |
| 6 | Qual procedimento de deploy já existe? | **Manual**, documentado: `git` no servidor, `docker compose build` **no servidor**, `up -d` de serviços **nomeados**. Sem job de deploy no CI (`permissions: contents: read`) e sem registro de imagens. | REPOSITÓRIO | runbook §3; `ci.yml` |
| 7 | Como publicar sem modificar outras aplicações? | Só `api` e `web` do projeto `prospectai-prod`, por nome, com `--no-deps`; nenhum comando global. Ver `P04-REL-01-DEPLOYMENT-PLAN.md`. | PLANO | — |
| 8 | Exige merge na `main`? | **Não, tecnicamente.** O servidor pode trazer o SHA exato da branch. Recomendo **não** mesclar antes da aceitação humana (REL-F). A `main` atual (`2c4b1b2`) está contida na branch: 7 commits à frente, 0 atrás, sem divergência. | REPOSITÓRIO | `git rev-list --count origin/main..HEAD` = 7; `HEAD..origin/main` = 0 |
| 9 | Exige migration ou mudança de configuração? | **Migration: não** — `git diff origin/main..HEAD -- prisma/` só mostra o script de fixtures do E2E (que **recusa** banco não local e não faz parte da imagem de runtime). **Variável nova: não** — a prova de profundidade usa o `JWT_ACCESS_SECRET` já exigido pela API (`getOrThrow`). **compose, Dockerfiles e nginx: inalterados.** Ressalva na §6. | REPOSITÓRIO | `git diff`; `depth-proof.ts`; `intelligence.service.ts:110` |
| 10 | Como retornar à versão anterior? | Reetiquetar a imagem anterior e recriar `web` e depois `api`; sem rollback de banco (nada muda). Ver `P04-REL-01-ROLLBACK-PLAN.md`. | PLANO | — |
| 11 | Quais serviços seriam reiniciados? | **Recriados: `api` e `web`** (segundos de indisponibilidade cada). **Não tocados: `worker`, `gateway`, `postgres`, `redis`, `gmaps-scraper`.** | REPOSITÓRIO + PLANO | `git diff --stat` (não há código do worker; `packages/types` só ganhou exportações) |
| 12 | Como comprovar que os módulos anteriores funcionam? | Smoke manual por camadas + comparação de `StartedAt` dos serviços não tocados + baseline de 56 testes do CI. O E2E do CI **não roda como está** contra o servidor (fixtures recusam banco não local). Ver `P04-REL-01-SMOKE-TEST-PLAN.md`. | PLANO | — |
| 13 | O que verificar antes de liberar para testes humanos? | Os gates REL-01…REL-12 e o checklist `P04-REL-01-RELEASE-CHECKLIST.md`. | PLANO | — |

## 4. Topologia: o que o repositório permite concluir

**Cadeia presumida** (HISTÓRICO, 21/09): domínio/IP → **nginx do host** → `127.0.0.1:3102` → **gateway** (nginx em container) → `web:3100` e `api-proxy:3101` → `postgres`/`redis`/`gmaps-scraper`. A configuração do nginx **do host** não está no repositório (só a do gateway, `infra/nginx/default.conf`).

**Fatos do `compose.prod.yml` (REPOSITÓRIO) que importam para o isolamento:**

| Fato | Consequência |
|---|---|
| `name: prospectai-prod` fixo | uma segunda instância do mesmo arquivo exigiria `-p` diferente |
| Sub-rede `proxy_api` **fixa** `172.30.250.0/29`, com IPs fixos `.2` (gateway) e `.3` (api) | **colide** se uma segunda stack usar o mesmo arquivo na mesma máquina |
| Porta publicada fixa `127.0.0.1:3102` | **colide** com uma segunda stack |
| Volume do scraper `/opt/data/prospectai/gmapsdata` (caminho do host) | seria **compartilhado** entre duas stacks |
| Volumes nomeados `prospectai_postgres_data` e `prospectai_redis_data` | ganham o prefixo do projeto; seriam separados com `-p` diferente |
| Env files fixos `.env.production`, `.env.banco`, `.env.dono` | outra stack precisaria de arquivos próprios (e segredos próprios) |

**Conclusão (não é presunção, é o que esses fatos implicam):** o repositório **não suporta** uma segunda stack de homologação sem um arquivo de override (nome de projeto, sub-rede, porta, volumes, env files). Se a homologação for realmente independente, ela foi montada fora do repositório e **precisa ser documentada**; se não existir, o domínio de homologação provavelmente só aponta para a stack existente.

**Cenário (A–D da ordem): `D — estado não comprovado`.** A hipótese mais provável pelas evidências do repositório é **C** (domínio apenas aponta para a stack existente), mas isso é hipótese, não conclusão. Não presumi isolamento por causa da palavra `stage`.

Contexto histórico relevante (HISTÓRICO, 17/09): a stack existente foi descrita pelo proprietário como **"ambiente de teste online, não produção com cliente"** e o domínio da época **não resolvia**; o acesso era pelo IP. Isso pode ter mudado e **não substitui** a verificação.

**Máquina compartilhada** (HISTÓRICO, 17/09): o mesmo daemon Docker roda `drmind-prod-*` (Bellvia), `adsaudit-*` com Authentik, uma stack Supabase, n8n, Portainer e um host PHP. Daí as regras: nada de `docker system/volume/network prune`, nada sem o nome do serviço, nenhum `down`.

## 5. Delta do release, comprovado no repositório

`git diff origin/main..HEAD` fora de `docs/`: **46 arquivos, 7.464 linhas**. Para o servidor, importam:

| Componente | Muda? | Detalhe |
|---|---|---|
| **API (NestJS)** | **Sim** | `IntelligenceModule` novo (`app.module.ts`); 2 endpoints **GET** — `intelligence/graph` e `intelligence/expand` — atrás de `JwtAuthGuard` + `TenantGuard`; leituras em `comTenant` (RLS) |
| **Web (Next.js)** | **Sim** | rota `/intelligence`, componentes do Explorer, item "Intelligence" no menu (`nav.ts`), vigia de sessão (`session-events.ts`, `session.ts`, formulários de login/cadastro/convite e botão de sair), botão "Explorar relações" na ficha do lead |
| **`packages/types`** | Sim (aditivo) | módulos do grafo, layout, contrato de IA e identidade de sessão; consumido por API e web **no build** |
| **Worker** | **Não** | nenhum arquivo do worker mudou; recompilá-lo não é necessário |
| **PostgreSQL / schema / migrations** | **Não** | zero migrations; o Explorer lê tabelas criadas até `20260824110516_f3_auditoria_presenca_digital` (e `20260728120458_migration_prospectai_1`) |
| **Variáveis de ambiente** | **Não** | usa `JWT_ACCESS_SECRET` já existente |
| **compose.prod.yml / Dockerfiles / nginx** | **Não** | idênticos aos da `main` |
| **Escrita no banco pelo Explorer** | **Nenhuma** | só `GET`; sem `create/update/delete` no serviço |

Tabelas lidas pelo serviço: leads, pesquisas, notas, atividades, contatos, follow-ups, score e motivos, presença digital, auditorias e verificações de presença digital, cartão e etapa do pipeline.

## 6. Ressalvas que só o servidor resolve

1. **Defasagem de configuração.** A árvore do `cebbfa6` traz o `compose.prod.yml` da `main`, que exige `.env.banco` e `.env.dono` (DB-REM-04) e as listas fechadas de variáveis do `web`/`worker` (OBS-WEB-ENV-01). Se o servidor ainda não passou por essas janelas, `docker compose` **recusa** subir (`required variable … is missing`) — de propósito — e a publicação **pararia antes de alterar qualquer coisa**. O roteiro lista os nomes de chave presentes (sem valores) para decidir antes.
2. **Estado das migrations no banco.** O Explorer só precisa das tabelas antigas. Mas o banco do servidor pode estar atrás das últimas migrations da `main` (`20261029160000`, `20261030190000`). Isso **não bloqueia o Explorer**, só precisa ser conhecido para não confundir um problema preexistente com um efeito do release. Leitura de catálogo (somente leitura) é o bloco opcional 13 do roteiro, sob autorização.
3. **Papéis do banco.** Preservados: nenhuma ação desta ordem usa superusuário, altera ownership, RLS, ACL ou *default privileges*. A API do Explorer roda como `propectai_app` (sem `BYPASSRLS`) como o resto da aplicação.
4. **Rotação do `JWT_ACCESS_SECRET`.** Invalida as provas de profundidade em circulação (a tela recarrega o grafo); não afeta dados.

## 7. Capacidade (estimativa, **hipótese**, não medida)

O build acontece **no servidor** (`COPY . .` + `pnpm install` + `next build` + `nest build`) e o Docker é compartilhado com outras aplicações. Estimativas de ordem de grandeza, a confirmar pelo roteiro: **duas imagens novas** (API e web, Node 24) na casa de **1 a 3 GB** em disco, mais cache de build; **pico de memória do `next build` na casa de 1–2 GB**; uso de CPU alto por alguns minutos. Sem medição do host, **`CAPACITY_GATE = BLOCKED`**. Nenhuma limpeza foi ou será feita (regra: sem `prune`).

## 8. Campos de registro (REL-A)

```text
HOST_ID                = NOT_VERIFIED (histórico: 108.174.144.216)
PROJECT_ROOT           = NOT_VERIFIED (histórico: /opt/apps/prospectai)
DEPLOYED_COMMIT        = NOT_VERIFIED (último registro: 991f459, 22/09/2026)
DEPLOYED_BRANCH        = NOT_VERIFIED (histórico: main)
DEPLOYMENT_METHOD      = MANUAL: git + docker compose build no servidor (REPOSITÓRIO; sem CI de deploy)
COMPOSE_PROJECT        = prospectai-prod (REPOSITÓRIO; instância no servidor NOT_VERIFIED)
CURRENT_SERVICE_COUNT  = NOT_VERIFIED (histórico: 7 serviços)
CURRENT_SERVICE_HEALTH = NOT_VERIFIED
```

## 9. Bloqueios e itens `REQUIRES_AUTHORIZATION`

| Item | Por quê | Quem desbloqueia |
|---|---|---|
| Rodar o roteiro somente leitura no servidor (ou dar à Executora um canal somente leitura) | única forma de fechar REL-01/02/03/06/07/08 | proprietário |
| Bloco 13 do roteiro (catálogo do PostgreSQL, sessão forçada a somente leitura) | consulta ao banco, ainda que só `pg_roles` e `_prisma_migrations` | proprietário |
| `git fetch` no servidor | proibido nesta ordem; faz parte do REL-D | proprietário |
| Exportar logs dos containers para arquivo (preservação do GATE-DB-42501) | escreve arquivo no servidor | proprietário |
| Liberar espaço no disco do computador do proprietário para a VM do Cowork voltar a iniciar | desbloqueia o canal #4 | proprietário |

## 10. Como devolver a observação

Rodar `bash P04-REL-01-preflight-somente-leitura.sh > preflight.txt 2>&1` no servidor, **sem** `P04_LER_CATALOGO` (a menos que autorize), conferir que não há segredo no arquivo e enviá-lo. Com ele, a Executora reclassifica os gates e fecha este documento (versão 1.1.0) sem refazer a descoberta.
