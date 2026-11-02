# P04-REL-01C — Verificações complementares e desbloqueio de publicação

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (DevOps/SRE, Database Engineering, AppSec, QA, Documentação) · **Versão:** 1.1.0 · **Data:** 02/11/2026
**Referências:** P04-REL-01 v1.1.0 (errata em §2); PR #7 (rascunho); commit de referência `e0bbe4c` (REL-01C v1.0.0); commit de release `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79`.
**`F:\drmind` (Bellvia) não foi modificado.** Nada foi executado, alterado, reiniciado ou escrito no servidor pela Executora: a coleta foi feita **pelo proprietário**, com o roteiro somente leitura. Sem merge, sem deploy, sem alteração de imagens, sem escrita no banco, sem backup novo, sem restauração.

> **O que mudou da 1.0.0 para a 1.1.0.** A 1.0.0 deixou a coleta pendente. Em 02/11/2026 às 16:38 UTC o proprietário executou o roteiro `P04-REL-01C-leituras-somente-leitura.sh` v1.0.0 como `root` e devolveu a saída (**E09**, SHA-256 `22d0abc521ba3659a8f0b5922fae7625a2c060e0412781fcdb0acd1de936897e`, 259 linhas, 21.168 bytes; **não versionada**: o repositório é público). Esta versão **responde A–E com evidência**, **corrige um erro meu do REL-01** (§2) e atualiza gates, riscos e a escada de autorizações.

## 1. Em uma tela

1. **Imagem `pre-dbrem06` — explicada.** A `api` roda a `pre-dbrem06` porque o container foi **criado às 13:34 (-03) de 30/10**, quando a `:latest` era essa imagem; a `:latest` atual foi **construída depois, às 15:24**, e **nunca foi implantada** (o container não foi recriado). A divergência de código entre as duas é **nula por data** (nenhum commit de runtime da API entre elas). Não houve reversão.
2. **Correção minha:** os containers **não foram "recriados às 15:38"**. Foram *criados* entre 13:34 e 14:35 e *iniciados* juntos às 15:38:22 porque o **servidor reiniciou** naquele instante (uptime e `docker-proxy` confirmam). Detalhe e efeitos em §2.
3. **Porta 3101 — identificada:** é o **gateway do Bellvia** (outra aplicação do proprietário), publicado pelo Docker em `0.0.0.0:3101`. **Não é do ProspectAI.** Nada do plano a usa nem a toca. Há uma observação de segurança para o proprietário (§4.D).
4. **Cadastro público (`/api/v1/auth/register`):** **aberto**, com **limite de 5 requisições/minuto** (rajada de 3, resposta 429), repassado ao backend. Não está fechado.
5. **Backups:** existem **dois dumps de 30/10** (12:30 e **15:23**, ~223 KB cada) nas pastas `dbrem04`/`dbrem06`, **candidatos à restauração**. Não foram abertos, não foram restaurados. O banco é **pequeno**.
6. **Logs do GATE-DB-42501:** mapeados (PostgreSQL, API, worker, web: **~92 KB no total**), com **SHA-256 de referência** gravado nesta rodada. **PostgreSQL, API e web não têm nenhuma linha depois de 30/10** (o worker escreve numa rotina diária). Isso é um fato sobre os arquivos; **não** diz se o T1 foi coletado (continua `NOT_VERIFIED`).
7. **Estratégia D** segue como caminho preferencial. Faltam, para liberar o deploy, **P1 (logs), P2/P3 (backup restaurável), snapshot da imagem da web por ID e a sua resposta sobre o T1** (§8).

## 2. Errata do REL-01 v1.1.0 (reinício do servidor; correção da Executora)

O preflight (E08) e esta coleta (E09) mostram, juntos:

