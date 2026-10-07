# S0-FORENSICS — o evento de 11/08/2026 no ambiente online

**Data da apuração:** 25/09/2026
**Escopo:** autenticações não reconhecidas no tenant `layart-demo`, servidor `108.174.144.216`.
**Método:** somente leitura. Nenhuma escrita no banco, nenhuma alteração de container.
**Classificação do evento:** `UNRECOGNIZED_AUTHENTICATION ACTIVITY / SUSPECTED_CREDENTIAL_COMPROMISE`.

> **Por que não "acesso alheio confirmado".** O que existe é um `userAgent` de
> Android (Pixel 9) que o dono do projeto não reconhece. `userAgent` é campo
> enviado pelo cliente e não identifica pessoa nem dispositivo. A ausência de IP
> real (§3) impede atribuição. Suspeita fundamentada não é comprovação, e este
> documento não a promove a comprovação.

---

## 1. Fatos medidos

### 1.1 A credencial

O `.env.example` do repositório — **público** — contém e-mail e senha de
demonstração funcionais no ambiente online. OWNER e SDR compartilham o mesmo
`passwordHash` (impressão `md5` idêntica nas duas linhas): o seed grava um hash
único para os dois. A senha do repositório abre as duas contas.

> **Causa confirmada em 07/10/2026, lendo `2c901f2:prisma/seed.ts`.** Não era
> coincidência de hash: o seed calculava **um** `argonHash` a partir de
> `SEED_OWNER_PASSWORD` e gravava o **mesmo** `passwordHash` em todos os usuários
> do laço, no `create` e também no `update` do `upsert`. Detalhe medido junto:
> `SEED_SDR_PASSWORD` não determinava senha alguma — aparecia só no `console.log`
> que anunciava as credenciais. O ambiente anunciava uma credencial de SDR que
> não existia. Ver §5.

#### Acréscimo de 28/09/2026 — uma terceira cópia, no `.env.production`

Medição de pré-voo no servidor `108.174.144.216`, em `/opt/apps/prospectai`, com
o repositório local no commit `2c901f2` — o mesmo de que as imagens em produção
foram construídas. As variáveis `SEED_OWNER_PASSWORD` e `SEED_SDR_PASSWORD`
**existem** no `.env.production` e foram comparadas, valor a valor, com as duas
linhas homônimas do `.env.example` daquele commit:

```
publicado_owner_nao_vazio=sim  publicado_sdr_nao_vazio=sim
owner_match_publicado=sim      sdr_match_publicado=sim
```

Antes disso, a mesma medição já havia devolvido `owner_len=11 sdr_len=11
iguais=sim`. O procedimento está registrado no
`RUNBOOK-S1-ROTACAO-CREDENCIAIS.md §1.1`.

**Nenhuma senha e nenhum hash foram exibidos**, em nenhuma das duas medições:
saem do comando apenas comprimentos e booleanos, e nenhuma string secreta entrou
na linha de comando — portanto nada foi para o histórico do shell do servidor.

O que este fato é, com precisão:

- **É uma terceira cópia da credencial já publicada.** As duas primeiras são o
  `.env.example` do repositório público e o `passwordHash` no banco. Esta está em
  arquivo no servidor.
- **O seed usa essas variáveis apenas no `create` do upsert.** As duas contas já
  existem no banco; rodar `pnpm db:seed` hoje não grava essas senhas em ninguém.
- **O arquivo não é o mecanismo de autenticação.** Quem autentica é o
  `passwordHash` da tabela `users`. Apagar essas duas linhas do `.env.production`
  não fecharia o acesso, e trocá-las também não — isso é trabalho do `pnpm
  db:senha` (`RUNBOOK §3`), que continua sendo um passo **separado**.
- **Mas o valor armazenado coincide com uma credencial funcional**, e funcional
  está comprovado por este próprio documento: é a mesma senha da §1.1 acima, que
  abre as duas contas.
- **A classificação do evento não muda.** Continua
  `UNRECOGNIZED_AUTHENTICATION ACTIVITY / SUSPECTED_CREDENTIAL_COMPROMISE`. Uma
  cópia a mais de uma credencial que já era pública amplia a superfície de
  exposição; não acrescenta nenhuma evidência sobre quem autenticou em 11/08, que
  é o que a classificação descreve.

