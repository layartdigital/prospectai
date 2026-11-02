# P04-REL-01C — Verificações complementares e desbloqueio de publicação

**Projeto:** ProspectAI · **Módulo:** Intelligence Explorer 0.1.0 · **Responsável:** Executora (DevOps/SRE, Database Engineering, AppSec, QA, Documentação) · **Versão:** 1.0.0 · **Data:** 02/11/2026
**Referências:** P04-REL-01 v1.1.0; PR #7 (rascunho); commit de referência `0ed11b99708d03e6a5153538cabe73158a5d48a1`; commit de release `cebbfa6e54b96c1e4e840eb1d631e3b0a94eba79`.
**`F:\drmind` (Bellvia) não foi modificado.** Nada foi executado no servidor, nenhum serviço foi reiniciado, nenhuma imagem foi alterada, não houve merge nem escrita no banco.

## 1. Em uma tela

- **Estado desta versão (1.0.0): preparação completa, coleta pendente.** A Executora **não tem canal para o servidor** (o proxy da sessão recusa o domínio e a máquina virtual do computador do proprietário não inicia por falta de disco). A ordem pede um canal "efetivamente disponível e autorizado": o único que existe é o **proprietário rodando o roteiro**, como no preflight. Por isso as **evidências A–E ainda não foram coletadas** e **nenhuma hipótese abaixo é tratada como fato**.
- **Entregue agora:** (1) o roteiro `P04-REL-01C-leituras-somente-leitura.sh` (os 5 objetivos, somente leitura, com valores sensíveis mascarados e nada de `docker exec`, `docker logs`, `docker history` ou `nginx -T`); (2) este relatório, com **o que já se sabe, o que cada leitura vai provar e como cada resultado será classificado**; (3) `P04-REL-01C-PROCEDIMENTOS-PREPARADOS.md` — preservação de logs, backup atualizado, restauração de teste e rollback, **só descritos, não executados**; (4) a **sequência exata de autorizações** para liberar a publicação controlada (§8).
- **Estratégia D** fica como caminho preferencial (decisão do proprietário, §2). A falta de isolamento **continua `FAIL` tecnicamente**; deixa de impedir a Estratégia D **por declaração do proprietário**, sem dispensar os demais gates.
- **Versão 1.1.0** (ao receber a saída do roteiro): preenche §4, reclassifica os gates, fecha os estados da §10 e **para** de novo.

## 2. Decisão do proprietário registrada (informada, **não verificável** pela Executora)

> A stack `prospectai-prod` é usada **exclusivamente pelo proprietário** para desenvolvimento, testes e homologação do ProspectAI. **Não há clientes operando comercialmente** nela. Os dados existentes **devem ser preservados**.

**Autorizado:** adotar a **Estratégia D** como caminho preferencial (sem segunda infraestrutura); continuar o P04-REL-01C **somente com leitura**; manter o domínio de homologação e a configuração existente; investigar a imagem `pre-dbrem06`, os backups, a porta `3101` e o roteamento do nginx; **preservar** as evidências do GATE-DB-42501 **sem presumir** que o T1 foi coletado; **preparar** backup atualizado, restauração de teste e rollback, **sem executá-los**.

**Não autorizado (permanece fora):** merge do PR #7; deploy ou alteração de imagens; reinício de containers; migrations ou qualquer alteração no PostgreSQL; backup novo ou restauração de teste; alteração em outras aplicações; **bloco do catálogo do PostgreSQL**; qualquer escrita no servidor.

**Como a Executora usa esta declaração (sem exagerar o que ela prova):**

