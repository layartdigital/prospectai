# P04-REL-01 — C. Plano de rollback

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (DevOps/SRE; Database e AppSec como apoio) · **Versão:** 1.1.0 · **Data:** 02/11/2026
**Relação com a homologação:** acompanha `P04-REL-01-DEPLOYMENT-PLAN.md`. **Comandos preparados, nenhum executado.** `F:\drmind` (Bellvia) não foi modificado.

## 1. Princípio

O release **não altera banco, variáveis nem infraestrutura** e o Explorer **só lê** (2 endpoints GET). Portanto, voltar é **trocar duas imagens e a árvore de código**; não há dado novo a desfazer nem dado a destruir. Isso só vale **se** o plano de publicação for seguido sem os passos opcionais; qualquer desvio (por exemplo D8, que edita `.env.production`) acrescenta um item de rollback, listado na §6.

**Pré-requisito de existência do rollback:** o snapshot de imagens do passo D1.2 (`docker tag <ID da imagem em execução> …:pre-p04-<STAMP>`). **Correção 1.1.0 (E08 §8):** o snapshot é feito pelo **ID da imagem do container** (`docker inspect -f '{{.Image}}' …`), porque a `api` em execução é a `pre-dbrem06`, **não** a `:latest`; etiquetar `:latest` voltaria a uma versão que não estava no ar. **Sem ele não há caminho de volta por tag**; por isso `ROLLBACK_GATE = BLOCKED` até D1.2 existir (não é verificável antes de executar a fase D).

## 2. Gatilhos (objetivos)

| # | Gatilho | Quando | Ação |
|---|---|---|---|
| G1 | `/api/v1/health` com `status` diferente do estado anterior (guardado em D0) por **> 90 s** após recriar a API | D5 | rollback da API |
| G2 | `GET /api/v1/intelligence/graph` sem sessão responde **404** (módulo não carregou) ou **5xx** | D5 | rollback da API |
| G3 | Usuário do banco da API **diferente de `propectai_app`** ou variável de banco ausente / `CredencialDeBancoAusente` no log | D5 | rollback da API **e parar** (investigar antes de nova tentativa; não corrigir com superusuário) |
| G4 | `RestartCount` > 0 em `api` ou `web` nos primeiros 5 min | D5–D6 | rollback do serviço |
| G5 | `/login` ≠ 200 ou página de erro de renderização | D6 | rollback da web |
| G6 | Qualquer **vazamento entre workspaces** no smoke (dado do tenant A visível ao B) | REL-E/F | rollback **imediato** de web e API + registro de incidente (AppSec) |
| G7 | Regressão de módulo anterior (login, dashboard, leads, pipeline, pesquisa, planos) no smoke | REL-E/F | rollback |
| G8 | Serviço **não tocado** com `StartedAt` diferente do registrado (algo reiniciou o que não devia) | D7 | parar; investigar; rollback se houver impacto |
| G9 | Decisão do proprietário na aceitação (REL-F) | REL-F | rollback |

## 3. Ordem de execução do rollback

**Ordem inversa da publicação: `web` primeiro, depois `api`, depois a árvore.** Motivo: a web nova depende dos endpoints novos; a API nova não é exigida pela web antiga. Voltar a web antes evita uma web nova chamando uma API já revertida.

Responsáveis: **operador** (executa; proprietário ou Executora, conforme autorização) e **proprietário** (autoriza e valida). Aceite do rollback: critérios da §5.

```bash
cd /opt/apps/prospectai
C="docker compose --env-file .env.production -f compose.prod.yml"
STAMP=<o mesmo STAMP usado na publicação>          # ver /opt/backups/p04-rel/
REG=/opt/backups/p04-rel
```

### 3.1 Rollback da web (frontend)

```bash
docker tag prospectai-prod-web:pre-p04-$STAMP prospectai-prod-web:latest   # a imagem anterior (a que estava NO AR) volta a ser a "latest"
$C up -d --no-build --no-deps --force-recreate web
curl -s -o /dev/null -w '/login -> %{http_code}\n' http://127.0.0.1:3102/login   # esperado 200
```
Roteamento: o gateway **não muda** (resolve `web` a cada 10 s); não há configuração de roteamento a desfazer.

### 3.2 Rollback da API
Compatibilidade de contrato: a API anterior **não conhece** `/intelligence/*`; a web anterior também não — voltando a web **antes**, nenhuma tela chama endpoint inexistente.

```bash
docker tag prospectai-prod-api:pre-p04-$STAMP prospectai-prod-api:latest   # = a imagem `pre-dbrem06` se ela era a em execução (conferir com imagens-anteriores-$STAMP.txt)
$C up -d --no-build --no-deps --force-recreate api
curl -s http://127.0.0.1:3102/api/v1/health                                   # esperado o estado anterior (D0)
$C exec -T api printenv DATABASE_URL_APP | sed -E 's#:[0-9a-f]{48}@#:***@#'   # propectai_app
```
O IP fixo `172.30.250.3` é preservado (mesma definição de rede).