### 1.2 As autenticações de 11–12/08

12 linhas em `refresh_tokens` para `owner@demo.propectai.local` na janela:

| Criado | userAgent | Revogado | Substituto |
|---|---|---|---|
| 11/08 18:12:25 | Windows/Chrome | não | não |
| 11/08 22:14:52 | Windows/Chrome | não | não |
| 11/08 22:14:56 | Windows/Chrome | não | não |
| **11/08 22:18:24** | **Android Pixel 9** | não | não |
| **11/08 22:18:30** | **Android Pixel 9** | não | não |
| **11/08 22:18:39** | **Android Pixel 9** | não | não |
| 11/08 22:22:18 | Windows/Chrome | não | não |
| 11/08 22:22:19 | Windows/Chrome | não | não |
| 11/08 22:22:26 | Windows/Chrome | não | não |
| 11/08 22:41:55 | Windows/Chrome | 12/08 11:28:00 | sim |
| 12/08 11:28:00 | Next.js Middleware | 12/08 12:41:47 | sim |
| 12/08 12:41:47 | Next.js Middleware | 18/08 13:40:25 | sim |

**O que cada linha é, e o que ela não prova.** Cada linha é uma **emissão de
refresh token**. Ela **não** identifica a origem da emissão: `issueTokens` é
chamado tanto pelo `login` quanto pela rotação em `rotateRefreshToken`, e nos
dois casos a linha nova nasce sem `revokedAt` e sem `replacedBy` — só a linha
*anterior* recebe esses dois campos quando é rotacionada.

> **Correção registrada (25/09).** A primeira versão deste documento afirmava
> "9 logins" com base na ausência de `revokedAt`/`replacedBy`. O critério estava
> errado: ele não distingue login de renovação. A contagem de logins **não é
> determinável** a partir desta tabela sem cruzar `replacedBy` com `tokenHash`.

Portanto: **12 emissões de refresh token** na janela, das quais **3 carregam o
agente Android (Pixel 9)**, em 15 segundos (22:18:24, :30, :39), entre emissões
com agente Windows/Chrome. As três últimas linhas são **compatíveis com uma cadeia de
rotação** (revogação e substituto presentes, em sequência), iniciada em
22:41:55 — compatível, e não verificada: o cruzamento `replacedBy` → `tokenHash`
não foi executado.

**Medição ainda possível, não executada:** as cadeias podem ser reconstruídas
juntando `replacedBy` de uma linha com `tokenHash` de outra, o que separaria
emissões de login das de rotação sem imprimir nenhum hash. Isso não altera a
classificação do evento nem o estado atual (todas expiradas), e por isso não foi
tratado como bloqueio.

**Estado atual dessas linhas:** todas expiraram em 18/08 ou 19/08. Nenhuma delas
concede acesso hoje.

**Uma única linha válida no sistema inteiro**, de 22/09 11:59, expirando em
29/09 11:59. Isto vem de contagem **global**, sem filtro de usuário —
`SELECT count(*) FILTER (WHERE "revokedAt" IS NULL AND "expiresAt" > now())
FROM refresh_tokens` devolveu `1` sobre 118 linhas (23 revogadas, 94 expiradas).
A atribuição dessa linha ao OWNER vem da mesma consulta agrupada por e-mail.

### 1.3 A trilha de auditoria

Esquema de `audit_logs`: `tenantId`, `actorId`, `action`, `entityType`,
`entityId`, `before`, `after`, `ipAddress`, `userAgent`, `createdAt`,
`actorPseudonym`. RLS forçado, com política de isolamento por tenant.

**Linhas na janela 11/08 18:00 → 12/08 06:00: zero.**

O que o sistema efetivamente audita, medido por varredura das escritas
(`tx.auditLog.create`) no código da API:

| Domínio | Auditado |
|---|---|
| `auth` | **registro de conta** (`register`) |
| `account` | preferências, segmento, onboarding, recálculo de score |
| `team` | convite, aceite, troca de papel, remoção |
| `leads` | **exportação** (com contagem em `PlanUsage`) |
| `audits` | pedido de auditoria, emissão |
| `prospecting` | criação de busca |
| `proposals` | criação, envio, mudança de status |
| `billing` | plano, assinatura, faturas |
| `admin` | operações do painel do provedor |
| `privacy` | pseudonimização do ator |

