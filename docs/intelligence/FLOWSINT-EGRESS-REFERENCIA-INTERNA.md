# Adendo aos Prompts 03A e 03B — a egress policy já tem implementação de referência dentro de casa

**Status:** Informativo · 17/09/2026
**Origem:** leitura dos prompts `PROMPT-03A-FLOWSINT-SOURCE-LICENSE-CAPABILITY-SECURITY-AUDIT-v1.0.0` e `PROMPT-03B-FLOWSINT-RUNTIME-ISOLATION-v1.0.0` contra o código deste repositório
**Desbloqueia:** **nada.** Os dois prompts continuam travados nos respectivos gates de entrada — ver §7

**Declaração obrigatória (`CLAUDE.md`, Qualidade):** `F:\drmind` não foi modificado. Nenhum recurso Docker foi tocado. Nenhuma alteração fora de `docs/`.

---

## 1. Por que este documento existe

O Prompt 03B descreve uma arquitetura de isolamento para um runtime Flowsint e trata a egress policy como trabalho a fazer. O Prompt 03A, que o antecede, pede uma auditoria de SSRF e de crawler no código de terceiro.

Nenhum dos dois sabia — não tinha como saber — que **o ProspectAI já construiu e provou a peça mais difícil que eles pedem**, por um motivo próprio e anterior: a auditoria de presença digital busca `Lead.website`, que é uma string controlada por terceiro, e isso é SSRF por desenho (`ADR-004`, "Contexto").

Este adendo registra a correspondência, medida, e registra também **onde ela não existe** — que é a parte que impede o documento de virar autoelogio.

---

## 2. A medição

Contagem feita em 17/09/2026, por declaração de teste (`it(` / `test(`) nos arquivos, e não por memória:

| Arquivo de teste | Testes | Módulo que exercita | Bytes |
|---|---:|---|---:|
| `apps/worker/test/egress-guard.spec.ts` | **28** | `apps/worker/src/egress/guard.ts` | 4 870 |
| `apps/worker/test/egress-ip-ranges.spec.ts` | **25** | `apps/worker/src/egress/ip-ranges.ts` | 9 828 |
| `apps/worker/test/egress-limites.spec.ts` | **15** | `apps/worker/src/egress/limites.ts` | 6 430 |
| `apps/worker/test/egress-fetcher.spec.ts` | **15** | `apps/worker/src/egress/fetcher.ts` | 8 461 |
| `apps/worker/test/egress-transporte.spec.ts` | **32** | `apps/worker/src/egress/transporte.ts` | 8 969 |
| **Total** | **115** | 5 módulos, 38 558 bytes de código | |

A suíte completa do worker rodou verde hoje — **13 arquivos, 214 testes**. Os 115 acima são 5 desses 13 arquivos.

Documentos que governam esses módulos, todos já commitados:

- `docs/intelligence/SECURITY-EGRESS-POLICY.md` (v1), `-v2.md`, `-v3.md`
- `docs/intelligence/adr/ADR-004-processo-de-fetch-isolado.md`

**O histórico importa mais que o total.** A v1 da política foi escrita com cuidado e um único revisor encontrou **seis contornos**; o ADR-004 achou um sétimo na v2 (portas do host em vez de nomes de serviço). A v3 é a tabela depois de sete erros conhecidos — e cada um deles tem hoje um teste nomeado. É por isso que o número que interessa não é 115, é *sete*.

---

## 3. Mapa — 03B §18 (Egress Policy)

O §18 pede, literalmente: bloquear `127.0.0.0/8`, `::1`, RFC1918, link-local, endereços de metadados de nuvem, control plane e bancos do ProspectAI, redes internas de gestão — *"considerar IPv6 equivalents"*.

`apps/worker/src/egress/ip-ranges.ts` é essa lista em código, com 15 faixas IPv4 e 11 faixas IPv6:

