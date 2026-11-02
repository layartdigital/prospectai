# P04-REL-01C — Procedimentos preparados (NÃO EXECUTADOS)

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (DevOps/SRE, Database Engineering, AppSec) · **Versão:** 1.1.0 · **Data:** 02/11/2026
**Relação:** anexo do `P04-REL-01C-RELATORIO.md`; complementa `P04-REL-01-DEPLOYMENT-PLAN.md` e `P04-REL-01-ROLLBACK-PLAN.md` (v1.1.0). Referência: PR #7 (rascunho), commit `0ed11b99708d03e6a5153538cabe73158a5d48a1`.
**`F:\drmind` (Bellvia) não foi modificado.**
**Versão 1.1.0:** ajustado com a evidência E09 (REL-01C v1.1.0): logs de ~92 KB, banco pequeno (dumps de ~223 KB), dois dumps de 30/10 como candidatos, imagem `408bd870` nunca implantada, reinício do servidor de 30/10 (errata). **Continua sem execução.**

> **Este documento só descreve. Nada aqui foi executado e nada aqui está autorizado.** A decisão do proprietário de 02/11/2026 mandou *preparar* backup, restauração de teste, preservação de logs e rollback, e **proibiu** executá-los nesta rodada (sem backup novo, sem restauração de teste, sem reinício, sem alteração de imagens, sem merge). Cada procedimento abaixo tem uma **pré-condição de autorização** própria. Todos usam o prefixo de projeto, nomes exatos de container e **nenhum** `prune`, `down`, `--remove-orphans`, `docker compose config`, nem comando sem nome de serviço.

## 0. Convenções comuns

```bash
# Só para quando houver autorização. Variáveis usadas nos procedimentos:
STAMP=$(date -u +%Y%m%dT%H%MZ)
REG=/opt/backups/p04-rel                 # pasta de custódia: criada por este procedimento; root:root 700
P=prospectai-prod                        # projeto Compose
umask 077                                # tudo que for criado fica só do root
```

- **Escreve só em `$REG`** (pasta nova). Não escreve na árvore do projeto, em `.env*`, em volumes, no banco, no nginx nem em outras aplicações.
- **Raciocínio de ordem:** P1 (logs) → P2 (backup) → P3 (restauração de teste) → P4 (snapshot/rollback). **P1 vem primeiro porque recriar um container descarta o log dele**; nada recria container antes de P1 estar concluído e verificado.
- **Sem segredo em saída:** usuário e banco do PostgreSQL vêm do ambiente do próprio container (`sh -c '… "$POSTGRES_USER" …'`), nunca digitados nem impressos.

## P1. Preservação dos logs do GATE-DB-42501 (plano)

**Pré-condição de autorização:** escrever arquivos em `$REG` (pasta nova) no servidor e copiar os logs de `postgres`, `api`, `worker` e `web`. **Não** altera a configuração de log do Docker nem recria containers.
**Estado do T1 de 01/11/2026:** `NOT_VERIFIED`. O plano **não presume** que foi coletado: preserva o que existe e deixa a conclusão ao proprietário.

**Por que cópia do arquivo bruto e não `docker logs`:** o arquivo `json-file` guarda cada linha com o carimbo de hora original (campo `time`) e o fluxo (`stdout`/`stderr`). `docker logs` reconstrói o texto e perde esse formato. A cópia bruta é a evidência primária; uma exportação legível por `docker logs --timestamps` pode ser feita **além** dela, nunca no lugar.