| Pergunta | Resposta |
|---|---|
| A declaração muda o que foi **observado**? | **Não.** O domínio `stage` ainda é a stack `prospectai-prod`; a API ainda informa `environment: production`; banco, redis e volumes ainda são únicos |
| Ela remove o bloqueio da regra de parada? | **Sim, para a Estratégia D**, porque o bloqueio era "pode haver usuário real" — e o proprietário afirma que não há. A Executora **não consegue verificar** essa afirmação; registra-a como `DECLARED_TEST_ENV` (02/11/2026, proprietário) |
| Muda o gate REL-02? | O resultado técnico **permanece `FAIL`** (não há isolamento). Passa a constar **"aceito para a Estratégia D por declaração do proprietário"**. Não é `PASS` |
| Dispensa backup, rollback e preservação de logs? | **Não.** O proprietário disse expressamente: os dados **devem ser preservados** e **os demais gates continuam valendo** |

**Recomendação de higiene (não bloqueante):** como a API se declara `production`, vale o proprietário **marcar o ambiente como teste** (por exemplo `APP_ENV`/rótulo no rodapé) **numa ordem futura** — evita que qualquer pessoa, ou qualquer verificação automática, trate esta stack como produção real. Não alterado aqui.

## 3. Canal e execução da coleta

| Item | Situação |
|---|---|
| Canal da Executora ao servidor | **inexistente** nesta sessão (E01–E06 do índice REL-01) |
| Canal disponível e autorizado | o proprietário executa o roteiro como `root`, **uma vez**, e devolve a saída |
| Escopo do roteiro | **só os blocos dos objetivos A–E**; **não** reexecuta o preflight inteiro (E08 já cobre o resto); **não** roda o catálogo do PostgreSQL |

```powershell
# No computador do proprietário (PowerShell). Mesmo método do preflight que funcionou.
scp "C:\ResgateProjetos\prospectai\Claude outputs\P04-REL-01C-leituras-somente-leitura.sh" root@108.174.144.216:/tmp/
ssh root@108.174.144.216 "bash /tmp/P04-REL-01C-leituras-somente-leitura.sh" | Out-File -Encoding utf8 "C:\ResgateProjetos\prospectai\Claude outputs\rel01c.txt"
ssh root@108.174.144.216 "rm -f /tmp/P04-REL-01C-leituras-somente-leitura.sh"
```

Antes de enviar: abrir o `rel01c.txt` e conferir que não há segredo. O roteiro **imprime nomes de variável sem valor**, só o **nome de usuário** das URLs de banco, só o campo `time` das linhas de log, e as diretivas do nginx com IPs e valores de cabeçalho omitidos. A seção **D1** pode mostrar o **nome de um container de outra aplicação** (necessário para identificar a porta `3101`); a Executora **não copiará esse nome** para documentos do repositório (público). A seção **A6** (histórico do shell do root, mascarado) pode ser pulada com `P04_SEM_HISTORICO=1`. O arquivo bruto **não entra no repositório**: só o SHA-256 e trechos sanitizados.

**Complemento a partir do seu computador (opcional, 1 comando):** `Test-NetConnection 108.174.144.216 -Port 3101` — só abre e fecha a conexão TCP e diz se a `3101` é **alcançável de fora**, que é o dado que decide a exposição (§4.D).

## 4. Investigações A–E

### A. Imagem `pre-dbrem06`

**Já observado (E08):** a `api` em execução usa `sha256:64b25a48…` = etiqueta `prospectai-prod-api:pre-dbrem06` (criada "há 3 dias"); a `:latest` da API é `408bd870aa0a` ("há 2 dias"); `web` e `worker` rodam suas `:latest`. Todos os containers foram (re)criados em 2026-10-30T18:38:22Z (15:38 -0300), 0 reinícios. `.env.dono` foi alterado depois (16:10).

**Pista de Docker (fato do comportamento do Docker, não do servidor):** `docker ps` mostra o **ID** da imagem em vez do nome quando a etiqueta do nome **foi movida** depois da criação do container. Logo, o container da API foi criado quando `64b25a48` era a imagem apontada pelo nome (`:latest`) **ou** foi criado direto pelo ID; e a `:latest` **foi movida depois**.

**Hipóteses (nenhuma confirmada):**