| Fato observado | Valor |
|---|---|
| `uptime` no E08 (02/11 12:52 -03) | **2 dias 21 h 14 min** → o servidor iniciou em **30/10/2026 ~15:38 (-03)** |
| `StartedAt` de **todos** os 7 serviços | **2026-10-30T18:38:22Z** (= 15:38:22 -03), diferença de décimos de segundo |
| `docker-proxy` da porta 3101 iniciado | **sex 30/10 15:38:22** |
| Containers **criados** (E09 A2/C1) | `api` 13:34 · `postgres` 13:58 · `worker` 14:30 · `web` 14:35 (-03) |

**Conclusão (por observação, não hipótese):** houve **reinício do servidor (ou do daemon) em 30/10 às 15:38:22**; os containers voltaram pela política `unless-stopped`. **Não houve recriação às 15:38.** O motivo do reinício (planejado na janela DB-REM-06, atualização do sistema ou queda) **não é registrado** e é pergunta ao proprietário.

**O que eu escrevi errado e fica corrigido por esta errata** (nos documentos do REL-01, v1.1.1):
- "todos recriados em 30/10" → *criados em 30/10 entre 13:34 e 14:35; iniciados juntos às 15:38 após reinício*;
- "o log da API foi escrito pela última vez às 15:38, exatamente quando todos foram recriados" → a API escreveu **a inicialização do boot** (até 15:38:28) e **nada depois**;
- hipótese "reversão deliberada para `pre-dbrem06` (H2)" → **descartada** pelo E09 (§4.A);
- "`.env.dono` alterado depois da recriação das 15:38" → alterado **depois do reinício** (16:10), **sem efeito** sobre os containers em execução (as variáveis são lidas na criação, não no boot).

**Efeito prático:** `RestartCount = 0` **não distingue** "nunca reiniciou" de "voltou no boot"; não use esse contador como prova de estabilidade. O que continua valendo: **recriar um container descarta o log dele**; **reiniciar não descarta** (os logs de 30/10 sobreviveram ao boot, como mostra o E09).

## 3. Decisão do proprietário (informada, **não verificável** pela Executora) e escopo

> A stack `prospectai-prod` é usada **exclusivamente pelo proprietário** para desenvolvimento, testes e homologação. **Não há clientes** operando nela. Os dados existentes **devem ser preservados**.

**Autorizado:** Estratégia D como caminho preferencial; verificações complementares **somente leitura**; manter domínio e configuração; investigar imagem, backups, porta 3101 e nginx; **preservar** as evidências do GATE-DB-42501 **sem presumir** o T1; **preparar** backup, restauração de teste e rollback **sem executá-los**.
**Não autorizado (permanece fora):** merge do PR #7; deploy ou alteração de imagens; reinício de containers; migrations ou alteração no PostgreSQL; backup novo ou restauração de teste; alteração em outras aplicações; o bloco de catálogo do PostgreSQL; qualquer escrita no servidor.

| Pergunta | Resposta |
|---|---|
| A declaração muda o que foi **observado**? | **Não.** `prospectai-stage…` é a stack `prospectai-prod`; a API informa `environment: production`; banco, redis e volumes são únicos |
| Remove a regra de parada? | **Sim, para a Estratégia D**, porque o bloqueio era "pode haver usuário real". A Executora **não verifica** a afirmação; registra `DECLARED_TEST_ENV` (02/11/2026, proprietário) |
| Muda o REL-02? | **Permanece `FAIL` (técnico)**; consta *aceito para a Estratégia D por declaração do proprietário* |
| Dispensa backup, rollback e preservação? | **Não.** Os dados **devem ser preservados** e os demais gates continuam valendo |

**Higiene (não bloqueante):** como a API se declara `production` **e o cadastro público está aberto** (§4.E), vale o proprietário, numa ordem futura, **marcar o ambiente como teste** e decidir se o cadastro deve ficar aberto. Não alterado aqui.

## 4. Investigações A–E (evidência E09)

### A. Imagem `pre-dbrem06` — `IMAGE_HISTORY = CONFIRMED` (sequência); intenção não registrada

**Imagens em execução e etiquetas (E09 A1; horários -03):**