**O que NÃO é auditado:** `login`, `logout`, `refresh`, e **toda leitura** —
abrir lead, listar pipeline, ver relatório de diagnóstico, navegar no painel.

> **Consequência metodológica.** Zero linhas na janela significa **"nenhuma das
> ações auditadas ocorreu"**, e nada além disso. Leitura de dados de lead é
> invisível por desenho. Este documento não afirma que nada foi lido.
>
> O negativo que a trilha **sustenta**: exportação de leads é auditada e
> contabilizada em `PlanUsage`; não há linha de exportação na janela. Portanto
> não houve exportação pelo caminho auditado.

### 1.4 `S0-NET-01` — o gateway está publicado na internet (HIGH)

**Fato medido:** a porta 3102 escuta em `0.0.0.0` e `[::]`, publicada por
`docker-proxy`, **sem passar pelo nginx do host**. O mesmo servidor tem nginx em
80/443 servindo 17 vhosts de negócios de terceiros.

**Consequência:** existe uma superfície pública paralela. Tudo o que o gateway
serve — a aplicação inteira, incluindo `/auth/login` e `/auth/register` — é
alcançável direto pelo IP, fora de qualquer política que o nginx do host aplique
(TLS, cabeçalhos, limites, logs). É por esse caminho que o ambiente é usado hoje.

**Severidade: HIGH.** Não pela existência do serviço, e sim por ele estar exposto
sem a camada onde as políticas do servidor vivem — num host que abriga negócios
de terceiros.

**Proposta, para depois e com plano de acesso:**
`Internet → nginx do host (443, TLS) → gateway em interface local/privada`,
removendo a publicação pública do 3102. **Não executar agora:** hoje o acesso ao
ambiente é exatamente esse, o domínio não resolve, e fechar a porta antes de o
caminho por HTTPS existir derruba o único acesso. Depende do gate de domínio.

> **Decisão D3**, registrada na §11 do `RUNBOOK-S1-ROTACAO-CREDENCIAIS.md`
> (escolhida pelo dono do projeto em 25/09/2026, entre duas opções; a recusada
> foi manter o `GATE_S0` aberto até a 3102 sair de `0.0.0.0`). Este achado passa
> a ser rastreado como **`GATE_NET`**, gate próprio, atrelado ao gate de domínio
> — e **deixa de bloquear o `GATE_S0`**. A fronteira exata está na §4.
>
> A razão é de escopo, não de gravidade: o `GATE_S0` apura e remedia **um
> incidente de credencial**, e a exposição da 3102 é anterior a ele, independente
> dele, e só se resolve por uma decisão de domínio e nome do produto que ainda
> não foi tomada. Amarrar um ao outro deixaria o incidente de credencial aberto
> por um motivo que não é o dele. **`GATE_NET = OPEN`, severidade HIGH — e a
> severidade não é rebaixada por ter mudado de gate.**

### 1.5 Identidade da rede (provada, não inferida)

Rede `prospectai-prod_internal`, driver `bridge`, escopo local:

| Container | IP |
|---|---|
| `prospectai-prod-gmaps-scraper-1` | 172.21.0.2 |
| `prospectai-prod-postgres-1` | 172.21.0.3 |
| `prospectai-prod-redis-1` | 172.21.0.4 |
| `prospectai-prod-worker-1` | 172.21.0.5 |
| `prospectai-prod-api-1` | 172.21.0.6 |
| **`prospectai-prod-gateway-1`** | **172.21.0.7** |
| **`prospectai-prod-web-1`** | **172.21.0.8** |

As autenticações de 11/08 registram `172.21.0.8` — **o container da web**.
As rotações de 12/08 registram `172.21.0.7` — **o gateway**.

### 1.6 Cadeia de proxies (medida)

- **Porta 3102:** `docker-proxy`, `0.0.0.0` e `[::]` — publicação do container
  `gateway`.
