# P04-REL-01 — H. Índice de evidências

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (Documentação) · **Versão:** 1.0.0 · **Data:** 02/11/2026
**Relação com a homologação:** registra de onde veio cada afirmação dos documentos P04-REL-01. Tudo abaixo é **sanitizado**: nenhuma credencial, cookie, token ou valor de variável. `F:\drmind` (Bellvia) não foi modificado.

## 1. Comandos executados nesta rodada (todos somente leitura)

| ID | Onde | Comando (resumo) | Resultado sanitizado |
|---|---|---|---|
| E01 | sessão da Executora | `curl` HTTPS (GET) para `/`, `/login`, `/api/v1/health`, `/api/v1/system/version` do domínio de homologação | `CONNECT tunnel failed, response 403` nas 4 chamadas; o status do proxy registrou `connect_rejected` para `prospectai-stage.layart.com.br:443`. **Nenhuma resposta do domínio.** |
| E02 | sessão da Executora | `getent hosts <domínio>` | sem saída (inconclusivo: rede intermediada pelo proxy) |
| E03 | sessão da Executora | `openssl s_client` no domínio | certificado não obtido (mesmo bloqueio) |
| E04 | sessão da Executora | consulta ao status do proxy da sessão | proxy ativo; falhas `connect_rejected` registradas para o domínio |
| E05 | computador do proprietário | `get_device_info` | dispositivo respondeu; pasta conectada: `C:\ResgateProjetos\prospectai` |
| E06 | computador do proprietário | `device_bash` (DNS/HTTP/SSH) | **falhou ao iniciar a VM:** "too little free disk space … needs up to 17 GB" |
| E07 | sessão da Executora | execução de teste do roteiro `P04-REL-01-preflight-somente-leitura.sh` **no container da própria sessão** | **Não é evidência do servidor.** Provou só: sintaxe válida (`bash -n`), não grava em disco e **degrada sem falhar** quando não há Docker nem as pastas do projeto |

## 2. Evidências do repositório (commit `cebbfa6`)

| ID | Comando / arquivo | O que prova |
|---|---|---|
| R01 | `git rev-parse HEAD` → `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79` | o commit de release está na cópia de trabalho da Executora; o push foi feito pelo proprietário (log informado: `78e9fe2..cebbfa6`). A referência `origin/*` local está desatualizada: não usei o remoto para confirmar |
| R02 | `git rev-list --count origin/main..HEAD` = 7; `HEAD..origin/main` = 0; `git merge-base` = `2c4b1b2…` | a branch contém a `main` (`2c4b1b2`) e está 7 commits à frente, sem divergência |
| R03 | `git diff --stat origin/main..HEAD -- . ':!docs'` | 46 arquivos, +7.464/−9; **nenhum** arquivo em `prisma/migrations/`, `prisma/schema.prisma`, `compose.prod.yml`, `infra/` |
| R04 | `compose.prod.yml` (linhas: `name`, `proxy_api` `172.30.250.0/29`, `ipv4_address` fixos, `ports 127.0.0.1:3102`, volume `/opt/data/prospectai/gmapsdata`, volumes `prospectai_*`) | não suporta segunda stack sem override |
| R05 | `infra/nginx/default.conf` | gateway re-resolve `api`/`web` a cada 10 s; `/api/` restrito por `allow` |
| R06 | `apps/api/src/system/system.controller.ts:71-72` + busca por `GIT_COMMIT`/`BUILT_AT` em todo o repositório | o endpoint de versão lê `GIT_COMMIT`/`BUILT_AT`, **que nenhum arquivo define** → `commit: null` |
| R07 | `apps/api/src/intelligence/intelligence.controller.ts` | só `@Get('graph')` e `@Get('expand')`, com `JwtAuthGuard` + `TenantGuard` |
| R08 | `apps/api/src/intelligence/intelligence.service.ts:110` e `depth-proof.ts` | usa `JWT_ACCESS_SECRET` já existente (`getOrThrow`); nenhuma variável nova |
| R09 | `apps/web/src/lib/nav.ts` | acrescenta o item "Intelligence" ao menu |
| R10 | `.dockerignore` | exclui `.env`, `.env.*` e `.git` das imagens |
| R11 | `.github/workflows/ci.yml` | sem job de deploy; `permissions: contents: read` |
| R12 | `docs/intelligence/ATUALIZAR-AMBIENTE-ONLINE.md` (medições de 17, 21 e 22/09/2026; notas de 30/10) | **histórico** da topologia e do procedimento de deploy; **não é estado atual** |
| R13 | busca textual por `prospectai-stage` no commit | **0 ocorrências**: o domínio de homologação não está documentado no repositório |
| R14 | `docs/intelligence/p04/P04-RELATORIO-FINAL.md` §G e `P04-SEC-DATA-01-HANDOFF.md` | os contêineres de produção "preservam logs do GATE-DB-42501"; T1 de 01/11/2026 não antecipado; SEC-DATA-01 independente |