| Serviço | Imagem em execução | Criada | Etiquetas |
|---|---|---|---|
| `api` | `64b25a48…` | **30/10 09:03** | `prospectai-prod-api:pre-dbrem06` |
| `web` | `dd9dd874…` | **07/10 18:26** | `prospectai-prod-web:latest` |
| `worker` | `dddc34b6…` | **29/10 09:06** | `prospectai-prod-worker:latest` |
| (`api:latest`, **não executada**) | `408bd870…` | **30/10 15:24** | `prospectai-prod-api:latest` |

Camadas da `api` em execução × `:latest`: **9 em comum, 2 só de cada lado** (de 11): a diferença é pequena.

**Sequência reconstituída (cada elo com sua evidência):**

1. `09:03` — a `api` é construída (imagem `64b25a48`), `:latest`. *(E09 A1: criada)*
2. `13:34` — o container da `api` é **criado** com essa imagem; o rótulo `com.docker.compose.image` guarda `64b25a48…` e `config.image` é o **nome** `prospectai-prod-api` (ou seja, foi criado a partir da `:latest` de então). *(E09 A2)*
3. O histórico do shell mostra o par de comandos `docker tag prospectai-prod-api:latest prospectai-prod-api:pre-dbrem06` e, em seguida, `$C build api`. *(E09 A6; a etiqueta `pre-dbrem06` é o **snapshot da `:latest` de então** — `64b25a48` — antes do novo build)*
4. `15:23` — dump da janela DB-REM-06. `15:24` — o build produz a **nova `:latest` (`408bd870`)**. *(E09 A1 e B2)*
5. `15:38:22` — o servidor reinicia; o container **antigo** volta com a imagem que tem. *(§2)*
6. A `:latest` **nunca foi implantada**: o container (criado 13:34) é **anterior** à imagem (15:24); se tivesse sido recriado depois, `container_criado` seria ≥ 15:24 e o rótulo apontaria para `408bd870`. *(E09 A2)*

**Respostas aos itens pedidos:**

| Item | Resposta |
|---|---|
| ID e data da imagem executada pela API | `64b25a48f64799886a62139c1341eaae01367ea8ca38932cc4bb6360fecf831d`, criada 2026-10-30T09:03:22-03:00 |
| ID e data da `:latest` | `408bd870aa0acc95832cdbf867389f0a9305c4fc8bc4f814b5f1a37f13f3b01d`, criada 2026-10-30T15:24:42-03:00 |
| Histórico da mudança | sequência acima; eventos do Docker **vazios** (A5: o Docker não guarda esse histórico); o histórico do shell cobre tag e build, **não** mostra `up` (o `$C` esconde o `docker compose`) |
| Indício de rollback anterior | **Não** há: o histórico mostra **remoção deliberada** das etiquetas antigas `pre-dbrem01` e `pre-dbrem0203` (limpeza), não retorno a imagem antiga |
| Divergência imagem × árvore Git | **API:** último commit de runtime da API = `1e467fa`/`4052aa7` (28/10, 19:43) — **anterior** à criação (30/10 09:03): a imagem em execução contém, **por data**, todos os commits de runtime da árvore `2c4b1b2`. **Web:** último commit de `apps/web` = `1404989` (07/10 17:50), imagem de **07/10 18:26**: sem commit de web posterior; o `packages/types` mudou depois (`1e467fa`, DB-REM-01), de forma aditiva. **Worker:** imagem de 29/10; `239ff0e` (30/10) tocou a configuração do worker — **o release não reconstrói o worker** |
| Compatibilidade com DB-REM-04/05/06 | **Observada nos containers em execução** (E09 A3): a `api` tem `DATABASE_URL_APP` (usuário `propectai_app`) e `DATABASE_URL_SISTEMA` (usuário `propectai_sistema`) e **não** tem `DATABASE_URL` nem `DATABASE_URL_MIGRATOR`; `worker` e `web` têm **listas fechadas** de variáveis (OBS-WEB-ENV-01): **sem segredos** além de URLs de banco/Redis do worker. O `compose.prod.yml` do servidor é **igual ao HEAD** (A4). Efeito do DB-REM-06 (só migration) no banco: **NOT_VERIFIED** (catálogo não autorizado) |

