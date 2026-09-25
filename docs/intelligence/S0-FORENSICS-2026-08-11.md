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

## 4. O que este documento não cobre

Não cobre a remediação. `GATE_S0` permanece `OPEN`:
`S0_DISCOVERY = PASS`, `S0_REMEDIATION = PENDING`.