- **Portas 80 e 443:** `nginx` **do host**, com 17 vhosts de negócios distintos,
  entre eles `app.prospectai.com.br.conf` — o único arquivo do host que
  referencia `3102`.

Duas cadeias possíveis, e elas têm profundidades diferentes:

```
A (em uso hoje)   navegador -> host:3102 (docker-proxy) -> gateway(nginx) -> api
B (pelo domínio)  navegador -> host:80/443 (nginx do host) -> 127.0.0.1:3102 -> gateway(nginx) -> api
```

O nginx do gateway já envia `X-Forwarded-For`. O que **não** está medido é qual
IP chega ao gateway em cada cadeia — com `docker-proxy` no caminho, o endereço
de origem pode ser o do bridge e não o do visitante.

> **Decisão suspensa, de propósito.** `trust proxy` só pode ser configurado
> depois de medir o `remote_addr` real que chega ao gateway em cada cadeia. O
> valor correto é o **número de saltos confiáveis**, e ele muda entre A e B.
> `trust proxy = true` genérico é recusado: ele faria a aplicação confiar em
> qualquer `X-Forwarded-For` recebido, inclusive forjado.

---

## 2. Inferências (marcadas como tais)

1. **Provável, não provado:** as 9 emissões de 11/08 vieram de uma tela de login
   usada repetidamente, e não de 9 pessoas. Três logins em 15 segundos com o
   mesmo agente é padrão de tentativa repetida.
2. **Provável, não provado:** a origem `172.21.0.8` (web) nas emissões de 11/08
   e `172.21.0.7` (gateway) nas de 12/08 reflete dois caminhos de código
   distintos para chamar a API — servidor da web e cliente via gateway. Não foi
   verificado no histórico do código.
3. **Não determinável com os dados atuais:** quem operou o agente Android.

## 3. Lacunas de observabilidade encontradas

| # | Lacuna | Efeito |
|---|---|---|
| 1 | IP real do cliente não é registrado | inviabiliza atribuição de qualquer acesso |
| 2 | `login`, `logout` e `refresh` não geram AuditLog | autenticação só é visível pela tabela de tokens |
| 3 | Leituras não são auditadas | impossível saber o que foi visto |
| 4 | `isActive` não é verificado na rotação nem na sessão | desativar conta não encerra acesso |
| 5 | Cadastro público (`/auth/register`) em ambiente exposto por IP | qualquer um cria conta e workspace |
| 6 | `S0-NET-01`: 3102 público em paralelo ao nginx do host | aplicação exposta fora da camada de políticas |

## 5. Remediação — 28/09 a 07/10/2026

Esta seção registra o que foi feito e o que foi medido. Ela **não** altera a
classificação do evento de 11/08: continua
`UNRECOGNIZED_AUTHENTICATION ACTIVITY / SUSPECTED_CREDENTIAL_COMPROMISE`. Nada
do que se apurou na remediação transformou suspeita em invasão comprovada.

### 5.1 Achados abertos durante a remediação

| id | O que é | Estado |
|---|---|---|
| `S0-AUTH-01` | suspeita de que a verificação de senha não rejeitava senha incorreta | **RETIRADO** |
| `S0-CRED-02` | OWNER e SDR compartilhavam a mesma credencial | **REMEDIATED** |
| `S0-SEED-01` | o `update` do `upsert` do seed regravava `passwordHash` | **HISTORICAL_DEFECT / ALREADY_REMEDIATED** no HEAD `56958dd` |
| `S0-SEED-02` | `SEED_SDR_PASSWORD` não controlava a senha real do SDR | **HISTORICAL_DEFECT / ALREADY_REMEDIATED** no HEAD `56958dd` |

**`S0-AUTH-01` — levantado e retirado no mesmo dia.** Em 29/09, duas senhas
inventadas autenticaram o OWNER numa sonda interna, enquanto um e-mail
inexistente era recusado. O gateway foi parado por precaução. A leitura de
`auth.service.ts` mostrou `validateCredentials` correto — `argonVerify` com o
resultado usado, sem atalho de ambiente — e uma sonda com literal escrito pelo
operador devolveu `401` para as duas contas. A hipótese de bypass caiu; o que
havia era entrada contaminada no instrumento de teste. **Classificado como
retirado, não como corrigido: não havia defeito.**