**Ressalva:** a equivalência de código é **por data**; as imagens **não têm rótulo de commit**. Isto reforça a opção D8 do plano (gravar `GIT_COMMIT`/`BUILT_AT`) para o futuro.
**Consequência para o plano:** o rollback da `api` **já tem etiqueta** (`pre-dbrem06` = imagem em execução); o da `web` **não** (`pre-net-2b1…` é de 28/09, **não** é a em execução). O snapshot por ID (D1.2) continua obrigatório para as duas. O **build do release move a `:latest` da API**, e a imagem `408bd870` (build de 15:24, nunca implantada) perderia a etiqueta; a decisão de **etiquetá-la antes** (para não virar imagem órfã) é do proprietário (P4 do anexo).

### B. Backups — `BACKUP_CANDIDATES = IDENTIFIED` (restauração **não** testada)

**Candidatos do projeto (E09 B1–B4; só nomes, datas, tamanhos e integridade do contêiner):**

| Candidato | Data | Tamanho | Verificação | Classe |
|---|---|---|---|---|
| `prospectai-dbrem06-20261030-1523/propectai.dump` | **30/10 15:23** | 223.643 B | formato custom (`.dump`): **não testável** sem `pg_restore --list` | **A — candidato** (o mais recente) |
| `prospectai-dbrem04-20261030-1230/propectai.dump` | 30/10 12:30 | 223.557 B | idem | **A — candidato** (anterior à janela DB-REM-06) |
| `prospectai-s0-THD4OPOl/propectai.sql.gz` | 28/09 | 49.404 B | `gzip -t` íntegro | C — obsoleto |
| `propectai-20260921-1336.sql.gz`, `propectai-20260917.sql.gz` | 21/09, 17/09 | 42.560 B cada | íntegros | C — obsoleto |
| `prospectai-s0-20260928-1227/propectai.sql.gz` | 28/09 | **20 B** | íntegro, porém **vazio** (dump que falhou) | **C — inválido** |
| `prospectai/propectai-antes-dev-20260806-130106.dump` | 06/08 | 131.205 B | não testável | C — obsoleto |
| `*.tgz` de árvore (21/09 e 28/09) | — | 2,4 e 3,0 MB | íntegros | **não são backup de dado** |
| `env.production*.bak`, `env.dono.bak` | vários | ~4 KB | **não abertos** (segredos) | configuração, não dado |

**O que a inspeção permite concluir:** o banco é **pequeno** (dump de ~223 KB em formato custom, praticamente igual entre 12:30 e 15:23: **+86 bytes**); a restauração de teste será **rápida e barata**. O histórico do shell mostra o uso de `psql -U propectai` (usuário administrador do banco; consistente com o plano). **Nenhuma rotina agendada** cita o projeto (B5).
**Limite:** um `.dump` só prova que **existe um arquivo**; só a restauração de teste prova que ele **restaura** (e com RLS forçada e papéis corretos). **`BACKUP_RESTORE_TEST = NOT_EXECUTED`.**
**Recomendação (para autorização posterior):** (i) **restaurar primeiro o `dbrem06`** no container descartável (P3) — não cria dump novo e prova que o backup existente presta; (ii) **gerar um dump novo imediatamente antes do deploy**, porque o de 15:23 de 30/10 já tem 3 dias e a stack é usada. Procedimentos prontos no anexo; **nada executado**.

### C. Preservação do GATE-DB-42501 — `DB_42501_LOG_PRESERVATION = PLAN_ONLY`; `DB_42501_T1_STATUS = NOT_VERIFIED`

**Logs (E09 C1; só metadados; conteúdo não lido; horários em UTC):**