| Pedido do §18 | Onde está | Teste |
|---|---|---|
| `127.0.0.0/8` | `v4('127.0.0.0/8', 'LOOPBACK')` | `S1 loopback :80`, `S1 loopback nome` |
| `::1` | `::1/128` → `LOOPBACK` | `reporta ::1 como loopback, nao como IPv4-compativel` |
| RFC1918 | `10/8`, `172.16/12`, `192.168/16` | `bloqueia loopback, privadas e CGNAT` |
| link-local | `169.254.0.0/16`, `fe80::/10` | `S2 metadados`, `recusa link-local com interface` |
| metadados de nuvem | `169.254/16` **e `fc00::/7`**, que contém `fd00:ec2::254` | `S2b IMDS IPv6`, `bloqueia o IMDS da AWS por IPv6` |
| *"IPv6 equivalents"* | `2001:db8::/32`, `2001:2::/48`, `100::/64`, `fec0::/10`, `ff00::/8` | `bloqueia os analogos IPv6 das faixas reservadas` |

E **três coisas que o §18 não pede e que a experiência daqui mostrou serem necessárias**:

1. **Normalização antes da comparação.** `::ffff:127.0.0.1` é loopback escrito em IPv6: escapa da tabela IPv4 por ser IPv6 e da IPv6 por não estar em nenhuma faixa IPv6 bloqueada. Fica no vão entre as duas. Uma lista literal como a do §18 tem esse furo por construção.
2. **NAT64 (`64:ff9b::/96`) e 6to4 (`2002::/16`)**, que carregam IPv4 embutido em posição diferente da mapeada — dois dos seis contornos originais.
3. **Ordenação por especificidade.** `255.255.255.255` casa em `240.0.0.0/4` e sairia no log como `RESERVADO` em vez de `BROADCAST`. Não muda a decisão; envenena o único lugar onde o motivo sobrevive.

### Onde a correspondência **não** existe

O §18 pede `ALLOW APPROVED PUBLIC DESTINATIONS/CATEGORIES` — uma **allowlist** de destinos públicos. O ProspectAI faz o contrário: nega faixas internas e permite o resto da internet pública.

**E não é descuido: para o caso de uso daqui, allowlist de destino é impossível.** A URL auditada é o site do cliente, cadastrado por ele no Google Maps; o conjunto de destinos legítimos é exatamente "todos os sites do mundo menos os internos". Para um runtime Flowsint a conta é outra — o conjunto de destinos é o catálogo de enrichers, que é finito e conhecido —, então **a allowlist do §18 continua sendo trabalho novo**, e a tabela de faixas daqui seria o piso, não o teto.

---

## 4. Mapa — 03B §19 (DNS / Redirect / SSRF)

O §19 lista sete exigências. As sete têm implementação e teste:

| Exigência do §19 | Implementação | Teste |
|---|---|---|
| resolver hostname | `validarUrl` recebe `Resolvedor` injetado | `S3 nome resolve para privado` |
| validar IP resultante | `avaliarEndereco` sobre **todos** os endereços retornados | `S3b publico + privado`, `S3b ordem invertida` |
| bloquear ranges internos | tabela do §3 | 25 testes em `egress-ip-ranges` |
| revalidar em redirects | `validarUrl` roda **em cada salto**, dentro do laço de `buscar()` | `S4 — recusa redirect de publico para loopback`, `o guard revalida no ultimo salto, nao so nos primeiros` |
| limitar redirect count | `MAX_SALTOS = 5` | `corta acima de cinco saltos`, `a cadeia de quatro saltos do gov.br chega ao corpo` |
| tratar DNS rebinding | **estrutural**: o `guard` devolve o IP e o transporte conecta com `lookup` fixo, `agent: false` — não há segunda resolução entre validar e conectar | `conecta mesmo com hostname que nao resolve`, `o Host e o nome, nunca o IP` |
| protocolos aprovados | `SCHEMES = {http:, https:}`, `PORTAS = {80, 443}` | `S7 file://`, `S7 gopher://`, `S7 dict://`, `S7b porta isolada 6381` |

O §19 fecha com *"testar somente com fixtures locais e ambientes controlados"*. É exatamente o que `egress-transporte.spec.ts` faz: 32 testes sobre socket real contra servidor local.

**O item mais interessante é o do rebinding**, porque o §19 escreve *"onde possível"* — e aqui foi possível por uma decisão de desenho, não por esforço extra: `guard.ts` deliberadamente **não conecta**. Ele devolve o endereço para quem conecta. A janela entre validar e conectar, que é onde o rebinding vive, deixa de existir porque não há segunda consulta que possa devolver outra coisa.