| ID | Hipótese | O que a confirmaria | O que a refutaria |
|---|---|---|---|
| H1 | **A `:latest` (408bd870) é uma construção posterior, nunca implantada** (alguém reconstruiu a API depois da recriação das 15:38 e não recriou o container) | `latest.criada` **posterior** a `container_criado` (A1/A2); sem evento de recriação depois | `latest.criada` anterior a `container_criado` |
| H2 | **Reversão deliberada** para `pre-dbrem06` durante a janela DB-REM-06 | `latest.criada` **anterior** a `container_criado`; histórico do shell (A6) ou eventos (A5) mostrando `docker tag`/`up` de `pre-dbrem06` | H1 confirmada |
| H3 | A recriação das 15:38 **resolveu o ID de uma imagem em cache antiga** do Compose | rótulo `com.docker.compose.image` (A2) = `64b25a48…` e `config.image` ≠ nome atual | — |

**Divergência entre imagem e árvore Git:** A4 lista, com datas, os commits que tocam o runtime da API/web/worker desde 01/10 (a árvore do servidor está em `2c4b1b2`). Regra de leitura: `imagem.criada` **maior ou igual** à data do último commit de runtime ⇒ a imagem **pode** conter tudo (por data, **não** por conteúdo); menor ⇒ **há commit de runtime que a imagem não tem**. A comparação de camadas (A1) diz o quanto `pre-dbrem06` e `:latest` diferem (muitas camadas em comum = mudança pequena).

**Compatibilidade com DB-REM-04/05/06:** A3 imprime só **nomes** de variável do container da API e o **usuário** de `DATABASE_URL_APP`/`SISTEMA`. Esperado: `APP` e `SISTEMA` presentes; **sem** `DATABASE_URL` nem `DATABASE_URL_MIGRATOR` na API (segredos do dono ficam só no `.env.dono`); usuário de `APP` = `propectai_app`. Conferência no repositório: o DB-REM-06 alterou **só migrations** e o DB-REM-04/OBS-WEB-ENV-01 **só o compose** e a configuração do worker; o código de runtime da API mudou em `1e467fa` (DB-REM-01, 28/10). Portanto **a divergência de código entre as duas imagens da API é, por data, provavelmente nula ou pequena** — **hipótese**, a confirmar pela comparação acima.

**Classificação final (regra):** `IMAGE_HISTORY = CONFIRMED` só se A2+A5/A6 mostrarem a sequência de eventos; se só A1/A2 derem **coerência de datas** sem evento nem histórico, `INCONCLUSIVE` com a hipótese mais provável **declarada como hipótese**.
**Estado hoje:** `INCONCLUSIVE` (pendente de coleta).

### B. Backups existentes

**Já observado (E08 §12), só o que é do projeto:**

| Candidato | Data | Tamanho | Integridade | Classe provisória |
|---|---|---|---|---|
| `propectai-20260921-1336.sql.gz` | 21/09/2026 | 42.560 B | `gzip -t` ok | **C — obsoleto** (6 semanas; anterior às migrations e janelas DB-REM de outubro) |
| `propectai-20260917.sql.gz` | 17/09/2026 | 42.560 B | `gzip -t` ok | **C — obsoleto** |
| `prospectai-arvore-20260921-1726.tgz` | 21/09/2026 | ~2,4 MB | não testado | árvore de código, **não** é backup de dado |
| `env.production-20260921.bak`, `env.production-20260922-redis.bak` | 11/08 e 21/09 | — | — | configuração antiga, **segredos**: não abrir |
| `prospectai-dbrem04-20261030-1230/` | 30/10/2026 12:30 | **?** | **?** | **pendente** (B2) |
| `prospectai-dbrem06-20261030-1523/` | 30/10/2026 15:23 | **?** | **?** | **pendente** (B2) |

O roteiro (B1–B5) lista **nomes, datas, tamanhos e tipo de entrada** — inclusive o interior das duas pastas `dbrem`, 2 níveis —, testa o **contêiner** gzip/tgz (`gzip -t`), procura dumps soltos na árvore e nos dados do projeto e confere rotinas agendadas. **Não abre conteúdo, não gera dump, não restaura.**