| Container | Instância criada | 1ª linha | Última linha | Linhas | Tamanho | SHA-256 de referência (02/11 16:38Z) |
|---|---|---|---|---|---|---|
| `postgres` | 30/10 16:58 | 30/10 16:58:07 | **30/10 21:18:26** | 54 | 10.429 B | `02ab4bcadb06cf301c92e801db80ae3ce04089fffbd6e39ecab508e83664b7ba` |
| `api` | 30/10 16:34 | 30/10 16:34:20 | **30/10 18:38:28** | 259 | 72.823 B | `511c96f69f3fb26d56baa9f51e1d769c37ee78081597912195e4d2163181997f` |
| `worker` | 30/10 17:30 | 30/10 17:30:05 | **02/11 12:00:00** | 12 | 3.541 B | `04616b88346de15f5b38bdf439763be37799bcb518e8b165ad4e1fab91258825` *(arquivo vivo: muda a cada execução do worker)* |
| `web` | 30/10 17:35 | 30/10 17:35:03 | **30/10 21:09:31** | 49 | 5.124 B | `a62859cf1b3ffbbd6bc007a7d5dd8940dd79051060aa419133ab2f7ee2289368` |

Todos: driver `json-file`, **sem opções de rotação**, sem `daemon.json`, modo `640`, dono `root`; 193 GB livres.

**O que isto estabelece (fatos sobre os arquivos):**
- Os logs cobrem **só a vida das instâncias atuais** (a partir de 30/10); o que as instâncias anteriores escreveram **já se perdeu** na recriação e não é recuperável por este plano.
- **`postgres`, `api` e `web` não escreveram nada depois de 30/10** (a última linha da API é de 30/10 18:38:28Z, seis segundos depois do boot; a do PostgreSQL, de 30/10 21:18Z; a da web, de 30/10 21:09Z). **Não há linha de 01/11 em `postgres`, `api` nem `web`**; só o `worker` escreve depois de 30/10 (rotina diária, última linha em 02/11 12:00Z; o arquivo não foi lido, então não afirmo o que há nas linhas dele). Os hashes de `postgres`, `api` e `web` **não deveriam mudar** até que o container seja recriado: servem de **linha de base de custódia**.
- O `postgres` **não tem opções `log_*` na linha de comando** (E09: só `postgres`), portanto qualquer parâmetro de log viria de arquivo de configuração (**não lido**); o conteúdo do log **não foi aberto**, então não afirmo o que ele registra. **Não** sei se há log de consulta em outro lugar (arquivo no volume de dados): o plano não cobre isso e a pergunta fica ao proprietário.
- **Isso não responde ao T1.** A ausência de linhas de 01/11 nesses três não diz se a coleta T1 aconteceu (pode ter usado outro meio) nem se o evidenciável estava nesses logs. **`DB_42501_T1_STATUS = NOT_VERIFIED`.** A Executora **não presume** coleta.

**Plano de exportação (anexo, P1) — pronto, não executado:** cópia **bruta** do arquivo (prefixo de tamanho congelado), SHA-256 de origem e cópia, `chmod 400`, manifesto, `SHA256SUMS`, cópia fora do servidor com conferência do hash, retenção até liberação escrita, nada de conteúdo no repositório. Como são ~92 KB, o custo é desprezível; **o único risco real é recriar `api`/`web`/`postgres` antes de exportar**.

### D. Porta 3101 — `PORT_3101_IDENTIFICATION = IDENTIFIED_OTHER_APP`

**Evidência (E09 D1):**

| Pergunta | Resposta |
|---|---|
| Processo | `docker-proxy` (pid dos dois sockets), `/usr/bin/docker-proxy`, iniciado em 30/10 15:38:22 (boot), processo **do host** |
| Serviço/container responsável | `docker ps --filter publish=3101` aponta **um** container: o **gateway do Bellvia** (nginx 1.27, `0.0.0.0:3101->80` e `[::]:3101->80`) |
| Endereço de escuta | `0.0.0.0:3101` e `[::]:3101` — **todas as interfaces** |
| Associação | **Outra aplicação** (o Bellvia). **Não** é ProspectAI: o corpo de `/api/v1/health` e de `/api/v1/system/version` na 3101 é de outro backend |
| Firewall | `ufw` **ativo**; regra do `nftables` com **DNAT** para a porta 80 do container, que já contou **291 pacotes (16.843 bytes)** desde o boot |
| Exposição potencial | **Alta, não testada de fora.** O Docker costuma contornar o `ufw` para portas que ele mesmo publica (comportamento conhecido do Docker; **não verificado neste servidor**), e o contador do DNAT mostra tráfego passando pela regra. **A prova é o teste TCP de fora** (`Test-NetConnection 108.174.144.216 -Port 3101`), que **não foi feito** |