Uma escolha de mesmo tipo está em `agent: false`: duas buscas para o mesmo nome podem ter validado IPs diferentes, e socket reaproveitado mandaria a segunda para o destino da primeira — **burlando a validação sem que nada parecesse errado**.

---

## 5. Mapa — 03A §32 (SSRF Audit) e §33 (Crawler Audit)

O §32 pede auditar tudo que *"recebe URL, faz HTTP GET, crawl, segue redirect, resolve hostname"* contra nove ameaças. As nove estão cobertas pelos §3 e §4 acima, com uma nota: `URL malformada` não é só o `try/catch` do construtor — `paraUint32` recusa `01`, `1e2`, `+1` e vazio, formas que alguns parsers aceitam e interpretam diferente.

O §33 (crawler) é onde a correspondência fica **parcial**, e a tabela registra os dois lados:

| Item do §33 | Situação no ProspectAI |
|---|---|
| timeout | `TIMEOUT_REQUISICAO_MS = 10 000`, `ORCAMENTO_JOB_MS = 30 000`. **Prazo único cobrindo corpo**, não timeout de ociosidade — ociosidade não pega o servidor que manda um byte a cada 9 s |
| redirects | `MAX_SALTOS = 5`, revalidado salto a salto |
| content length | `TETO_COMPRIMIDO = 5 MB` **e** `TETO_DESCOMPRIMIDO = 10 MB` — dois tetos, porque medem coisas diferentes: um protege banda e tempo, o outro protege memória |
| decompression | gzip, deflate, br; aninhado e desconhecido recusados; corte **no fluxo**, não depois |
| resource exhaustion | `S6b — bomba de gzip`, em vários tamanhos, com asserção de heap |
| protocols | http/https apenas |
| user-agent | `PropectAI-SiteAudit/1.0` — identificação honesta |
| JS execution | **não existe**: o fetcher é `node:http`, o corpo são bytes. Nenhum navegador no caminho |
| downloads | **não existem**: o corpo fica em memória sob teto |
| depth, pages | **sem correspondência, e por ausência de função**: isto não é um crawler. Busca uma URL, segue redirects, lê um corpo. Não há profundidade a limitar |
| rate limits | **lacuna medida.** Não há limite de taxa no módulo de egress. O que existe é concorrência de fila (`concurrency` em `apps/worker/src/index.ts`), que limita jobs simultâneos, não requisições por domínio |
| robots policy | **lacuna medida.** `scope-v0.2.md` §8 menciona `robots.txt`; **a palavra `robots` não aparece em nenhum arquivo de `apps/worker/src`** — os 22 arquivos da árvore, verificados hoje |

As duas últimas linhas são achados deste adendo, não da leitura dos prompts.

---

## 6. O que ainda falta, e é a metade que não é código

O `ADR-004` decidiu em duas partes. **A Parte 1 está feita** — a busca nasceu atrás de um contrato, `FETCHER_MODE=inline`, custo zero. **A Parte 2 está `Deferred`**: o fetcher como quinto serviço, em rede própria, sem `DATABASE_URL` e sem `REDIS_URL`.

A frase do ADR-004 que resume por que isso importa: **"Código valida; rede impede."** Hoje só a primeira metade existe.

E há um fato novo desde que o ADR foi escrito. Ele diz, em 22/08:

> **A pasta `infra/docker/` não existe.** […] `docker compose --profile full up` falha na largada.

Verificado hoje: **`infra/` continua contendo apenas `scripts/audit-ambiente.ps1`**. Mas o ambiente online medido ontem tem sete containers `prospectai-prod-*` no ar desde 05–11/08/2026, com `/api/v1/health` respondendo. As duas coisas são verdadeiras ao mesmo tempo, e a conciliação é uma pergunta aberta que este documento **registra e não responde**: de onde vieram as imagens que rodam lá, já que o repositório de lá não tem commits e o daqui não tem os Dockerfiles.

O que dá para afirmar sem medir mais nada: a condição 1 da Parte 2 do ADR-004 — *"os três Dockerfiles de `infra/docker/` existirem"* — **não está satisfeita neste repositório**.

Vale registrar também o que os próprios módulos dizem de si. `guard.ts`:

