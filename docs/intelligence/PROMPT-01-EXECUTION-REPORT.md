# PROMPT 01 — EXECUTION REPORT

**Data:** 22/08/2026
**Declaração obrigatória (`CLAUDE.md`, Qualidade):** `F:\drmind` **não foi modificado**. Nenhum recurso Docker foi tocado. Nenhuma alteração fora de `docs/`.

---

## 1. Final Status

```text
FAILED
```

Não por falta de trabalho, mas porque três reviewers independentes encontraram erros que as próprias regras deste programa classificam como condição de falha.

`00-REGRAS-COMUNS.md` §10 lista como `FAILED`: *"alguma afirmação `CURRENT / CONFIRMED` não tem arquivo/linha e está errada"* e *"há caminho de vazamento entre tenants não endereçado"*. Ambas ocorreram.

---

## 2. Os cinco achados fatais

### F1 — O roadmap inteiro constrói o item que o projeto rebaixou para sexto lugar

`docs/strategic/lacunas-estruturais.md` §7, de 06/08/2026:

> *"A auditoria de presença digital saiu do primeiro para o sexto lugar ao longo desta análise... Os itens 1 a 5 determinam se é possível **ter** cliente, e em quantos países. Aumentar o preço de uma base que ainda não pode existir é otimizar a variável errada."*

O `IMPLEMENTATION-ROADMAP.md` tem como caminho crítico F0→F1→F2→F3→F5→F7 — que é inteiramente a auditoria de presença digital.

Agravante: o `PROMPT-01-BASELINE-GAPS.md` §6 registrou isso como pergunta pendente ao Product Owner (P2), e as fases seguintes prosseguiram como se a resposta fosse "sim". **A resposta já existia, com data, e era "não".** Os itens 1 a 5 — clientes/assinaturas, financeiro, planos como dado, taxonomia com locale, alcance global — não aparecem em nenhum dos 8 gaps estruturais.

### F2 — `LeadSourceProvider` já existe, e é regra inviolável

`CLAUDE.md`, regra 3: *"Toda interação passa pela abstração **`LeadSourceProvider`**."*
`lacunas-estruturais.md` §8.2: *"`LeadSourceProvider` tem **duas implementações**, e trocar de fonte não toca o domínio."*

O `GAP-ANALYSIS.md` G2 afirma *"Scraper chamado direto pelo `prospecting`"* — severidade Alta — e o `PROVIDER-CONTRACT.md` §3 propõe `IntelligenceProvider` do zero. A string `LeadSourceProvider` não aparece uma única vez nos 12 documentos.

Ou a afirmação é falsa, ou a regra está sendo violada no código. Nenhuma das duas hipóteses foi levantada.

### F3 — PII de terceiro entra no banco sob a arquitetura proposta

`SECURITY-EGRESS-POLICY.md` §4 afirma: *"PII de terceiro nunca entra no banco."*

Mas o `PROVIDER-CONTRACT.md` §4 ordena o pipeline como `Execute → Snapshot → Validate → Normalize`, e `BOUNDED-CONTEXTS.md` §4 F5 torna isso regra: *"snapshot precede normalização"*.

**O filtro de PII roda na normalização — um passo depois de o payload cru já ter sido gravado.** O filtro é de projeção, não de ingestão. E o store cru é o de retenção indefinida.

A afirmação de privacidade mais forte do trabalho é contradita pela arquitetura do mesmo trabalho.

### F4 — A invariante de `LeadDigitalPresence` é impossível onde foi colocada

`DATA-OWNERSHIP.md` §2 nota 3: *"A escrita ocorre através de uma porta do CRM... **o CRM valida**"*.
`BOUNDED-CONTEXTS.md` §1: *"**O CRM não conhece nem Aquisição nem Intelligence.**"*

`Evidence` pertence ao contexto Intelligence. Portanto o CRM **não pode ler a evidência que deveria validar** — só recebe um DTO. A "validação" se reduz a checar que um struct foi preenchido.

A invariante não é frouxa por disciplina. É irrealizável na posição em que a arquitetura a colocou.