```bash
mkdir -p "$REG/logs-$STAMP" && chmod 700 "$REG" "$REG/logs-$STAMP"
MAN="$REG/logs-$STAMP/MANIFEST.tsv"
printf 'coletado_em_utc\tcontainer\tcriado\tiniciado\timagem_id\tlog_origem\ttamanho_bytes\tmtime_utc\tsha256_origem_prefixo\tsha256_copia\tarquivo_copia\n' > "$MAN"

for s in postgres api worker web; do
  c="$P-$s-1"
  lp=$(docker inspect -f '{{.LogPath}}' "$c")                           # caminho do log bruto
  meta=$(docker inspect -f '{{.Created}}\t{{.State.StartedAt}}\t{{.Image}}' "$c")
  size=$(stat -c %s "$lp")                                              # tamanho congelado AGORA
  mt=$(stat -c %y "$lp")
  dest="$REG/logs-$STAMP/$s.json.log"
  head -c "$size" "$lp" > "$dest"                                       # prefixo consistente (o worker ainda escreve)
  chmod 400 "$dest"
  ho=$(head -c "$size" "$lp" | sha256sum | cut -d' ' -f1)              # hash do prefixo da ORIGEM
  hc=$(sha256sum "$dest" | cut -d' ' -f1)                               # hash da CÓPIA
  [ "$ho" = "$hc" ] || { echo "DIVERGE: $s — parar"; break; }
  printf '%s\t%s\t%b\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$c" "$meta" "$lp" "$size" "$mt" "$ho" "$hc" "$dest" >> "$MAN"
done
sha256sum "$REG/logs-$STAMP"/*.json.log "$MAN" > "$REG/logs-$STAMP/SHA256SUMS" && chmod 400 "$REG/logs-$STAMP/SHA256SUMS"
```

**Cadeia de custódia (o que torna isto evidência):**

| Elemento | Como |
|---|---|
| Integridade | SHA-256 da origem (prefixo congelado) **igual** ao da cópia; `SHA256SUMS` cobre cópias e manifesto |
| Carimbos de hora | preservados no arquivo bruto (campo `time`); `stat` da origem registrado no manifesto |
| Permissões | `700` na pasta, `400` nos arquivos, dono `root` |
| Cópia fora do servidor | o proprietário copia a pasta por `scp` para seu computador e **recalcula** o `SHA256SUMS`; o resultado conferido é anexado ao índice de evidências (só os hashes entram no repositório, **nunca** os logs) |
| Quem, quando, como | o manifesto grava coleta UTC; o relatório da rodada de execução registra o operador e a autorização |
| Conteúdo | **nunca** vai para o repositório nem para o chat: pode ter dado pessoal, token ou cookie. Leitura só por quem o proprietário indicar, em ambiente controlado |
| Retenção | até **liberação escrita do proprietário**; sem rotação automática; esta pasta fica **fora** de qualquer limpeza |

**Dimensão (E09):** `postgres` 10.429 B, `api` 72.823 B, `worker` 3.541 B, `web` 5.124 B (~92 KB). Os SHA-256 de referência de 02/11 16:38Z estão em REL-01C §4.C; `postgres`, `api` e `web` **não escrevem desde 30/10**, então a cópia deve reproduzir **exatamente** esses hashes (se não reproduzir, algo escreveu entre as duas leituras: parar e registrar). O reinício do servidor de 30/10 **não** descartou os logs (reiniciar ≠ recriar).

**Limites que o plano declara:** (a) o log de um container só cobre a vida **desta instância** (criada em 30/10/2026); o que a instância anterior escreveu foi descartado na recriação e **não é recuperável** por este procedimento; (b) o `redis`, o `gateway` e o `gmaps-scraper` não são exigidos pela ordem e ficam fora (o `gateway` pode ter acessos relevantes: o proprietário decide); (c) o proprietário deve dizer se o T1 depende de algum log **dentro** do banco (arquivos de log do PostgreSQL), que este plano não cobre.

**Critério de sucesso:** 4 cópias, 4 hashes de origem = hashes de cópia, manifesto completo, `SHA256SUMS` conferido também fora do servidor. **Abort:** qualquer divergência de hash, falta de espaço em `$REG`, ou `$REG` já existente com conteúdo (não sobrescrever).

## P2. Backup atualizado do banco (preparado)

**Pré-condição de autorização:** (i) escrever em `$REG`; (ii) **ler** de `pg_roles` o papel de bootstrap (`rolsuper`/`rolbypassrls`) — a mesma natureza do bloco 13, já excluído desta rodada; (iii) rodar `pg_dump` no container `prospectai-prod-postgres-1`. **Não** altera o banco, não cria objetos, não reinicia nada.