## 3. Informações fornecidas pelo proprietário (**não verificadas pela Executora**)

| ID | Informação | Observação |
|---|---|---|
| O01 | PR #7: https://github.com/layartdigital/prospectai/pull/7 | rascunho |
| O02 | CI #77: https://github.com/layartdigital/prospectai/actions/runs/41450846331 — PASS; Explorer 27/27; regressão 29/29 | as contagens foram lidas no log pelo texto do passo "Resumo dos testes" (P04-CLOSE-01) |
| O03 | CI #78: https://github.com/layartdigital/prospectai/actions/runs/41465972020 — PASS; 5/5 jobs | informado na ordem; não inspecionado |
| O04 | Artefato `e2e-evidencias` do CI #77: **ID `13143194553`**, **expiração `2026-12-02T13:15:34Z`**, **SHA-256 `7dc407ef63f8c7cf940228ebce435c326ac6bd26f4e18035bae792742fbccac6`** | consistente com `retention-days: 30` do workflow (upload em 02/11/2026). Conteúdo não inspecionado pela Executora. Entra no índice do release, **sem commit só para isso**, como a ordem determina |

## 4. O que **não** tem evidência (e por quê)

| Tema | Estado | Motivo |
|---|---|---|
| Domínio, DNS, certificado, vhost | NOT_VERIFIED | proxy da sessão recusa o domínio |
| Topologia real, banco/containers/volumes compartilhados | NOT_VERIFIED | sem acesso ao servidor |
| Commit implantado | NOT_VERIFIED | sem acesso; endpoint não informa |
| Capacidade (CPU, memória, disco) | NOT_VERIFIED | sem acesso |
| Backup (existência, data, integridade, restauração) | NOT_VERIFIED | sem acesso |
| Estado do banco (migrations aplicadas, papéis) | NOT_VERIFIED | consulta ao catálogo exige autorização |
| Estado do GATE-DB-42501 (T1) | NOT_VERIFIED | não documentado no repositório |

## 5. Como fechar as lacunas

Executar `P04-REL-01-preflight-somente-leitura.sh` no servidor (ou liberar um canal somente leitura) e anexar a saída conferida a este índice como **E08…**. Cada seção da saída corresponde a um gate: seções 1–3 → REL-07; 4–6 → REL-02/06/10; 7–8 → REL-03; 9–11 → REL-01; 12 → REL-08; 13 (opcional) → REL-05/estado do banco.

## 6. Hashes SHA-256 dos arquivos desta rodada

(calculados sobre o conteúdo dos arquivos no commit; este índice não se auto-referencia)

```text
0f76675483f3e00acc74494cb794586e6e29505eb1f124e349792a28469cfbe2  P04-REL-01-INFRASTRUCTURE-PREFLIGHT.md
b62a610c6b92f04f2cb906aec9ddd3790d7ab2a14b8b6be48229be9c67cacf12  P04-REL-01-DEPLOYMENT-PLAN.md
bd2716513c1a058972ff07a08e8d83bda17dc1e75c73a8bf35b400a1cec6b4cf  P04-REL-01-ROLLBACK-PLAN.md
d64af99b37489a32a2bda3b56381f7ee2a7622a8557c3c986856caa0e45930ec  P04-REL-01-RISK-REGISTER.md
8261e6c7e96b9d9c9b5ea2d7b1d0baa83109459be3a3bafbb66ee8bf7214b9f6  P04-REL-01-SMOKE-TEST-PLAN.md
e7d1d05b9abe4ac24f7037a723799f03db3798de72b990c3b8ac4fde3e7a38c3  P04-REL-01-RELEASE-CHECKLIST.md
9e819803afc26f54e5ff75263272a8fcf3856161f6b8a4d160c0f83090e7a718  P04-REL-01-EXECUTIVE-SUMMARY.md
b60e70a955a1a8cedfaa4ab23e57995047d8a0012478919c3eea29e064372020  P04-REL-01-preflight-somente-leitura.sh
```