### F5 — O produto se chama PropectAI

`CLAUDE.md`: *"**PropectAI** — plataforma SaaS multi-tenant"*. `package.json`: `"name": "propectai"`, `@propectai/types`, containers `propectai-*`.

Os 12 documentos escrevem "ProspectAI" — inclusive no título de um ADR marcado `Accepted`.

E `parecer-prompt-faro.md` §1.1 já tratou nome errado de produto como bloqueador formal, resolvido em 31/07. **O mesmo defeito, reintroduzido em silêncio.**

---

## 3. Furos de segurança encontrados

O reviewer de segurança atacou a própria egress policy que este trabalho produziu:

| Bypass | Situação |
|---|---|
| **IPv6 ULA `fc00::/7`** — inclui `fd00:ec2::254`, o IMDS da AWS por IPv6 | **Não bloqueado.** Ausente da tabela §2.1. O teste S2 passa verde enquanto isto funciona |
| **IPv4-mapped `::ffff:127.0.0.1`** | Não bloqueado se a checagem for por família |
| **NAT64 `64:ff9b::a9fe:a9fe`** | Não bloqueado — carrega `169.254.169.254` embutido |
| **`http://postgres./`** (ponto final de FQDN) | Derrota a regra "nomes sem ponto", que é regra de string dentro da seção que proíbe regras de string |
| **Bomba de gzip** | §2.4 não distingue bytes na rede de bytes descomprimidos. 2 MB → 40 GB. S6 passa verde |
| **DNS rebinding** | §2.3 autoriza uma opção 2 (cache + revalidar) que não fecha a janela TOCTOU |

Mais dois problemas de arquitetura, não de tabela:

**O isolamento de rede proposto é irrealizável como escrito.** Um worker BullMQ sem rota para a rede interna não consegue ler a fila nem gravar. O correto seria separar o processo que busca a URL do que persiste — nenhum documento diz isso, e o critério de pronto de F0 nem exige o isolamento.

**TTFB é um oráculo de rede entregue como funcionalidade.** O produto mede tempo até o primeiro byte por desenho. Mesmo com todas as faixas bloqueadas, a diferença entre "bloqueado", "NXDOMAIN" e "recusado" mapeia a rede interna. Blind SSRF não está no threat model.

---

## 4. Erros factuais

| Afirmação | Realidade |
|---|---|
| Módulo `proposals` · `CURRENT` | **Não existe** em `apps/api/src` — a própria lista de 17 módulos do `CURRENT-ARCHITECTURE.md` §3 não o contém |
| `WebsiteStatus` tem 3 estados | Tem **4** — inclui `DESCONHECIDO`, que é o default e a razão da regra 4 |
| `SEM_SITE` "permanece `DESCONHECIDO`" | `SEM_SITE` é sinal **verificado** e vale **+30** no `scoring.md` §3.1 — o maior peso do motor |
| Links sociais "não existem" | `LeadDigitalPresence` já tem `instagramUrl`, `facebookUrl`, `websiteHasHttps` |
| `currency: 'BRL'` fixo | `lacunas-estruturais.md` §10.2 decidiu **BRL, USD e EUR**; o schema já tem `Plan.pricesByCurrency` |
| "Sem fonte legítima no Brasil" (Ads) | `lacunas-estruturais.md` §6 decidiu **alcance global** em 06/08. A Meta Ad Library funciona na UE — onde o produto vai vender |
| `AppSetting` escrito por Admin | `scoring.md` §3: pesos *"editáveis por tenant sem deploy"* |
| Prompt injection: "não há IA no caminho" | `OutreachMessage` tem `prompt`, `model`, `tokensEstimated`; `PlanUsage.aiGenerationsCount` |
| Referência do Flowsint "pinada" | `THIRD_PARTY_FLOWSINT.md` §2: commit SHA `PENDENTE` |

E `placeId` não é coluna incidental: `data-model.md` §4 o usa como **primeiro passo da deduplicação** e `@@unique([tenantId, placeId])` é um dos dois índices únicos do `Lead`. Movê-lo muda quando o cliente é cobrado — F4 não menciona isso.

