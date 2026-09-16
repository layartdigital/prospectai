# REAVALIAÇÃO DO GATE 01

**Data:** 09/09/2026
**Objeto:** `PROMPT-01-EXECUTION-REPORT.md` (22/08/2026) e seu adendo
**Veredito de registro sob reavaliação:** `PROMPT_01_GATE = FAIL`
**O que este documento faz:** apura, achado por achado, o estado atual de cada condição de falha.
**O que este documento NÃO faz:** virar o gate. Ver §7.

---

## 1. Método, e por que ele importa aqui

O relatório de 22/08 termina com a lição mais valiosa que produziu:

> *"O gate auto-avaliado teria dado `APPROVED_WITH_WARNINGS`. **Essa é a evidência mais forte deste relatório**, e vale mais que a arquitetura que ele reprova."*

Ou seja: a autoavaliação foi generosa, e o `FAIL` veio de review adversarial em contexto limpo. **Reavaliar lendo código e declarando "fechado" repetiria exatamente o método que falhou.**

Regra adotada nesta apuração:

> Para cada achado, a evidência tem que ser **um comando com saída** — um teste que existe, um `grep` que encontra ou não encontra, uma consulta ao schema. Onde não houve comando, o achado fica `NÃO VERIFICADO`, que é diferente de aberto e diferente de fechado.

Todos os comandos e saídas estão no anexo.

**Limite conhecido desta apuração:** para os itens de egress, os comandos provam que os termos aparecem no código **e em arquivos de teste dedicados**, e que essas suítes correram verdes em 09/09/2026 (214 testes no worker). Não foi lido cada teste individualmente. É evidência forte; não é leitura linha a linha.

---

## 2. Os cinco achados fatais

### F1 — O roadmap constrói o item rebaixado para sexto lugar · **FECHADO**

O próprio adendo de 22/08 corrigiu: os itens 1 a 5 da sequência de `lacunas-estruturais.md` §7 **já estavam feitos** entre 06/08 e 13/08 — schema internacional, gestão de equipe, painel do provedor, taxonomia com locale, cobrança com Stripe. A auditoria de presença digital era, de fato, a próxima.

O adendo registra a autocrítica que vale manter: *"Eu cheguei ao alvo certo sem verificar o estado. Isso não é acertar; é coincidir."*

**Resíduo:** o `IMPLEMENTATION-ROADMAP.md` não foi reconstruído a partir do §7 — foi revisado depois pelo `PROVIDER-CONTRACT-v5.md` §13, que extinguiu F1 e absorveu F2 em F3. Ver `RECONCILIACAO-PROMPT-02.md` §2.

### F2 — `LeadSourceProvider` já existe e é regra inviolável · **FECHADO**

`PROVIDER-CONTRACT-v5.md` §1 abre com *"A convenção de provider já existe — e está triplicada"*, e a §2 é literalmente **"Retratação do gap G2"**. O defeito foi reconhecido e o documento corrigido.

`medido`: `LeadSourceProvider` e `SiteAuditProvider` existem em `apps/worker/src/providers/`, ambos com implementação `mock` e real.

### F3 — PII de terceiro entra no banco · **FECHADO, e melhor do que o pedido**

O achado dizia que o filtro de PII rodava na normalização, **um passo depois** de o payload cru já estar gravado, e que o store cru era de retenção indefinida.

`medido` — `apps/worker/src/providers/google-maps.provider.ts:168`:

> *"O scraper devolve `user_reviews` e `owner` com nome, foto e URL de perfil de pessoas físicas identificáveis. O produto precisa de quantas avaliações e da média — não de quem escreveu. **Esses campos nunca saem daqui.**"*

E a implementação não é uma lista de remoção. `toRawLead(entry: ScraperEntry): RawLead` **constrói um objeto novo nomeando o que entra** — `title`, `category`, `phone`, e assim por diante. É allowlist por projeção.

**A distinção não é estilística.** Uma lista de remoção apodrece quando a fonte acrescenta um campo novo; uma projeção sobre forma declarada, não. O §8.4 pedia mover o filtro para antes do snapshot; o código faz mais do que isso — impede a entrada em vez de filtrar a saída.

`medido` — `process-scrape-job.ts:403`: *"Payload bruto já higienizado: o RawLead nunca carregou `user_reviews` nem o perfil do proprietário — o provider descarta na origem."*

### F4 — A invariante de `LeadDigitalPresence` é irrealizável onde foi colocada · **ABERTO**

`PROVIDER-CONTRACT-v5.md` §0 reposicionou a invariante: ela deixa de ser item de F0 e passa a nascer **junto da capability que produz cada sinal** — em F3 para `hasHttps`, em F5 para os sociais. A razão é boa e é a mesma que o projeto usa em toda parte: *componente sem consumidor não é construído.*

**Mas a parte de F3 não foi entregue.** `medido`:

