# P04-REL-01 — G. Resumo executivo para decisão do proprietário

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora · **Versão:** 1.0.0 · **Data:** 02/11/2026 · **Para:** Uilson Távora, Layart Agência Digital
**Relação com a homologação:** continua o P04-CLOSE-01 (CI #77 e #78 aprovados; PR #7 em rascunho). Commit de release: `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79`.
**Nada foi publicado, mesclado, migrado ou reiniciado.** `F:\drmind` (Bellvia) não foi modificado.

## A. Resumo

O Intelligence Explorer está pronto do ponto de vista do código e dos testes automatizados. **O que ainda não sei é onde e como ele será publicado, porque não consegui olhar o servidor.** A sessão da Executora não tem canal para ele: o proxy recusou o endereço de homologação (403) e a máquina virtual do seu computador não iniciou por falta de espaço em disco. Nenhuma resposta sobre o servidor foi presumida; cada uma está marcada como observada, lida no repositório, histórica ou **não verificada**.

**Parecer: `INCONCLUSIVE` — não pronto para aprovação de deploy.** Não por problema no Explorer, e sim porque faltam as evidências de infraestrutura que a ordem exige antes de recomendar uma publicação. O plano, o rollback, os riscos, o smoke e o checklist estão prontos; falta um passo **somente leitura** no servidor para destravá-los.

## B. Ambiente encontrado

- **O que o repositório prova:** existe **uma** stack de produção (`prospectai-prod`, 7 serviços), sem compose de homologação. O arquivo tem sub-rede, IPs, porta e pasta de dados **fixos**, então **não dá para subir uma segunda stack com ele** sem um arquivo de override. O endereço `prospectai-stage.layart.com.br` **não aparece em nenhum arquivo do projeto**.
- **O que os documentos históricos dizem (21–22/09, não é estado atual):** servidor `108.174.144.216`, `/opt/apps/prospectai`, nginx do host → porta `127.0.0.1:3102`, acesso pelo IP, "ambiente de teste online, não produção com cliente", e **a máquina é compartilhada** com Bellvia (`drmind-*`), Authentik, Supabase, n8n, Portainer e PHP. Último SHA registrado: `991f459`.
- **Cenário de topologia: `D — não comprovado`.** A hipótese mais provável pelo repositório é a **C** (o domínio de homologação só aponta para a stack existente). É hipótese; a palavra `stage` no domínio não foi tratada como prova de isolamento.
- **Commit implantado:** não identificável pelo endpoint. `/api/v1/system/version` devolve `commit: null` porque nenhum arquivo define `GIT_COMMIT`. Só `git rev-parse HEAD` no servidor responde.

## C. Estratégia recomendada

**Estratégia D: o mecanismo que o projeto já usa** (git + `docker compose build` no servidor + `up -d` de serviços nomeados), com cinco salvaguardas: etiquetar as imagens atuais para o rollback, backup com teste de restauração, exportar logs se você decidir preservá-los, usar o SHA exato em HEAD destacado e provar que os serviços não tocados não reiniciaram. É o único caminho **já executado com sucesso** neste projeto e não cria arquitetura nova.

Ela só vale se: (1) o preflight mostrar que o domínio de homologação aponta para a stack existente **e** você confirmar por escrito que essa stack é **ambiente de teste sem cliente**; (2) backup e rollback forem comprovados; (3) você decidir sobre os logs do GATE-DB-42501. Se houver **cliente ou dado real** na stack, publicar ali seria publicar em produção — **a recomendação passa a ser montar homologação isolada (C)**, com trabalho de infraestrutura próprio.

## D. Impacto esperado numa rodada futura

| Componente | Ação | Efeito |
|---|---|---|
| API (NestJS) | recriar com a imagem nova | segundos de indisponibilidade; sessões continuam |
| Web (Next.js) | recriar com a imagem nova | segundos; recarregar a página |
| Worker, gateway, PostgreSQL, Redis, scraper | **nenhuma** | — |
| Banco / migrations / variáveis / compose / nginx | **nenhuma** | — |
| Outras aplicações do servidor | nenhuma | apenas **carga durante o build** (a medir) |

O Explorer só **lê** (2 endpoints GET) e não exige merge: o servidor pode usar o SHA da branch. **Recomendo não mesclar o PR #7 antes da sua aceitação.**

## E. Segurança

- **Multi-tenant:** leituras sob RLS forçada, filtro por workspace e prova de profundidade assinada (HMAC) com o `JWT_ACCESS_SECRET` já existente; 27 E2E reais passaram, incluindo Alfa×Beta e troca de sessão. **No destino ainda falta provar** com duas contas de workspaces diferentes (a segunda conta, se não existir, exige sua autorização).
- **Papéis do banco:** nada nesta ordem tocou `propectai_app`, `_migrator`, `_dono` ou `_sistema`, RLS, ACL ou privilégios; o plano **não usa superusuário** para contornar erro.
- **Segredos:** o roteiro de inspeção imprime só **nomes** de variável; o plano não usa `docker compose config` nem `inspect` sem filtro.
- **Atenção:** a conta de demonstração já teve senha publicada no repositório (rotação documentada em 25/09). Confirmar no preflight que foi rotacionada antes de usá-la.

## F. Backups e rollback

- **Backup:** nenhuma evidência atual. Em 21/09 houve um dump (42 KB). Backup automatizado nunca foi coberto pelo projeto. **`BACKUP_GATE = BLOCKED`.**
- **Rollback:** desenhado e **simples** (reetiquetar as duas imagens anteriores e recriar `web`, depois `api`; sem rollback de banco porque nada muda). Mas ele **depende de etiquetar as imagens antes** da publicação, o que só ocorre na execução. **`ROLLBACK_GATE = BLOCKED`** até lá. Rollback **não é destrutivo** e não restaura o dump.

## G. Pendências e bloqueadores (precisam de decisão sua)

| # | Item | Tipo |
|---|---|---|
| 1 | Rodar o roteiro **somente leitura** no servidor (ou liberar canal de leitura à Executora) | **destrava tudo** |
| 2 | Liberar espaço no disco do seu computador (a VM do Cowork precisa de até 17 GB) | canal alternativo |
| 3 | Dizer **que logs** do GATE-DB-42501 precisam sobreviver e **se o T1 de 01/11 já foi coletado**; recriar a `api` descarta o log da instância atual | **bloqueador** (`DB_42501_PRESERVATION = BLOCKED`) |
| 4 | Declarar a **natureza da stack** (teste sem cliente / operacional) | decide D × C |
| 5 | Indicar/autorizar **segunda conta de workspace** para provar o isolamento no destino | smoke S2 |
| 6 | Decidir D8 (gravar `GIT_COMMIT`/`BUILT_AT` no `.env.production` para o endpoint informar o SHA) | opcional |
| 7 | Item **"Intelligence" no menu aparece para todos os usuários** autenticados: manter ou ocultar? | produto |
| 8 | Fora do escopo: `upload-artifact@v4` (Node 20) e migração do `ubuntu-latest` para o Ubuntu 26 no CI | informativo |

`SEC-DATA-01 = OPEN / NOT_EXECUTED`, `GATE-DB-42501 = OPEN`, `SEC-DB-02 = NOT_STARTED`: **preservados, não executados.**

## H. Próxima autorização necessária

**P04-REL-01B — Preflight observacional no servidor (somente leitura).** Duas formas, à sua escolha:

1. **Você mesmo roda** `P04-REL-01-preflight-somente-leitura.sh` no servidor (`bash … > preflight.txt 2>&1`), confere que não há segredo e me envia. **Não exige nenhuma autorização técnica da Executora.**
2. **Você autoriza a Executora** a ler o servidor por um canal somente leitura que você fornecer.

Em ambos os casos, **sem** o bloco de catálogo do banco, a menos que você o autorize expressamente. Com a saída, a Executora reclassifica os 12 gates, fecha os documentos na versão 1.1.0 e entrega o parecer final; **só então** faz sentido a ordem `P04-REL-02 — Controlled Staging Deployment & Operational Acceptance`.

## Gates

| Gate | Resultado | Base |
|---|---|---|
| REL-01 Domínio e destino confirmados | **NOT_VERIFIED** | proxy da sessão recusou o domínio (403); domínio ausente do repositório |
| REL-02 Isolamento comprovado | **NOT_VERIFIED** | só uma stack no repositório; sem observação do servidor |
| REL-03 Commit exato identificado | **NOT_VERIFIED** (release: identificado; implantado: não) | `GIT_COMMIT` nunca definido; endpoint devolve `null` |
| REL-04 Compatibilidade API/web | **PASS** | mesmo SHA; endpoints aditivos; E2E real da dupla (CI #77); ordem API→web |
| REL-05 Migrations | **PASS** (nenhuma necessária para o delta) | `git diff -- prisma/` sem migration; estado do banco do servidor segue NOT_VERIFIED |
| REL-06 Impacto em serviços compartilhados | **NOT_VERIFIED** | máquina compartilhada (histórico); build no servidor; sem medição |
| REL-07 Capacidade | **BLOCKED** | não medida |
| REL-08 Backup e restauração | **BLOCKED** | sem evidência atual |
| REL-09 Rollback preparado | **BLOCKED** | plano pronto; depende do snapshot de imagens (execução) |
| REL-10 Pendências DB-42501 / SEC-DATA-01 | **BLOCKED** | preservadas nesta rodada, mas recriar `api` perderia log; aguarda decisão |
| REL-11 Smoke tests definidos | **PASS** | `P04-REL-01-SMOKE-TEST-PLAN.md` |
| REL-12 Sem risco não autorizado a outras aplicações | **NOT_VERIFIED** | depende de REL-02/06/07 |

## Veredito

```text
PROJECT                         = PROSPECTAI
MODULE                          = INTELLIGENCE_EXPLORER
MODULE_VERSION                  = 0.1.0

P04_IMPLEMENTATION              = COMPLETE
P04_AUTOMATED_HOMOLOGATION      = PASS
P04_DOCUMENTATION               = CLOSED

P04_REL_01_EXECUTION            = PARTIAL
P04_REL_01_RESULT               = INCONCLUSIVE

STAGING_DOMAIN_CONFIRMED        = NOT_VERIFIED
STAGING_ISOLATION               = NOT_VERIFIED
DEPLOYED_COMMIT_IDENTIFIED      = NO
RELEASE_COMMIT                  = cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79

DATABASE_SHARED                 = NOT_VERIFIED
MIGRATIONS_REQUIRED             = NO   (para o delta do Explorer; estado do banco do servidor NOT_VERIFIED)
BACKUP_GATE                     = BLOCKED
ROLLBACK_GATE                   = BLOCKED

CAPACITY_GATE                   = BLOCKED
OTHER_STACK_IMPACT              = NOT_VERIFIED
DB_42501_PRESERVATION           = BLOCKED

PRODUCTION_RELEASE              = NOT_AUTHORIZED
MERGE_EXECUTED                  = NO
DEPLOY_EXECUTED                 = NO
DATABASE_MUTATIONS              = 0
SERVICE_RESTARTS                = 0
OTHER_STACKS_MODIFIED           = 0

NEXT_STEP                       = AWAIT_OWNER_APPROVAL   (a aprovação pedida é a do preflight somente leitura, §H)
```

`P04_REL_01_EXECUTION = PARTIAL` porque a fase REL-A (inspeção do servidor) **não pôde ser executada** por falta de canal; REL-B a REL-G foram produzidas apenas como documentação, como a ordem pede.