---

## 5. O roadmap não cabe em uma pessoa

Estimativa do reviewer de arquitetura, item a item: **27 a 42 semanas de construção focada**, com caminho crítico de 20 a 34 semanas até a primeira receita nova. Para um operador que também vende, suporta e mantém o produto atual: **9 a 18 meses de calendário**.

E a mitigação declarada não mitiga: `IMPLEMENTATION-ROADMAP.md` §6 propõe *"cortar F8, F6 e adiar F4"* — as três estão **fora** do caminho crítico. Cortá-las não encurta nada.

O Gate 1 — vender três diagnósticos com pagamento — desapareceu do roadmap. É o mesmo defeito que a pesquisa de mercado deste programa diagnosticou e mandou corrigir.

---

## 6. O que sobrevive

Separando com honestidade:

| Item | Status |
|---|---|
| Fatos do schema: 40 modelos, 24 enums, 30 com `tenantId`, lista dos 10 sem, 1.434 linhas | **Confere** |
| Portas, nomes de container, campos do `ScrapeJob` | **Confere** |
| SSRF como gap real não coberto pelo `scope-v0.2.md` | **Confirmado pelos três reviewers** — o princípio está certo, a tabela está furada |
| ADR-003 (sem grafo) | Sobrevive — nenhum reviewer contestou o mérito |
| ADR-002 (não adotar Flowsint) | Conclusão provavelmente sobrevive; a base precisa de correção — SHA não pinado, tabela de capabilities é `HYPOTHESIS` promovida a `Accepted` |
| Achado do "pipeline embrionário" (`ScrapeJob` ≈ Run) | Sobrevive, mas subestimou o que já existe (`LeadSourceProvider`) |

---

## 7. Causa raiz

A mesma dos turnos anteriores, e ela reincidiu depois de eu tê-la diagnosticado: **li a documentação do projeto tarde e parcialmente.**

Li `CLAUDE.md`, `README.md`, `scope-v0.2.md` e `scoring.md`. **Não li** `lacunas-estruturais.md` além do sumário, nem `data-model.md`, nem `environment-audit.md`, nem `CONFERENCIA-V011.md`. As decisões de 06/08 e 13/08 que invalidam o roadmap estavam nos arquivos que eu listei como encontrados e não abri.

O `§4` do Prompt 01 estabelece a ordem das fontes de verdade. Eu a citei em três documentos e não a segui.

---

## 8. O que precisa acontecer

Em ordem. Nada abaixo é opcional para reabrir o gate.

1. **Ler `lacunas-estruturais.md` inteiro** e reconstruir o roadmap a partir da sequência do §7 — não da auditoria
2. **Verificar `LeadSourceProvider` no código** e decidir se o Provider Contract o estende ou o substitui
3. **Corrigir o nome do produto** em todos os documentos
4. **Mover o filtro de PII para antes do snapshot**, e reescrever o pipeline
5. **Reposicionar a invariante de `LeadDigitalPresence`** — FK obrigatória e CHECK no banco, não validação num contexto cego
6. **Refazer a tabela de egress** com IPv6 ULA, mapped, NAT64, e normalização antes de comparar
7. **Separar o processo de fetch do worker**, ou abandonar a alegação de isolamento de rede
8. **Corrigir os erros factuais** da §4
9. **Reintroduzir o Gate 1** antes de qualquer fase de construção

---

## 9. Nota sobre o mecanismo

O review por subagentes em contexto limpo encontrou, em uma execução, erros que oito turnos de trabalho não pegaram — incluindo dois que eu havia diagnosticado como padrão e reincidido.

O gate auto-avaliado teria dado `APPROVED_WITH_WARNINGS`. **Essa é a evidência mais forte deste relatório**, e vale mais que a arquitetura que ele reprova.

```text
PROMPT_01_GATE = FAIL
```

Correções necessárias listadas na §8. O trabalho não é descartável — é corrigível. Mas não deve ser usado como base do Prompt 02 no estado atual.