**Critério de classificação dos candidatos (quando houver dados):**

| Classe | Critério | Uso |
|---|---|---|
| **A — candidato à restauração** | dump de **dados** (`.sql.gz`/`.dump`), contêiner íntegro, **posterior** às migrations atuais (≥ 30/10 12:30), tamanho plausível frente ao banco | entra no P3 (restauração de teste) **se** o proprietário autorizar; **não** substitui um dump novo se este for exigível |
| **B — parcial** | só esquema, só papéis, ou só parte das tabelas | referência, não restauração |
| **C — obsoleto/insuficiente** | anterior às janelas DB-REM, ou contêiner com erro | registrar e **não** contar como backup |

Um candidato da classe A **não** fecha o `BACKUP_GATE` sozinho: só a **restauração de teste** o fecha. O procedimento de **backup novo + restore-test** está pronto no anexo (P2/P3) e **depende de autorização posterior**.
**Estado hoje:** `BACKUP_CANDIDATES = PARTIAL` (2 dumps de setembro conhecidos, classe C; pastas `dbrem04/06` pendentes). `BACKUP_RESTORE_TEST = NOT_EXECUTED`.

### C. Preservação do GATE-DB-42501

**Já observado (E08 §6), só metadados:** driver `json-file` **sem rotação** em todos; `postgres` 10.429 B (última escrita 30/10 18:18), `api` 72.823 B (30/10 15:38), `worker` 3.541 B (02/11 09:00), `web` 5.124 B (30/10 18:09). Os containers são **instâncias criadas em 30/10**: o que a instância anterior escreveu foi descartado na recriação e **não é recuperável**.

**O que o roteiro (C1) acrescenta, sem ler conteúdo:** driver e opções de log globais e por container; caminho, tamanho, dono, modo e `mtime` do arquivo; **período** (só o campo `time` da primeira e da última linha); número de linhas; **SHA-256 de referência** de cada arquivo; opções de linha de comando do `postgres` (`log_*`), com máscara; espaço livre. **Não** usa `docker logs`, **não** abre o texto do log.

**Plano de exportação:** anexo, **P1** — cópia **bruta** (preserva o campo `time` e o fluxo), prefixo de tamanho congelado, SHA-256 da origem e da cópia, `chmod 400`, manifesto, `SHA256SUMS`, cópia fora do servidor pelo proprietário com conferência do hash, retenção até liberação escrita, **nada** de conteúdo no repositório ou no chat. **Não executado.**
**Estado hoje:** `DB_42501_LOG_PRESERVATION = PLAN_ONLY`; `DB_42501_T1_STATUS = NOT_VERIFIED` (a Executora **não** presume coleta; só o proprietário sabe).

### D. Porta 3101

**Já observado (E08 §9):** escuta em `0.0.0.0:3101` e `[::]:3101`; o compose de produção **não** a publica (só `127.0.0.1:3102`); o container `api` expõe `3101/tcp` **só na rede interna**; `docker ps` não mostra mapeamento de host para ela.
**Repositório:** o compose de **desenvolvimento** publica a API em `127.0.0.1:3101` (apenas loopback) e a API de desenvolvimento usa a `3101` (CLAUDE.md). **Nem um nem outro explica `0.0.0.0`.**

**Hipóteses:** (i) processo de **outra aplicação** do servidor (container com porta publicada ou serviço do host); (ii) resquício de **execução local** (`pnpm dev`/`node`) que escuta em todas as interfaces. **Nenhuma é afirmada.**

**O que o roteiro (D1) responde, em cadeia:** `ss -ltnp` (processo e pid) → `ps` **sem linha de comando** (pode ter segredo) + `exe` e `cwd` → o `cgroup` diz se o processo está **dentro de um container** e qual → `docker ps --filter publish=3101` → regras de `ufw`/`iptables`/`nft` que citam `3101` → `GET` local em `/`, `/api/v1/health` e `/api/v1/system/version` (só status e 3 cabeçalhos; corpo limitado a 200 bytes nos dois endpoints do ProspectAI). Se responder `{"status":…}`, é uma API do ProspectAI.