**Conclusões e limites:** a 3101 **não pertence ao ProspectAI**, **nada no plano a usa** e **nada do ProspectAI a toca**. **A Executora não encerra processo, não altera firewall, não toca o Bellvia** (regra inviolável do projeto). O registro vai ao proprietário como **observação de segurança do Bellvia**, para a trilha própria dele. Nome do container **não** copiado além do que a regra do projeto já registra (Bellvia compartilha o daemon).

### E. Cadastro `/api/v1/auth/register` — `NGINX_REGISTER_ROUTE = RATE_LIMITED`

**Evidência (E09 E1/E2), diretivas do bloco (IPs e valores omitidos pelo roteiro):**

```nginx
location = /api/v1/auth/register {
  limit_req zone=prospectai_register burst=3 nodelay;
  limit_req_status 429;
  try_files $uri @reverse_proxy;      # repassa ao backend (o mesmo destino de /)
}
limit_req_zone $prospectai_register_key zone=prospectai_register:10m rate=5r/m;
```

| Pergunta | Resposta |
|---|---|
| O cadastro está aberto, fechado ou restrito? | **Aberto ao público, com limite**: 5 requisições/minuto por chave (`$prospectai_register_key`), rajada de 3, resposta **429** ao exceder. **Não há `allow`/`deny` nem `return`** no bloco |
| A chave do limite | `$prospectai_register_key` é **variável definida em outro ponto** (um `map`); **o conteúdo não foi lido**; provavelmente por IP — **hipótese** |
| `HEAD`/`GET` na rota | **404** (pela porta local e pelo domínio): a rota é **POST**; GET/HEAD não chegam a criar nada |
| Impacto no smoke S2 | A segunda conta/workspace **pode** ser criada pelo cadastro normal (dentro do limite). **Criar conta continua dependendo de autorização**, e o dado criado **fica no banco único** |

**Observação de segurança (AppSec, sem ação):** um cadastro **público** num domínio de homologação, no **único** banco, significa que **qualquer pessoa na internet pode criar conta e workspace** nele (a lacuna S0-NET-01 do histórico do projeto). O limite de taxa reduz abuso, não impede. Isto pesa na declaração "só uso o ambiente" e no objetivo de **preservar dados**. A decisão (fechar, restringir, manter) é do proprietário e **fica para ordem própria**; **o vhost não foi alterado**.

## 5. Estratégia D × C (parecer atualizado)

| | **D — publicar na stack existente** | **C — homologação isolada** |
|---|---|---|
| Situação | **Aprovada como caminho preferencial** | **Não necessária**, desde que a declaração "sem cliente nem dado real" seja verdadeira |
| Isolamento | **Nenhum** (`STAGING_ISOLATION = FAIL`) | Total |
| Custo | Baixo: recriar `api` e `web` (segundos) | Alto (override do compose, DNS, TLS, vhost, segredos próprios) |
| Risco principal | Um erro afeta o único ambiente e os dados **a preservar**; o cadastro público está aberto | Mais superfície |
| Inegociáveis | **P1** logs preservados · **P2/P3** backup restaurável · **snapshot por ID** (`web` inclusive) · decisão sobre o T1 | Autorização de infraestrutura |
| Quando muda | Se aparecer **dado real** (ou se o cadastro aberto já tiver trazido contas de terceiros): **parar** e ir para C | — |

**Recomendação (única): Estratégia D**, nas condições acima. **Condição nova desta rodada:** antes do deploy, o proprietário confirma que **não há contas de terceiros** criadas pelo cadastro aberto (checagem **de leitura** no banco, sob autorização) — porque a declaração "só eu uso" e o cadastro público **não são compatíveis sem essa confirmação**.