**`S0-CRED-02` — causa e remediação.** A causa é o seed histórico (§1.1). A
remediação final, em 07/10, deu a cada conta uma credencial exclusiva, vinda do
gerenciador de senhas, nunca digitada em interface HTTP pública, com pré-teste
que recusava senha curta ou já em uso **antes** de ela chegar à CLI. A prova é a
matriz de `verify` da §9 do runbook.

**`S0-SEED-01` e `S0-SEED-02` são históricos.** Estão corrigidos no HEAD
aprovado, em `packages/types/src/seed-usuarios.ts`, `prisma/seed.ts` e **dez**
testes de regressão, em duas suítes, em
`packages/types/src/seed-usuarios.test.ts`. Não abrem
gate e não constam como risco atual.

### 5.2 Rotações de senha — nove eventos

Todos com `origem: "cli"`, `tenantId` nulo e sem hash na trilha.

| data/hora | conta | revogados | motivo registrado |
|---|---|---|---|
| 28/09 20:18:18 | OWNER | 1 | credencial publicada em `.env.example` |
| 28/09 20:19:08 | SDR | 0 | hash compartilhado com o OWNER |
| 29/09 18:12:11 | OWNER | 8 | separar credenciais e revogar sessões de teste |
| 29/09 18:12:54 | SDR | 4 | separar credenciais e revogar sessões de teste |
| 29/09 18:18:31 | OWNER | 0 | senha exclusiva do owner |
| 29/09 18:19:26 | SDR | 0 | senha exclusiva do sdr |
| **29/09 18:21:43** | **OWNER** | **0** | **`teste de canal - nao deve alterar`** |
| 29/09 18:25:00 | OWNER | 0 | senha exclusiva do owner |
| 29/09 18:30:07 | SDR | 0 | senha exclusiva do sdr |

**A linha de 18:21:43 precisa de contexto, e a trilha não será reescrita.** O
motivo registrado diz *"não deve alterar"* — e o comando **alterou** a senha do
OWNER. Um auditor lendo só aquela linha seria enganado pelo campo que existe
justamente para explicar a mudança.

O que aconteceu: um teste do canal de entrada da CLI foi enviado por cano com
duas linhas **diferentes**, na expectativa — **errada** — de que a dupla
digitação recusasse. O `set-senha.ts` não confirma fora do TTY; ele lê a primeira
linha e segue, e isso está escrito no cabeçalho do próprio arquivo. A senha do
OWNER passou a ser uma **credencial fraca conhecida**, de 12 caracteres, usada no
teste. O valor **não** é registrado aqui.

Mitigação e contenção, na mesma sessão operacional: o **gateway estava parado**,
portanto a API não era alcançável pela internet; a credencial fraca foi
substituída, quatro minutos depois, pela senha exclusiva e longa do OWNER, com
verificação por matriz de `verify`; e a credencial fraca não casa hoje com conta
nenhuma. A previsão errada foi da Executora, está nomeada como tal, e a §3.1 do
runbook passou a documentar os dois modos da CLI para que ninguém repita.

As rotações de 18:18, 18:19, 18:25 e 18:30 aparecem em pares porque as duas
primeiras receberam, por erro de operação, a **mesma** senha nas duas contas — o
que a matriz de `verify` detectou e as duas últimas corrigiram, já com o portão
de pré-teste. Nenhuma delas é incidente novo: são tentativas da **mesma**
remediação.

### 5.3 `JWT_ACCESS_SECRET` — cinco rotações, um único objetivo

Não são cinco incidentes. São cinco execuções da mesma remediação, quatro das
quais não produziram a evidência pretendida:

| # | quando | desfecho |
|---|---|---|
| 1 a 3 | 28/09, 20:22 / 20:42 / 20:51 | sem sessão controlada preparada antes da troca: `E6` não observável |
| 4 | 29/09, 12:17 | havia sessão, mas a sonda de depois rodou 16 min 56 s após a de antes, acima do TTL de 15 min do access token: resultado inválido |
| 5 | 07/10, 12:21 | **prova determinística**, com Bearer controlado: `200` → `401` → `200` |