**Classificação:** `IDENTIFIED_PROSPECTAI` / `IDENTIFIED_OTHER_APP` / `NOT_IDENTIFIED`. **Exposição potencial:** `0.0.0.0` **mais** ausência de regra de bloqueio **mais** `Test-NetConnection` alcançável de fora = **exposta**; se `ufw`/`iptables` bloquear ou o teste externo falhar, **escuta em todas as interfaces, mas não alcançável**. **A Executora não encerra o processo, não muda firewall nem roteamento**; recomenda, não executa.
**Estado hoje:** `PORT_3101_IDENTIFICATION = NOT_IDENTIFIED` (pendente de coleta).

### E. Regra do nginx para `/api/v1/auth/register`

**Já observado (E08 §9):** o vhost do domínio tem `location = /api/v1/auth/register` (linha 67), **separado** do `location /` (linha 73) e do `@reverse_proxy` (linha 29). O **conteúdo do bloco não foi impresso**.
**Repositório:** `register` é uma rota **POST** do `AuthController`. O histórico do projeto registra o **cadastro público em ambiente exposto** como lacuna conhecida (S0-NET-01, item 5 do forense de 11/08): "qualquer um cria conta e workspace". **Hipótese:** o bloco existe **para restringir ou limitar** o cadastro público (negar, limitar taxa, ou liberar só alguns IPs). **Não confirmada.**

**O que o roteiro (E1/E2) faz:** extrai **apenas** o bloco (até o fechamento das chaves), descarta linhas com `ssl_`, `certificate`, `key`, `password`, `secret`, `token`; omite IPs de `allow`/`deny` e **valores** de `proxy_set_header`/`add_header`/`set`; mostra as definições das zonas de limite (`limit_req_zone`) que o bloco referencia; lista **só os nomes** das `location` do vhost; e faz **HEAD/GET** (nunca POST) em `/api/v1/auth/register` pela porta local e pelo domínio, para ver status. **Não** usa `nginx -T` e **não** altera o vhost.

**Por que isso importa para a publicação:** o smoke **S2** exige duas contas de workspaces diferentes. Se o cadastro público estiver **fechado ou limitado**, a segunda conta **não** pode ser criada pelo cadastro normal; a alternativa (conta existente ou criação por fluxo autorizado) precisa de decisão do proprietário. **Nada disto altera o nginx.**
**Classificação:** `OPEN_TO_PUBLIC` / `RESTRICTED` / `RATE_LIMITED` / `BLOCKED` / `NOT_INSPECTED`.
**Estado hoje:** `NGINX_REGISTER_ROUTE = NOT_INSPECTED` (bloco existe; conteúdo pendente).

## 5. Estratégia D × C (parecer atualizado)

| | **D — publicar na stack existente** | **C — homologação isolada** |
|---|---|---|
| Situação com a decisão do proprietário | **Aprovada como caminho preferencial** (§2) | **Não necessária**, **desde que** a declaração "sem cliente nem dado real" seja verdadeira |
| Isolamento | **Nenhum** (`STAGING_ISOLATION = FAIL`): o domínio `stage`, a API `production`, o banco e o redis são os mesmos | Total (containers, banco, redis, volumes e configuração próprios) |
| Custo | Baixo: 2 serviços recriados (api, web), segundos de indisponibilidade | Alto: override do compose (sub-rede, IPs, porta e pasta de dados fixos), DNS, TLS, vhost, segredos próprios, mais carga num servidor compartilhado |
| Risco principal | Um erro afeta **o único ambiente existente e os dados que devem ser preservados**; a API se diz `production` | Mais superfície e mais configuração a manter |
| Pré-requisitos **inegociáveis** | **P1** logs preservados · **P2/P3** backup **restaurável** · **P4** snapshot **por ID** da imagem em execução · decisão sobre o T1 · gates REL-03/06/12 fechados | Autorização de infraestrutura própria |
| Quando muda | Se o proprietário **perder a certeza** sobre "sem clientes" ou se aparecer dado real: **parar** e ir para C | — |