## 6. Gates (reclassificados)

| Gate | Antes (REL-01 v1.1.0) | Agora (REL-01C v1.1.0) | Base |
|---|---|---|---|
| REL-01 Domínio e destino | PASS | **PASS** | E08 |
| REL-02 Isolamento | FAIL | **FAIL (técnico); aceito para a Estratégia D por declaração do proprietário** | E08; §3 |
| REL-03 Commit exato | PARTIAL | **PASS** *(por datas; imagens sem rótulo de commit)* | E09 A1–A4 |
| REL-04 Compatibilidade API/web | PASS | **PASS** | CI #77; E09 A3 |
| REL-05 Migrations | PASS (delta) | **PASS (delta)**; estado no banco `NOT_VERIFIED` | catálogo não autorizado |
| REL-06 Serviços compartilhados | PARTIAL | **PASS** | E09 D1: 3101 identificada (Bellvia); redes e volumes do projeto isolados |
| REL-07 Capacidade | PASS | **PASS** | E08 |
| REL-08 Backup e restauração | BLOCKED | **BLOCKED** | candidatos identificados (B); sem restauração |
| REL-09 Rollback preparado | BLOCKED | **BLOCKED** | `api` com etiqueta `pre-dbrem06`; `web` sem etiqueta da imagem em execução; exige snapshot por ID (na execução) |
| REL-10 Pendências DB-42501 / SEC-DATA-01 | BLOCKED | **BLOCKED** | plano pronto (C/P1); T1 e escopo dos logs dependem do proprietário |
| REL-11 Smoke tests | PASS | **PASS** | cadastro aberto (E) viabiliza a 2ª conta, **com autorização** |
| REL-12 Sem risco a outras apps | NOT_VERIFIED | **PARTIAL** | plano toca só `api`/`web`; carga do build não medida; observação de segurança do Bellvia (D) é **externa** ao plano |

## 7. Riscos remanescentes (acrescentam-se ao registro R01–R33)

| ID | Risco | Estado |
|---|---|---|
| R34 | A declaração "sem clientes" **não é verificável** pela Executora | ACEITO como premissa; registrar em cada relatório |
| R35 | Único banco + dados **a preservar**: erro de publicação ou restauração atinge o único conjunto de dados | ABERTO — mitigado quando P2/P3 estiverem `PASS` |
| R36 | **T1 desconhecido**; recriar `api`/`web` descarta o log da instância atual | ABERTO — mitigado por P1 antes de qualquer recriação |
| R37 | Backup restaurável **não comprovado** (os dumps de 30/10 são candidatos; o mais recente tem 3 dias) | ABERTO (BLOCKED) |
| R38 | ~~Divergência imagem × árvore~~ | **FECHADO**: nula por data (API), sem commit de web posterior |
| R39 | `:latest` não é referência; o `build` do release **move a `:latest`** da API e deixa a `408bd870` (build de 15:24) **sem etiqueta** | MITIGADO no plano (snapshot por ID; etiquetar a `408bd870` por decisão do proprietário) |
| R40 | Porta 3101 do **Bellvia** publicada em `0.0.0.0`; alcance externo **não testado** | **Fora do escopo do ProspectAI**; informado; sem ação da Executora |
| R41 | ~~Cadastro público impede a 2ª conta do S2~~ | **FECHADO**: o cadastro está aberto (com limite); criar conta depende de autorização |
| R42 | Saída do roteiro cita nomes de outra aplicação | MITIGADO: bruto fora do Git; só o necessário aqui |
| R43 | **Cadastro público aberto** num domínio de homologação com **único banco** e dados a preservar: contas de terceiros possíveis | ABERTO — confirmar por leitura sob autorização; decisão do proprietário (ordem própria) |
| R44 | **Reinício do servidor em 30/10 15:38 sem causa registrada** | ABERTO — pergunta ao proprietário; relevante porque `restart: unless-stopped` fez a stack voltar sozinha |