### 3.3 Rollback da árvore de código

```bash
git checkout --detach "$(head -1 $REG/sha-anterior-$STAMP.txt | awk '{print $1}')"
git rev-parse HEAD                                                            # confere com o SHA anterior
git switch main                                                               # o SHA anterior era o da `main` (2c4b1b2): volta ao ramo, sem alterar arquivos
```
Alternativa registrada no runbook de 21/09 (se a árvore anterior foi salva): restaurar o `tar` de `/opt/backups/prospectai-arvore-*.tgz`, que exclui `node_modules` e o clone do scraper.

### 3.4 Rollback de configurações
Só existe se algum passo opcional alterou arquivo de ambiente (D8: `GIT_COMMIT`/`BUILT_AT` em `.env.production`). Restaurar a cópia feita antes da edição (`cp -p .env.production /opt/backups/env.production-<data>.bak`, como no runbook) **sem exibir valores** — `ls -l` para conferir permissão `600 root:root`, e `grep -oE '^[A-Z_]+='` para conferir nomes. Em seguida recriar a API (`--no-build --no-deps --force-recreate api`). **Sem D8, não há configuração a reverter.**

### 3.5 Rollback do banco
**Não há.** O release não executa migration, não grava dado e não altera papéis, RLS, ACL ou *default privileges*. O dump de D1.3 existe como **rede de segurança geral**, **não** como parte do rollback. **Não restaurar o dump por causa deste release**: restaurar apagaria dados criados depois do dump.

### 3.6 Rollback de containers, volumes e redes
Só `api` e `web` mudam. **Preservar**: volumes `prospectai_postgres_data`, `prospectai_redis_data`, `/opt/data/prospectai/gmapsdata`, redes `internal` e `proxy_api`, imagens `:pre-p04-<STAMP>` (**não remover** até o encerramento REL-G e a decisão do proprietário). Nenhum `down`, nenhum `prune`.

## 4. Consequências para usuários (indicar, não esconder)

- **A homologação compartilha a stack da operação** (Cenário C, **observado**), então o rollback tem o mesmo efeito que a publicação: **segundos de indisponibilidade** de web e API, com falha pontual nas requisições em curso. As **sessões continuam válidas** (o segredo de acesso não muda). O Explorer deixa de existir na interface; nenhum dado de lead é perdido.
- **Dados "novos"**: o Explorer não cria dados. Qualquer dado criado por usuários **durante** a janela (leads, notas, pipeline) permanece, porque o banco não é revertido.
- O rollback **não é destrutivo**: nada é apagado, só substituídas as imagens em uso.

## 5. Verificações pós-rollback (todas obrigatórias)

1. `/api/v1/health` igual ao estado de D0; `/login` = 200; `/api/v1/intelligence/graph` sem sessão = **404** (voltou ao estado anterior) — esperado após o rollback da API.
2. Login com conta de homologação, dashboard, lista de leads e ficha do lead abrem (sem modal de bloqueio).
3. Usuário do banco da API = `propectai_app`.
4. `StartedAt` de `worker`, `gateway`, `postgres`, `redis` e `gmaps-scraper` = o de `startedat-antes-<STAMP>.txt`.
5. Registro: motivo, gatilho, horário, SHA anterior restabelecido, saídas das verificações, no arquivo de release.

## 6. Itens opcionais que ampliam o rollback

| Passo opcional | O que acrescenta ao rollback |
|---|---|
| D8 (`GIT_COMMIT`/`BUILT_AT`) | §3.4 |
| Exportação de logs (D1.4) | nada a reverter (só arquivos em `/opt/backups`); manter como evidência |
| Teste de restauração em container descartável | remover o container `propectai-restoretest*` |

## 6.1 Dois pontos próprios deste servidor

1. **Logs não voltam.** Recriar `api` ou `web` (na publicação **ou** no rollback) descarta o log do container recriado (E08: `json-file` sem rotação). Por isso a exportação de logs (D1.4) tem de ocorrer **antes de qualquer recriação**, inclusive antes de um rollback que ainda não foi precedido por ela.
2. **`pre-dbrem06` é uma etiqueta existente e deve ser preservada.** O snapshot `pre-p04-<STAMP>` aponta para o mesmo ID; **não remover nenhuma das duas** (sem `docker rmi`, sem `prune`).

## 7. Testar o rollback antes de precisar dele

Antes da janela, no passo D1.2, conferir que a etiqueta existe: `docker image inspect -f '{{.Id}}' prospectai-prod-api:pre-p04-<STAMP> prospectai-prod-web:pre-p04-<STAMP>` retorna dois IDs **iguais** aos registrados em `imagens-anteriores-<STAMP>.txt` **e** aos de `docker inspect -f '{{.Image}}'` dos containers em execução. É a única verificação do rollback que não custa uma interrupção.