**Recomendação (única): Estratégia D**, nas condições acima. A QA acrescenta uma condição ao parecer: **a declaração do proprietário é registrada como premissa**, e o smoke de isolamento (S2, **duas contas**) **continua obrigatório**, porque o Explorer lê dados dentro de RLS e a prova de isolamento é do **produto**, não do ambiente.

## 6. Gates (estado atual, aguardando a coleta)

| Gate | Estado em REL-01 v1.1.0 | Em REL-01C v1.0.0 | O que muda com a coleta |
|---|---|---|---|
| REL-01 Domínio e destino | PASS | PASS | — |
| REL-02 Isolamento | FAIL | **FAIL (técnico); aceito para a Estratégia D por declaração do proprietário** | não muda (não há isolamento); só a nota |
| REL-03 Commit exato | PARTIAL | PARTIAL | A1–A4 → `PASS` se imagens e divergência ficarem identificadas |
| REL-04 Compatibilidade API/web | PASS | PASS | — |
| REL-05 Migrations | PASS (delta) | PASS (delta) | estado no banco segue `NOT_VERIFIED` (catálogo não autorizado) |
| REL-06 Serviços compartilhados | PARTIAL | PARTIAL | D1 identifica a `3101` |
| REL-07 Capacidade | PASS | PASS | — |
| REL-08 Backup e restauração | BLOCKED | **BLOCKED** | B classifica candidatos; só **P2/P3** executados (outra ordem) fecham |
| REL-09 Rollback preparado | BLOCKED | **BLOCKED** (procedimento pronto no anexo, P4) | só existe na execução (snapshot por ID) |
| REL-10 Pendências DB-42501 / SEC-DATA-01 | BLOCKED | **BLOCKED** (plano pronto, P1) | exige **P1** executado e a resposta do proprietário sobre o T1 |
| REL-11 Smoke tests | PASS | PASS | ajuste por E (segunda conta) |
| REL-12 Sem risco a outras apps | NOT_VERIFIED | NOT_VERIFIED | depende de D (3101) |

## 7. Riscos remanescentes (continuam e acrescentam-se ao registro R01–R33)

| ID | Risco | Estado |
|---|---|---|
| R34 | **A declaração "sem clientes" não é verificável** pela Executora; a stack é servida num domínio e se declara `production` | ACEITO como premissa do proprietário; registrar em cada relatório |
| R35 | **Dados que devem ser preservados + um único banco**: um erro de publicação, de migration ou de restauração afeta o único conjunto de dados | ABERTO — mitigado só quando P2/P3 (backup restaurável) estiverem `PASS` |
| R36 | **T1 do GATE-DB-42501 desconhecido**: recriar `api`/`web` descarta log da instância atual | ABERTO — mitigado por P1 antes de qualquer recriação |
| R37 | **Backup mais recente conhecido tem 6 semanas** e anterior às janelas DB-REM | ABERTO (BLOCKED) — pastas `dbrem04/06` podem ajudar, **não** substituem restauração de teste |
| R38 | **Divergência imagem × árvore** se a imagem em execução da API for anterior a commit de runtime | ABERTO — fechada por A1/A4 |
| R39 | **`:latest` não é referência**: o `build` do release a sobrescreve | MITIGADO no plano (snapshot **por ID**) |
| R40 | **Porta `3101` exposta** (se confirmada alcançável de fora) | ABERTO — fora do escopo de correção desta ordem; só recomendação |
| R41 | **Cadastro público restrito** impede criar a 2ª conta do S2 | ABERTO — depende de E |
| R42 | **Saída do roteiro 01C pode mencionar nomes de outras aplicações** (D1) | MITIGADO: não vão para o repositório; saída bruta fora do Git |

## 8. Procedimento exato para liberar a publicação controlada