**Por que importa quem faz o dump:** o banco usa RLS **forçada**. Um papel sem `BYPASSRLS` produziria um dump **vazio ou com erro** nas tabelas protegidas, e isso pareceria um backup válido. Por isso o procedimento verifica o papel antes e **para** se ele não puder ler tudo; **não** troca de papel nem recorre a outro superusuário.

```bash
# P2.0 — pré-checagem do papel (somente leitura; sessão forçada a somente leitura)
#   (o histórico do shell do proprietário mostra o administrador do banco como `propectai`; o procedimento lê $POSTGRES_USER do container em vez de supor)
docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$P-postgres-1" \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
select rolsuper::text || ' ' || rolbypassrls::text from pg_roles where rolname = current_user;
SQL
#   esperado: "t t" ou "t f" (superusuário ignora RLS) -> prosseguir; "f f" -> PARAR e voltar ao proprietário.

# P2.1 — espaço
df -h /opt/backups | tail -1       # exige folga >= 3x o tamanho do banco (consultar pg_database_size na autorização)

# P2.2 — dump em formato custom (inclui donos e ACL), por stream até arquivo no host
mkdir -p "$REG/db-$STAMP" && chmod 700 "$REG/db-$STAMP"
docker exec "$P-postgres-1" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc --no-comments "$POSTGRES_DB"' > "$REG/db-$STAMP/propectai.dump"
[ $? -eq 0 ] || { echo "pg_dump falhou"; exit 1; }
# P2.3 — papéis (atributos; SEM hashes de senha)
docker exec "$P-postgres-1" sh -c 'pg_dumpall -U "$POSTGRES_USER" --globals-only --no-role-passwords' > "$REG/db-$STAMP/globals.sql"

# P2.4 — verificação sem restaurar: a lista de conteúdo (TOC) tem de abrir
docker exec -i "$P-postgres-1" pg_restore --list < "$REG/db-$STAMP/propectai.dump" > "$REG/db-$STAMP/toc.txt" && wc -l "$REG/db-$STAMP/toc.txt"
# P2.5 — linha de base de contagens (somente leitura) para comparar com a restauração
docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$P-postgres-1" \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' > "$REG/db-$STAMP/contagens-base.txt" <<'SQL'
select 'migrations_aplicadas=' || count(*) from _prisma_migrations where finished_at is not null;
select relname || '=' || reltuples::bigint from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace order by 1;
SQL
sha256sum "$REG/db-$STAMP"/* > "$REG/db-$STAMP/SHA256SUMS"; chmod 400 "$REG/db-$STAMP"/*
```

`reltuples` é estimativa; a comparação rigorosa de contagens usa `count(*)` nas tabelas centrais (leads, pesquisas, notas, `_prisma_migrations`) — listadas na autorização, não aqui. O dump contém **dados** (do próprio proprietário, em ambiente de teste): `chmod 400`, só em `$REG`, **fora do repositório**.

**Arquivos de configuração (opcional, decisão do proprietário):** cópia com `cp -p` de `compose.prod.yml` e `infra/nginx/default.conf` para `$REG/config-$STAMP/`. **Os `.env*` não são copiados** salvo decisão expressa (são segredos); basta o manifesto de nomes de chave já obtido no preflight.

**Critério de sucesso:** `pg_dump` com saída 0; `pg_restore --list` abre e lista a tabela `_prisma_migrations` e as tabelas do Explorer; hashes gravados. **Abort:** papel sem leitura total; dump com erro; espaço insuficiente.

## P3. Restauração de teste (preparada; **proibida nesta rodada**)

**Pré-condição de autorização:** criar **um container descartável** (`docker run`) e remover **esse** container ao final. O banco real **não** é contactado.