O `401` só apareceu na quinta porque só nela o mesmo token foi reapresentado
dentro da validade, sem navegador no caminho. O refresh token é opaco e validado
contra o banco, então **não** é afetado por trocar o segredo de acesso — é essa
propriedade que anulou as quatro primeiras tentativas sem que nada estivesse
quebrado.

### 5.4 O que a remediação entregou, medido

- credenciais finais de OWNER e SDR **distintas entre si**, provadas por matriz
  de `verify` contra os dois `passwordHash`;
- credencial publicada em `2c901f2` **morta** nas duas contas, provada por sonda
  mecânica alimentada do histórico Git, sem exibir o valor;
- refresh tokens válidos revogados: OWNER `8 → 0`, SDR `4 → 0`;
- `JWT_ACCESS_SECRET` rotacionado, com invalidação provada;
- senha do Redis mascarada nos logs do container final: `1` mascarado, `0` em
  claro;
- Postgres e Redis **não recriados** em nenhuma das cinco rotações, verificado
  por `Created`/`StartedAt` idênticos desde 28/09.

### 5.5 Backups — aviso explícito de rollback

O `propectai.sql.gz` em `/opt/backups/prospectai-s0-THD4OPOl` é de 29/09, criado
**antes** da separação final das credenciais. Ele é
`PRE-REMEDIATION / FORENSIC BACKUP`. Restaurá-lo reintroduz o estado de
autenticação anterior, inclusive o compartilhamento OWNER/SDR. **Não é rollback
seguro de produção** sem a sequência de remediação descrita na §10 do runbook.

Existem ainda seis cópias de `.env.production` no mesmo diretório, com segredos
reais — entre eles credencial de banco ainda válida. Estão `600 root:root` em
diretório `700 root:root`. Não foram apagadas, e a política de retenção fica
registrada como dívida `BACKUP_SECRET_RETENTION`.

### 5.6 O que a remediação **não** fechou

As senhas finais de OWNER e SDR **nunca atravessaram** a interface HTTP pública.
Enquanto o `GATE_NET` estiver aberto, usá-las em `http://108.174.144.216:3102`
— HTTP simples, `COOKIE_SECURE=false` — as expõe em claro e desfaz essa
propriedade.

---

## 4. O que este documento não cobre, e onde ficam as fronteiras

Não cobre o procedimento de remediação, que está em
`RUNBOOK-S1-ROTACAO-CREDENCIAIS.md`, escrito em 25/09/2026 e **executado entre
28/09 e 07/10/2026**. O resultado medido está na §5 deste documento e na §9 do
runbook. Até 07/10 esta linha dizia "ainda não executado", e descrevia
corretamente o estado daquela data.

**Estado dos gates:**

| Gate | Estado | Cobre | Fecha quando |
|---|---|---|---|
| `GATE_S0` | **`PASS`** em 07/10/2026 — `S0_DISCOVERY = PASS`, `S0_REMEDIATION = PASS` | o incidente de credencial: §1.1, §1.2, §1.3 | fechou: as evidências **E1–E9** da §9 do runbook estão coletadas e coladas |
| `GATE_NET` | **`OPEN`**, HIGH | `S0-NET-01` (§1.4): a 3102 publicada em `0.0.0.0` | houver caminho por HTTPS num nome que resolva, e a publicação pública sair |

**As lacunas de observabilidade da §3 não pertencem a nenhum dos dois.** A 1, a 2
e a 3 são dívida de produto — a próxima apuração terá exatamente os mesmos
limites que esta teve enquanto elas existirem. A 4 foi fechada em `12095da`
(`isActive`/`deletedAt` passaram a valer na emissão, na rotação e na sessão). A 5
— cadastro público num ambiente alcançável por IP — segue com o `GATE_NET`,
porque é a mesma superfície.

**O que fechar o `GATE_S0` significa, e o que não significa.** Significa: a
credencial publicada foi girada e há prova disso. **Não** significa que o
ambiente esteja fechado, que se saiba o que foi lido em 11/08, nem que a origem
da fuga tenha sido apagada — o `.env.example` corrigido não remove a senha do
histórico público do repositório, que é imutável.