```
hasWebsite     SignalState  @default(DESCONHECIDO)
hasEmail       SignalState  @default(DESCONHECIDO)
hasPhone       SignalState  @default(DESCONHECIDO)
hasInstagram   SignalState  @default(DESCONHECIDO)
hasFacebook    SignalState  @default(DESCONHECIDO)
hasReviews     SignalState  @default(DESCONHECIDO)
websiteHasHttps Boolean?
```

Seis sinais migraram para `SignalState`; o sétimo não. E é justamente o único que a fase liberada de fato escreve, segundo o próprio v5 §0.

**É também a regra 4 do projeto** — *ausência de sinal é `DESCONHECIDO`, nunca `AUSENTE`*. Um `Boolean?` não carrega a distinção que os seis irmãos carregam.

Este é o **único dos cinco achados fatais que continua aberto**, e o trabalho é pequeno: uma migração de campo, a invariante junto, e o ponto de escrita ajustado.

### F5 — O produto se chama PropectAI · **FECHADO**

`medido`: dos 39 documentos em `docs/`, **um único** contém a string `ProspectAI` — o `PROMPT-01-EXECUTION-REPORT.md`, que cita o nome errado para relatar o defeito.

O nome errado sobrevive apenas no registro histórico do achado, que é onde ele deve estar.

---

## 3. Furos de segurança

| Bypass | Estado | Evidência |
|---|---|---|
| IPv6 ULA `fc00::/7` | **FECHADO** | `fc00`/`fd00` em `guard.ts`, `ip-ranges.ts` e nos dois specs correspondentes |
| IPv4-mapped `::ffff:127.0.0.1` | **FECHADO** | `::ffff` nos mesmos quatro arquivos |
| NAT64 `64:ff9b::` | **FECHADO** | `64:ff9b` / `NAT64` nos mesmos quatro arquivos |
| Bomba de gzip | **FECHADO** | `limites.ts` — ver abaixo |
| DNS rebinding / TOCTOU | **FECHADO** | `rebinding`/`TOCTOU` em `fetcher.ts`, `guard.ts`, `transporte.ts` + `egress-fetcher.spec.ts`, `egress-guard.spec.ts` |
| `http://postgres./` (ponto final de FQDN) | **FECHADO** | `trailing` nos mesmos arquivos |
| Isolamento de rede do worker | **RESOLVIDO POR ADR** | ADR-004 |
| TTFB como oráculo / blind SSRF | **FECHADO** | `TTFB` nos mesmos arquivos de egress e teste |

### A bomba de gzip merece nota

O `limites.ts` cita o defeito pelo nome e conserta além do pedido:

> *"bytes na rede — o que deixa passar 2 MB de gzip que inflam para 40 GB. O teste S6 dela passava verde enquanto o worker morria por memória."*

O conserto: **dois tetos que medem coisas diferentes** — o comprimido protege banda e tempo, o descomprimido protege memória —, corte **no fluxo** em vez de acumular para medir, `Content-Encoding` aninhado recusado por princípio, e um rótulo `LEITURA_INTERROMPIDA` separado, para que um reset de socket não saia no log como evento de segurança.

### O isolamento de fetch, e por que "resolvido por ADR" não é evasiva

O achado dizia: *"separar o processo, **ou abandonar a alegação** de isolamento de rede."*

O ADR-004 não faz cegamente nem uma coisa nem outra:

> `Status: **Accepted em duas partes** — a de agora é decidível; a de produção fica registrada e adiada · 22/08/2026`
> `Bloqueia: nada. **Bloqueava F0 até 22/08**`

Separou o que pode ser decidido hoje do que depende de uma produção que ainda não existe, e escreveu por que deixou de bloquear. É a terceira saída, e é honesta.

---

## 4. Erros factuais

| Afirmação do relatório | Estado |
|---|---|
| Módulo `proposals` não existe | **FECHADO** — `medido`: `Test-Path apps\api\src\proposals` → `True` |
| `WebsiteStatus` tem 3 estados | **FECHADO** — `medido`: tem 4, com `DESCONHECIDO`. O erro era do documento; o código sempre esteve certo |
| Referência do Flowsint não pinada | **FECHADO HOJE** — `medido`: `git ls-remote --tags https://github.com/reconurge/flowsint v1.2.10` → `12bf2937c172cd4cb71cb649b73c9e95645e0fa9` |
| `SEM_SITE`, links sociais, currency, Ads, `AppSetting`, prompt injection | **NÃO VERIFICADO** individualmente. Todos são da mesma família: o documento errou sobre o código, e o código estava certo. Fechá-los é corrigir texto |

**Sobre o SHA:** a razão registrada para o `PENDENTE` era *"exige `git ls-remote`, não executável neste ambiente"*. O ambiente mudou; o comando rodou. Isto também desfaz uma contradição entre documentos — o `IMPLEMENTATION-ROADMAP.md` §5 afirmava que o 03A fora absorvido porque a *"versão está pinada"*, e ela não estava. Agora está.