**P3a — restaurar primeiro o dump que já existe (recomendado como 1º passo).** Os candidatos da classe A do REL-01C (§4.B) são `/opt/backups/prospectai-dbrem06-20261030-1523/propectai.dump` (30/10 15:23, o mais recente) e o de `dbrem04` (12:30). **Não exige dump novo e não toca o original**: copia-se o arquivo para dentro do container descartável. Usar `DUMP=<caminho>` no lugar de `$REG/db-$STAMP/propectai.dump` nos comandos abaixo; o `globals.sql` não existe para esses dumps, então os papéis `propectai_app`, `propectai_sistema`, `propectai_migrator` e `propectai_dono` precisam ser criados **no container descartável** (sem senha) antes do `pg_restore`, ou o restore usa `--no-owner --no-privileges` e a validação 5 fica `NOT_VERIFIED`. As validações 1–4 valem igual (a referência de contagens é a do banco real **no mesmo instante** do teste, ou `contagens-base` quando houver dump novo).

**Isolamento do teste:** sem rede (`--network none`), sem volume (dados em `tmpfs`), imagem **idêntica** à do banco real (mesmo ID), senha aleatória gerada na hora, nome com prefixo do projeto e sufixo único. Não toca nenhuma rede ou volume existente, e **o dump nunca entra no container pela rede**: usa-se `docker cp`.

```bash
T="propectai-restoretest-$STAMP"
IMG=$(docker inspect -f '{{.Image}}' "$P-postgres-1")                       # mesma imagem do banco real
PW=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' )                       # nunca impressa nem gravada
docker run -d --name "$T" --network none --tmpfs /var/lib/postgresql/data:rw,size=1g \
  -e POSTGRES_PASSWORD="$PW" "$IMG" >/dev/null
until docker exec "$T" pg_isready -U postgres -q; do sleep 1; done
docker cp "$REG/db-$STAMP/globals.sql"  "$T":/tmp/globals.sql
docker cp "$REG/db-$STAMP/propectai.dump" "$T":/tmp/propectai.dump
docker exec "$T" psql -U postgres -v ON_ERROR_STOP=0 -q -f /tmp/globals.sql >/dev/null 2>&1   # papéis sem senha; erros de "já existe" são esperados
docker exec "$T" pg_restore -U postgres --create -d postgres --exit-on-error /tmp/propectai.dump
```

**Validação (todas obrigatórias):**
1. `pg_restore` termina sem erro.
2. `select count(*) from _prisma_migrations where finished_at is not null` **igual** ao de `contagens-base.txt`.
3. Contagens de `leads`, pesquisas, notas e atividades **iguais** ao do banco real no mesmo instante do dump.
4. RLS **forçada** presente nas tabelas multi-tenant (`relrowsecurity` e `relforcerowsecurity` verdadeiros) — o restore tem de preservar a postura de segurança, não só os dados.
5. O papel `propectai_app` existe **sem** `BYPASSRLS` e sem superusuário.

**Limpeza (só este container, por nome exato):**
```bash
case "$T" in propectai-restoretest-*) docker rm -f "$T" ;; *) echo "nome inesperado: não removo"; exit 1;; esac
```
Nenhum `prune`. O resultado (tabela de contagens + hash do dump + horário) vai ao relatório da rodada; **sem** dado de lead.

**Critério de sucesso:** as 5 validações. Só então `BACKUP_GATE = PASS`. **Abort:** qualquer divergência — o backup é considerado **não restaurável** até nova análise.

## P4. Rollback atualizado (preparado)

Base: `P04-REL-01-ROLLBACK-PLAN.md` v1.1.0 (retag da imagem **em execução**, recriar `web` e depois `api`, sem rollback de banco). Acréscimos desta rodada:

