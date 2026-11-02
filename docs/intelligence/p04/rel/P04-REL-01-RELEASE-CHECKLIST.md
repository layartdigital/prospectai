# P04-REL-01 — F. Checklist de release

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (DevOps/SRE e Documentação) · **Versão:** 1.0.0 · **Data:** 02/11/2026
**Relação com a homologação:** lista de verificação do release do commit `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79`. **Todas as caixas estão desmarcadas: nada foi executado.** `F:\drmind` (Bellvia) não foi modificado.

## 1. Administrativo

- [ ] Relatório de prontidão `P04-REL-01` lido pelo proprietário.
- [ ] Proprietário declarou por escrito a **natureza da stack** de homologação (teste sem cliente / operacional).
- [ ] Autorização expressa da ordem `P04-REL-02 — Controlled Staging Deployment & Operational Acceptance`.
- [ ] Janela de publicação definida (baixo uso do servidor) e comunicada a quem usa a stack.
- [ ] Decisão sobre **logs do GATE-DB-42501**: quais preservar; estado do T1 (planejado para 01/11/2026).
- [ ] Decisão sobre a opção D8 (SHA no endpoint) — sim/não.
- [ ] Decisão sobre **criar uma conta/workspace de teste** para o smoke S2 (ou indicar conta existente).
- [ ] **PR #7 continua em rascunho; nenhum merge antes da aceitação (REL-F).**
- [ ] `PRODUCTION_RELEASE` continua `NOT_AUTHORIZED`: esta publicação é **homologação**, não release de produção.

## 2. Preflight (REL-A) — somente leitura

- [ ] Roteiro `P04-REL-01-preflight-somente-leitura.sh` executado; saída conferida (sem segredo) e anexada ao índice de evidências.
- [ ] REL-01: domínio resolve, certificado válido, vhost correto, `/`, `/api`, `/login`, `/api/v1/health`, `/api/v1/system/version` responderam como esperado.
- [ ] REL-02/06: topologia classificada em A/B/C/D com evidência; serviços e redes compartilhados mapeados.
- [ ] REL-03: SHA implantado lido no servidor (`git rev-parse HEAD`) e comparado com `main` (`2c4b1b2`) e com `cebbfa6`.
- [ ] Árvore do servidor **limpa** (sem alteração rastreada inexplicada).
- [ ] `.env.production`, `.env.banco`, `.env.dono` presentes, `600 root:root`; nomes de chave conferidos; `APP_VERSION` **sem duplicata**.
- [ ] REL-07: CPU, memória, espaço livre em `/` e `/var/lib/docker`, e em `/opt/backups` suficientes para o build; limites de recurso conhecidos.
- [ ] REL-08: backup recente (data, tamanho, `gzip -t` ok) **e** teste de restauração em container descartável.
- [ ] Estado dos 7 serviços e saúde guardado (`$C ps`).
- [ ] Rotação de log dos containers conhecida (risco de perda de evidência).
- [ ] (Se autorizado) bloco 13: papéis do banco e migrations aplicadas lidos em modo somente leitura.

## 3. Técnico — antes de publicar

- [ ] Commit confirmado: `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79`; CI #77 e #78 verdes (conferir na página do PR).
- [ ] Confirmado: **0 migrations**, **0 variáveis novas**, compose/Dockerfiles/nginx iguais aos da `main`.
- [ ] REL-04: API e web saem **do mesmo SHA**.
- [ ] `infra/scripts/checar-segredos-compose.sh` passa.
- [ ] Snapshot de imagens **etiquetado e verificado** (`:pre-p04-<STAMP>`).
- [ ] `startedat-antes-<STAMP>.txt` gravado.
- [ ] Comandos do plano revisados: **sem** `down`, `prune`, `--remove-orphans`, `config`, `up` sem nome de serviço.

## 4. Durante a publicação (REL-D)

- [ ] D1 salvaguardas (SHA anterior, imagens, dump + hash, logs se decidido).
- [ ] D2 checkout `--detach` do SHA; `git diff` de config/infra/migrations **vazio** (senão abort).
- [ ] D4 build de `api` e `web` (não do worker) concluído; IDs das imagens novas ≠ anteriores.
- [ ] D5 API recriada: saúde, 401 no endpoint do Explorer, usuário `propectai_app`, 0 reinícios, log limpo.
- [ ] D6 web recriada: `/login` 200, `/intelligence` redireciona, 0 reinícios.
- [ ] D7 `StartedAt` dos serviços não tocados **idêntico**.

## 5. Depois (REL-E/F/G)

- [ ] Smoke S0–S4 concluído com resultado registrado (capturas sem credenciais).
- [ ] Isolamento S2 **sem nenhuma falha**.
- [ ] Aceitação do proprietário registrada (ou rollback acionado, com gatilho).
- [ ] Registro de release preenchido (SHA, data/hora UTC, ambiente, versões, CI, smoke, rollback se houver).
- [ ] Índice de evidências atualizado, **incluindo** o artefato do CI #77: ID `13143194553`, expiração `2026-12-02T13:15:34Z`, SHA-256 `7dc407ef63f8c7cf940228ebce435c326ac6bd26f4e18035bae792742fbccac6` (informados pelo proprietário).
- [ ] Changelog atualizado (commit só documental).
- [ ] Imagens `:pre-p04-<STAMP>` mantidas até a decisão do proprietário.
- [ ] Decisão do merge do PR #7 (somente depois da aceitação).

## 6. Pendências preservadas (não executadas por este release)

- [ ] `SEC-DATA-01 = OPEN / NOT_EXECUTED`
- [ ] `GATE-DB-42501 = OPEN`
- [ ] `SEC-DB-02 = NOT_STARTED`
- [ ] Company 360, Flowsint e novas capacidades de IA: **não iniciados**.