Cada degrau exige autorização expressa própria; o detalhe e o texto sugerido da autorização do degrau 2 estão no anexo (§P5).

1. **Esta rodada (feita pelo proprietário):** rodar o roteiro 01C e devolver a saída → a Executora publica a **versão 1.1.0** deste relatório (A–E preenchidos, estados fechados).
2. **Decisões do proprietário:** (a) **T1**: que logs do GATE-DB-42501 precisam sobreviver e se o T1 já foi coletado; (b) **segunda conta** de workspace para o S2 (depende de E); (c) janela e quem opera; (d) D8 (SHA no endpoint) e item "Intelligence" no menu.
3. **P04-REL-02A — Preservação e backup:** P1 (logs), P2 (dump por papel com leitura total) e P3 (restauração de teste em container descartável sem rede). Escreve **só** em `/opt/backups/p04-rel`; **não** toca serviço do projeto. Fecha REL-08 e REL-10.
4. **P04-REL-02B — Publicação controlada (Estratégia D):** D0–D7 do plano (v1.1.0): snapshot **por ID**, `git fetch` (ou `bundle`) do SHA `cebbfa6` para a árvore, build **só** de `api` e `web`, recriar `api` e depois `web`, provar `StartedAt` dos demais. Fecha REL-03/09. **Só com os gates REL-01/03/04/05/06/07/08/09/10/11/12 em `PASS`.**
5. **P04-REL-02C — Smoke e aceitação:** S0–S4; S2 com duas contas; aceitação ou rollback.
6. **Decisão do PR #7** (tirar do rascunho e mesclar) **somente depois** da aceitação.

**Nada acima é automático.** Se qualquer gate falhar, a Executora **para** e registra o bloqueio com a alternativa.

## 9. Ações que exigem autorização posterior

Executar P1/P2/P3; criar `/opt/backups/p04-rel`; criar o container descartável da restauração; ler `pg_roles` (pré-checagem do papel do dump) e o catálogo de migrations; `git fetch`/`bundle` e `checkout --detach` na árvore do servidor; build e etiquetas de imagem; recriar `api` e `web`; criar a segunda conta de teste; qualquer ação sobre a porta `3101` ou sobre o vhost do nginx; marcar o ambiente como teste; D8.

## 10. Estados

```text
P04_REL_01C_EXECUTION       = PARTIAL   (preparação completa; coleta A–E pendente do roteiro, sem canal da Executora)
P04_REL_01C_RESULT          = INCONCLUSIVE

IMAGE_HISTORY               = INCONCLUSIVE   (hipóteses H1–H3; nenhuma confirmada; pendente de coleta)
BACKUP_CANDIDATES           = PARTIAL        (2 dumps de setembro, classe C; pastas dbrem04/06 pendentes)
BACKUP_RESTORE_TEST         = NOT_EXECUTED
DB_42501_LOG_PRESERVATION   = PLAN_ONLY
DB_42501_T1_STATUS          = NOT_VERIFIED
PORT_3101_IDENTIFICATION    = NOT_IDENTIFIED (pendente de coleta)
NGINX_REGISTER_ROUTE        = NOT_INSPECTED  (bloco existe na linha 67; conteúdo pendente)

STAGING_ISOLATION           = FAIL
PRODUCTION_DEPLOY           = NO
MERGE_EXECUTED              = NO
SERVICE_RESTARTS            = 0
DATABASE_MUTATIONS          = 0

NEXT_STEP                   = AWAIT_OWNER_APPROVAL   (o proprietário roda o roteiro 01C e devolve a saída; decisões do §8)
```

`PRODUCTION_DEPLOY = NO` e `MERGE_EXECUTED = NO`: nada foi publicado nem mesclado. `OTHER_STACKS_MODIFIED = 0`. Pendências preservadas e **não** executadas: `SEC-DATA-01 = OPEN / NOT_EXECUTED`, `GATE-DB-42501 = OPEN`, `SEC-DB-02 = NOT_STARTED`.