1. **Duas etiquetas, mesmo ID (confirmado pelo E09).** A etiqueta já existente `pre-dbrem06` **é** a imagem em execução da `api` (`64b25a48…`); o snapshot `pre-p04-<STAMP>` apontará para o mesmo ID. **Nenhuma das duas é removida** (sem `docker rmi`, sem `prune`). Para a **web** não existe etiqueta da imagem em execução (`dd9dd874…`, 07/10): o `pre-p04-<STAMP>` é o **único** caminho de volta dela.
2. **`:latest` não é referência de nada.** O E09 **confirmou** que a `:latest` da API (`408bd870…`, construída em 30/10 15:24) é uma construção **posterior e nunca implantada**. O `build` do release a sobrescreve e a `408bd870` **perderia a etiqueta**. É aceitável **apenas** porque o snapshot por ID da imagem **em execução** existe antes (plano D1.2); se o proprietário quiser **conservar** a `408bd870`, basta uma etiqueta extra **antes do build** (`docker tag 408bd870aa0a prospectai-prod-api:p04-nao-implantada-<STAMP>`; só autorizada na ordem de publicação). O rollback **nunca** volta para `:latest`.
3. **Ordem de pré-requisitos do rollback existir:** P1 (logs) concluído → P2/P3 (backup restaurável) concluídos → D1.2 (snapshot por ID, verificado com `docker image inspect -f '{{.Id}}'` igual ao ID do container) → só então D4+.
4. **Gatilhos e verificações:** G1–G9 do plano de rollback, inalterados; a verificação de `/api/v1/intelligence/graph` sem sessão passa a ser **404 → 401 na publicação** e **401 → 404 no rollback** (e o *build ID* do Next volta ao valor registrado em D0).
5. **O que o rollback não restaura:** logs descartados na recriação (daí P1 antes), e dados criados durante a janela (o banco não é revertido).
6. **Teste do rollback sem interrupção:** só a existência e o ID das etiquetas (plano de rollback, §7). Ensaiar o rollback de verdade exigiria recriar containers e **não está autorizado**.

## P5. Sequência exata para liberar a publicação controlada

Cada degrau exige **autorização expressa própria** do proprietário; nenhum é automático e nenhum pressupõe o anterior além do que está escrito.

| Degrau | Ordem sugerida | O que autoriza | Toca serviço? | Saída |
|---|---|---|---|---|
| 0 | **P04-REL-01C** (esta rodada) | leituras somente leitura (roteiro 01C) | não | evidência A–E |
| 1 | Decisões do proprietário | T1 (que logs, e se já foi coletado); causa do reinício de 30/10; cadastro público aberto (manter? há contas de terceiros?); dump por papel com leitura total; etiquetar ou não a `408bd870`; janela; quem opera | não | registro escrito |
| 2 | **P04-REL-02A — Preservação e backup** | P1 (logs) → **P3a** (restaurar o dump existente `dbrem06`) → P2 (dump novo) → P3 (restaurar o dump novo), escrevendo **só** em `/opt/backups/p04-rel` e criando **um** container descartável por vez | **não** (nenhum serviço do projeto) | REL-08 `PASS`, REL-10 resolvido, cadeia de custódia dos logs |
| 3 | **P04-REL-02B — Publicação controlada** | `git fetch`/`bundle` para a árvore do servidor, `checkout --detach` do SHA, `build` de `api` e `web`, snapshot por ID, `up -d --no-deps` de **api** e depois **web**, prova de `StartedAt` dos não tocados | **sim** (`api` e `web`) | gates REL-03/09 `PASS`; smoke S0 |
| 4 | **P04-REL-02C — Smoke e aceitação** | S1–S4; segunda conta/workspace de teste; aceitação ou rollback | não (leitura) / grava só se autorizado | parecer de homologação |
| 5 | Decisão do merge do PR #7 | tirar o rascunho e mesclar | — | só **depois** da aceitação |

**Gates que precisam estar `PASS` antes do degrau 3:** REL-01, REL-03 (imagens identificadas), REL-04, REL-05, REL-06 (porta 3101 identificada), REL-07, REL-08 (restaurável), REL-09 (snapshot por ID), REL-10 (logs preservados e decisão do T1 registrada), REL-11, REL-12. **REL-02** fica registrado como *aceito para a Estratégia D por declaração do proprietário* (ver relatório §2), não como `PASS`.

**Texto sugerido para a autorização do degrau 2** (o proprietário ajusta): *"Autorizo a ordem P04-REL-02A: criar `/opt/backups/p04-rel`, copiar os logs de postgres, api, worker e web com hash, gerar dump do banco por papel com leitura total, restaurá-lo em container descartável sem rede e remover esse container. Não autorizo reiniciar, recriar ou alterar nenhum serviço, imagem, volume, configuração ou banco."*