## 8. Procedimento exato para liberar a publicação controlada

Cada degrau exige autorização expressa própria. Detalhes e texto sugerido no anexo (§P5).

1. **Concluído:** REL-01C (leituras A–E).
2. **Decisões do proprietário (sem ação técnica):** (a) **T1** — que logs do GATE-DB-42501 precisam sobreviver e se já foi coletado; os logs hoje têm ~92 KB e nenhuma linha de 01/11; (b) causa do **reinício de 30/10 15:38**; (c) o que fazer com o **cadastro aberto** (manter, e confirmar que não há contas de terceiros); (d) quem opera e a janela; (e) etiquetar ou não a imagem `408bd870`; (f) D8 (SHA no endpoint) e item "Intelligence" no menu.
3. **P04-REL-02A — Preservação e backup:** P1 (logs) → P3 do `dbrem06` (restauração de teste do **dump existente**, sem dump novo) → P2 (dump novo) → P3 do dump novo. Escreve **só** em `/opt/backups/p04-rel`; cria **um** container descartável; **não toca** serviço do projeto. Fecha REL-08 e REL-10.
4. **P04-REL-02B — Publicação controlada (D):** snapshot **por ID** (`api` e `web`), `git fetch`/`bundle` do SHA `cebbfa6`, build só de `api` e `web`, recriar `api` e depois `web`, prova de `StartedAt` dos demais (com a nota do reinício: a linha de base é a de 30/10 18:38:22Z). Fecha REL-09. **Só com REL-08 e REL-10 `PASS`.**
5. **P04-REL-02C — Smoke e aceitação:** S0–S4; S2 com duas contas.
6. **Decisão do PR #7:** só depois da aceitação.

## 9. Ações que exigem autorização posterior

Executar P1/P2/P3; criar `/opt/backups/p04-rel` e o container descartável; ler `pg_roles` (papel do dump), `_prisma_migrations` e a tabela de contas (verificar contas de terceiros); `git fetch`/`bundle` e `checkout --detach` na árvore; build e etiquetas de imagem; recriar `api` e `web`; criar a 2ª conta de teste; qualquer ação sobre o vhost, o cadastro ou o ambiente (rótulo "teste"); qualquer ação relativa ao Bellvia (porta 3101): **trilha e ordem próprias**.

## 10. Estados

```text
P04_REL_01C_EXECUTION       = COMPLETE
P04_REL_01C_RESULT          = PASS      (leituras A–E concluídas com resposta; NÃO é aprovação de deploy)

IMAGE_HISTORY               = CONFIRMED (sequência por datas e histórico; intenção do proprietário não registrada; sem reversão)
BACKUP_CANDIDATES           = IDENTIFIED (A: dbrem06 15:23 e dbrem04 12:30, ~223 KB; restauração NÃO testada)
BACKUP_RESTORE_TEST         = NOT_EXECUTED
DB_42501_LOG_PRESERVATION   = PLAN_ONLY
DB_42501_T1_STATUS          = NOT_VERIFIED
PORT_3101_IDENTIFICATION    = IDENTIFIED_OTHER_APP (gateway do Bellvia; 0.0.0.0; fora do escopo do ProspectAI)
NGINX_REGISTER_ROUTE        = RATE_LIMITED (aberto ao público; 5 r/min, burst 3, 429)

STAGING_ISOLATION           = FAIL
PRODUCTION_DEPLOY           = NO
MERGE_EXECUTED              = NO
SERVICE_RESTARTS            = 0
DATABASE_MUTATIONS          = 0

NEXT_STEP                   = AWAIT_OWNER_APPROVAL
```

`OTHER_STACKS_MODIFIED = 0`. Pendências preservadas e **não** executadas: `SEC-DATA-01 = OPEN / NOT_EXECUTED`, `GATE-DB-42501 = OPEN`, `SEC-DB-02 = NOT_STARTED`. `SERVICE_RESTARTS = 0` refere-se ao que **a Executora** fez; o reinício de 30/10 (§2) é anterior e **não foi causado por ela**.