> *"**Isso prova a lógica, não a rede** — a própria política avisa que teste contra resolvedor falso passa trivialmente, e o teste com resolução real fica no checklist de deploy."*

E `transporte.ts`, sobre o handshake TLS real: a tabela de erros é exercitada com erros sintéticos; *"o handshake de verdade fica no checklist de primeiro deploy, junto das outras provas que só a rede dá"*.

**115 testes verdes não são 115 provas de rede.** São a prova de que a lógica está certa, mais 32 provas sobre socket real contra servidor local.

---

## 7. O que este documento não muda

Os dois prompts continuam travados, e o adendo não mexe nisso:

```text
Prompt 02  → 11 de 12 componentes ausentes do código
             (ProviderRouter, ProviderRegistry, SelectionPolicy, ProviderHealth,
              Waterfall, CostGuard, RawSnapshot, EntityResolution, FieldLineage,
              SchemaDrift, Quarantine — só "Evidence" aparece, e como palavra)
Prompt 03A → §2 exige PROMPT_02_GATE = PASS  →  BLOCKED_BY_PROMPT_02
Prompt 03B → §2 exige PROMPT_03A_GATE = PASS →  BLOCKED_BY_PROMPT_03A
```

E há uma decisão anterior aos dois: **o 03A §75 (Capability Gate) decide *se* o Flowsint entra**; o 03B descreve *como* isolá-lo depois que entrou. Um diagrama de isolamento não responde à pergunta do §75.

---

## 8. As duas consequências — e uma correção minha

**Primeira.** A exigência mais difícil do 03B (§18 e §19) é demonstravelmente alcançável neste código, porque foi alcançada uma vez, por um motivo próprio, com sete erros encontrados e corrigidos no caminho. No dia em que o §75 for respondido com "sim", o ponto de partida do isolamento de rede não é zero — é `ip-ranges.ts` mais a lista de sete contornos conhecidos.

**Segunda, e é a correção.** Eu disse, ao ler o 03B, que este achado *"muda a aritmética que o ADR-002 fez"*. **Está errado, e a imprecisão importa.** A aritmética do ADR-002 é de custo operacional — Neo4j, Celery, FastAPI e um Redis adicional contra um teto de 4 serviços — e nada aqui remove um serviço dessa conta. O que este adendo muda é outra coisa: **o custo estimado do trabalho de isolamento**, que o 03B trata como projeto inteiro e que aqui tem precedente aproveitável. São dois números diferentes, e misturá-los é o mesmo tipo de erro que esta semana já produziu duas vezes — ler uma coisa e relatá-la como outra.

O `ADR-002` segue válido pelos motivos que ele mesmo dá: a única área de força do Flowsint que o produto não cobre é a de dados pessoais, e é a que a regra 6 proíbe. Este documento não reabre o ADR-002. Reabri-lo depende dos gatilhos que ele lista — e um deles, o nº 2 (*"o projeto cortar release nova com suíte de testes completa"*), disparou **pela metade**: releases novas existem (v1.2.11 de 01/07/2026, v1.2.12 de 26/08/2026), a suíte continua declarada incompleta no README da v1.2.12. A medição está no `THIRD_PARTY_FLOWSINT.md` §1 e a consequência na seção "Correção de fato" do `ADR-002`.

> Quando esta seção foi escrita, no dia 17/09/2026, ela dizia que o gatilho *"está registrado à parte"* — **e não estava**. Era promessa escrita como fato, que é o defeito que o §8 abaixo acusa. O registro foi feito no mesmo dia, e esta frase substituiu a anterior.

---

## 9. Quando reler este documento

1. No dia em que o 03A §75 (Capability Gate) for respondido — este adendo é entrada dele, não saída
2. No dia em que a Parte 2 do ADR-004 sair de `Deferred` — a rede de egress do fetcher e a do runtime Flowsint são o mesmo desenho, e construir duas vezes seria desperdício
3. Se a `SECURITY-EGRESS-POLICY` ganhar uma v4 — a contagem de 115 e a lista de sete contornos envelhecem juntas
4. Se as duas lacunas do §5 (rate limit e `robots.txt`) forem fechadas — são trabalho do produto, independente do Flowsint