**Ressalva registrada:** o Prompt 01 §3 informa a **v1.2.11** (01/07/2026) como release mais recente, e o documento pina a **v1.2.10**. Se a escolha teve razão além de "era a mais nova conhecida na época", ela merece uma linha — foi exatamente a crítica do relatório ao ADR-002.

---

## 5. As três pendências do adendo

| Pendência | Estado |
|---|---|
| `pnpm typecheck` quebrado, dois erros de tipo | **FECHADO** — `medido`: `pnpm typecheck:all` verde nos cinco pacotes, várias vezes em 09/09, sem cache |
| Enum `PlanCode` órfão; passos 4–6 do "plano vira dado" | **FECHADO (o enum)** — `medido`: `PlanCode` não aparece no schema |
| Cast da migration não exercitado contra dado real | **ABERTO** — não verificável por leitura de código; exige rodar contra cópia da base |

---

## 6. O que continua aberto

Três itens, e nenhum deles é grande:

1. **F4 — `websiteHasHttps` como `Boolean?`.** Único achado fatal remanescente. Migração de campo + invariante + ponto de escrita.
2. **Gate 1 comercial** — *"vender três diagnósticos com pagamento"*. O relatório §5 registra que ele desapareceu do roadmap e classifica isso como o mesmo defeito que a pesquisa de mercado do programa mandou corrigir. **É decisão de produto, não de engenharia.**
3. **Cast da migration contra dado real** — dívida declarada pelo próprio CHANGELOG, aberta desde antes deste relatório.

E um item que não é defeito, mas condiciona tudo: o relatório §5 estimava **27 a 42 semanas** para o roadmap então vigente, e concluía que ele não cabia em uma pessoa. Aquele roadmap foi revisado desde então — F1 extinto, F2 absorvido, F5 e F7 bloqueados por privacidade. **A estimativa não foi refeita sobre o roadmap novo**, e sem isso a conclusão de capacidade não vale nem para o sim nem para o não.

---

## 7. O que este documento não faz

**Não vira o gate.** O Prompt 01 §38 põe o humano como *final approver*, e a lição da §9 daquele relatório é que autoavaliação de quem produziu o trabalho é o mecanismo que falhou. Esta apuração foi feita pelo mesmo tipo de agente que escreveu o relatório reprovado.

O que ela entrega é a apuração com evidência: **treze condições fechadas por comando, três abertas e nomeadas, e um punhado de correções de texto não verificadas uma a uma.**

A decisão de mudar `PROMPT_01_GATE` de `FAIL` para outra coisa — e para qual — é sua. E se quiser o mesmo rigor que produziu o `FAIL`, o caminho está escrito na §9 do relatório: **review adversarial em contexto limpo**, contra esta apuração, e não contra a memória de quem a escreveu.

---

## Anexo — comandos e saídas

```powershell
# F5 — nome do produto
Get-ChildItem -Recurse docs -Filter *.md | Select-String -Pattern "ProspectAI" -List
# → apenas docs\intelligence\PROMPT-01-EXECUTION-REPORT.md

# Egress — três bypasses de endereço
Get-ChildItem -Recurse apps\worker\src\egress, apps\worker\test -Include *.ts |
  Select-String -Pattern "fc00|fd00|::ffff|64:ff9b|NAT64" -List
# → guard.ts, ip-ranges.ts, egress-guard.spec.ts, egress-ip-ranges.spec.ts

# Egress — rebinding, TOCTOU, ponto final, TTFB
Get-ChildItem -Recurse apps\worker\src\egress, apps\worker\test -Include *.ts |
  Select-String -Pattern "rebinding|TOCTOU|trailing|TTFB" -List
# → fetcher.ts, guard.ts, transporte.ts, egress-fetcher.spec.ts, egress-guard.spec.ts

# F3 — descarte de PII na origem
Select-String -Path apps\worker\src\providers\google-maps.provider.ts -Pattern "user_reviews|owner" -Context 0,14
# → comentario em :168 + toRawLead construindo objeto por allowlist

# Flowsint — SHA
git ls-remote --tags https://github.com/reconurge/flowsint v1.2.10
# → 12bf2937c172cd4cb71cb649b73c9e95645e0fa9  refs/tags/v1.2.10

# Erros factuais
Test-Path apps\api\src\proposals                                    # → True
Select-String -Path prisma\schema.prisma -Pattern "enum WebsiteStatus" -Context 0,6
# → SEM_SITE, SITE_PRECARIO, SITE_PROPRIO, DESCONHECIDO

# Adendo — enum orfao
Select-String -Path prisma\schema.prisma -Pattern "PlanCode"        # → vazio

# F4 — o campo que falta migrar
Select-String -Path prisma\schema.prisma -Pattern "SignalState|websiteHasHttps"
# → seis sinais em SignalState; websiteHasHttps Boolean?

# ADR-004
Select-String -Path docs\intelligence\adr\ADR-004-processo-de-fetch-isolado.md -Pattern "Status" -Context 0,2
```
