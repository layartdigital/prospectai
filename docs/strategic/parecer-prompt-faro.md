# Parecer técnico-gerencial — "Prompt Mestre Faro"

**Data:** 31 de julho de 2026
**Objeto:** avaliação do prompt de auditoria/benchmark/evolução da plataforma "Faro"
**Contexto avaliado:** `F:\prospectai` v0.1.1, `docs/strategic/scope-v0.1.1.md`, `docs/technical/environment-audit.md`, `CLAUDE.md`
**Recomendação de topo:** **não executar como está.** Extrair ~20% do conteúdo, descartar o resto, sequenciar em quatro entregas com portão de decisão humana entre elas.

> **Resolvido em 31/07/2026, pelo responsável do produto:**
> 1. **"Faro" é erro de cópia.** O produto é PropectAI. Consequência: a matriz da §4 do prompt mestre é ficção herdada e não pode ser usada como ponto de partida — em especial a coluna "Faro aparente: Sim" para F01–F05, que aqui correspondem às Fases 4 e 5, ainda não concluídas.
> 2. **Motor de coleta: manter o `gosom/google-maps-scraper`.** A regra 3 do `CLAUDE.md` permanece intacta. A §7 F02 do prompt mestre fica **rejeitada como instrução de implementação** e **aceita como registro de risco**: a exposição contratual e de continuidade vai documentada, e o domínio permanece desacoplado atrás de `LeadSourceProvider`. Nenhum agente troca provider por conta própria.

---

## 1. Bloqueadores antes de qualquer discussão de mérito

### 1.1 O prompt fala de "Faro"; o repositório é "PropectAI"

O documento inteiro se dirige a uma plataforma chamada Faro e a lista como concorrente de si mesma na seção 19. `package.json` diz `propectai`, `CLAUDE.md` diz PropectAI, `scope-v0.1.1.md` diz PropectAI.

Três hipóteses, e cada uma muda tudo:

| Hipótese | Consequência |
|---|---|
| Rebrand de PropectAI → Faro | O prompt é válido, mas precisa de uma tarefa de renomeação antes (pacotes `@propectai/*`, prefixo Docker `propectai-`, seeds, README) |
| Faro é outro codebase | O prompt não deve rodar aqui — apontaria um agente para a árvore errada |
| Faro é concorrente e o prompt foi adaptado sem substituir o nome | Toda a seção 4 ("Faro aparente") é ficção herdada; a matriz precisa ser refeita contra o PropectAI real |

**Isto precisa ser respondido antes de qualquer execução.** Um agente rodando este prompt em `F:\prospectai` vai gerar uma auditoria coerente sobre um produto que não é este.

### 1.2 O prompt perdeu as duas proibições invioláveis do projeto

`CLAUDE.md` tem duas regras absolutas que o prompt mestre **não menciona uma única vez**:

- **Regra 1 — não tocar no Bellvia** (`F:\drmind`, mesma stack, mesmo Docker). O prompt manda "executar a aplicação", "instalar dependências", "aplicar migrations", "corrigir bloqueadores". Nada nele impede `docker system prune` ou reuso de porta/volume. Risco operacional real sobre um sistema de terceiro em produção.
- **Regra 2 — o módulo Construtor de Sites não existe.** O prompt não só omite a proibição como empurra na direção contrária: seção 20 item 17 pede "white-label para agências", item 19 pede "marketplace de playbooks", e o objetivo declarado é "plataforma completa". Um agente maximizando cobertura funcional tem incentivo explícito para reintroduzir exatamente o módulo que o produto foi desenhado para não ter.

Qualquer prompt que rode neste repositório precisa reafirmar as duas literalmente, no topo.

### 1.3 A premissa factual está errada

O prompt abre com *"Você recebeu acesso ao código-fonte completo"* e monta todo o método sobre a suspeita legítima de que telas mentem, endpoints são mock e integrações são parciais. É o método correto **para um sistema legado herdado, de proveniência desconhecida**.

O PropectAI tem quatro dias de implementação. `environment-audit.md` (27/07) registra 0% de código; hoje existe monorepo, Prisma e scripts. Não há legado, não há dívida oculta, não há integração misteriosa. O que existe é um escopo aprovado com 24 critérios de aceite explícitos e uma lista nominal do que ficou fora e por quê.

**A auditoria de 16 funcionalidades vai gastar horas para concluir "F — Ausente" em 11 delas — informação que `scope-v0.1.1.md` §4 já entrega em uma página.** Auditoria é a ferramenta errada quando existe uma especificação recente e confiável. A ferramenta certa é conferência contra os 24 critérios de aceite.

---

## 2. Escala: o prompt não é um prompt

Somando o que o documento pede como entrega única:

- inventário técnico completo + execução + evidências de runtime
- auditoria de 16 funcionalidades com classificação A–G e evidência por item
- benchmark contra Clint + 12 concorrentes secundários
- priorização ponderada de todos os gaps
- arquitetura alvo com 24 domínios e 11 componentes transversais
- ~70 entidades de banco
- implementação de CRM, pipeline, WhatsApp Cloud API, Instagram, agente conversacional, cadências, agendamento, recuperação, pós-venda, BI, e uma squad de 7 agentes de IA com 6 níveis de autonomia
- onboarding de 14 passos + product tour em 9 áreas
- 10 categorias de teste + framework de avaliação de IA
- observabilidade completa + threat model
- ~40 documentos em 11 diretórios

Isso é o roadmap de 12 a 24 meses de um time de 8 a 15 pessoas. Entregue como instrução única, produz um de dois resultados, ambos ruins:

1. saída rasa e uniforme — tudo mencionado, nada verificado;
2. **relatório declarando implementação de coisas que não existem** — precisamente o que a seção 3.2 tenta proibir.

A ironia é estrutural: um prompt cuja tese central é "não confunda aparência com funcionalidade" está dimensionado de forma a garantir que a resposta seja aparência.

---

## 3. Conflitos diretos com decisões já tomadas

| Prompt | Decisão vigente | Avaliação |
|---|---|---|
| §7 F02: classifica "scraping direto do Google Maps" como frágil e propõe `GooglePlacesProvider` | `CLAUDE.md` regra 3: `gosom/google-maps-scraper` é o motor, sempre | **O prompt tem razão no risco, e mesmo assim não pode decidir sozinho.** Ver §5.1 |
| §11: ~70 entidades incluindo `AgentVersion`, `WorkflowStep`, `MetricSnapshot`, `AIModel` | `scope-v0.1.1.md` §4.2 limita deliberadamente a 5 tabelas sem interface | Criar 40 tabelas mortas contraria o princípio "menos telas, todas de verdade" e infla toda migration futura |
| §13.2: Product Tour em 9 áreas, agora | Escopo adia para v0.2 — *"exige as 7 telas estáveis. Entra na v0.2, quando houver o que tourear"* | O adiamento está certo. Tour sobre telas instáveis é retrabalho garantido |
| §4 matriz: "Faro aparente: Sim" para F01–F05 | F01–F05 estão nas Fases 4 e 5, **não concluídas** | A matriz de partida está errada para este produto |
| §21: "implemente" na mesma execução da auditoria | §3.1 do próprio prompt: "não implemente antes de compreender" | O prompt viola a si mesmo e elimina o portão de decisão humana entre diagnóstico e obra |

---

## 4. O que é bom e deve ser aproveitado

Não é um documento fraco. Tem material de primeira linha enterrado em escopo excessivo.

**Aproveitar integralmente:**

1. **§5 — taxonomia A–G**, em especial *"não classifique 'não verificável' como 'ausente'"*. Adotar como padrão permanente de relatório de fase. Custo zero, valor alto.
2. **§3.3 — interface ≠ funcionalidade**, com os quatro rótulos (`INTERFACE SEM IMPLEMENTAÇÃO REAL`, `MOCK OU PROTÓTIPO`, `INTEGRAÇÃO PARCIAL`, `IMPLEMENTADA MAS NÃO OPERACIONAL`). Formaliza a regra 7 do CLAUDE.md.
3. **§7 F03 — categorias de classificação de site.** *Este é o item mais valioso do documento inteiro.* O escopo atual tem três estados (`SEM_SITE` / `SITE_PRECARIO` / `SITE_PROPRIO`). O prompt propõe nove, com evidência, data de verificação e nível de confiança. Isso não é refinamento cosmético: é exatamente o segundo eixo de precificação que `scope-v0.1.1.md` §9 registra como **decisão comercial em aberto**. A "auditoria de presença digital com relatório exportável" deixa de ser ideia e vira especificação. Adotar.
4. **§7 F04 — decomposição do score** em sub-scores + `score_model_version` + `score_explanation` + `score_components` + nível de confiança. Extensão barata do motor determinístico já previsto, e reforça o diferencial declarado de explicabilidade.
5. **§7 F05 — regras anti-alucinação na abordagem por IA**: proibir invenção de números, clientes, resultados, preços e garantias; gerar 2–3 variações; exigir aprovação antes do envio; versionar o prompt e registrar a versão enviada. Barato, e vai direto para a Fase 5, que ainda não começou.
6. **§3.5 — formato de entitlements** (`feature_key`, `plan_id`, limites, `configuration`). Confirma e dá forma concreta ao `EntitlementService` já decidido.
7. **§14 e §16** — LGPD, threat model, logs sem PII, correlation ID, dead-letter queue, monitoramento de custo por tenant. Corretos; dimensionar para o tamanho atual.

---

## 5. Discordâncias de mérito

### 5.1 Google Places vs. scraper — o prompt levanta a questão certa e propõe o processo errado

A seção 7 F02 pede API oficial, restrição de chave, quota, custo por chamada, conformidade com termos de uso. Está tecnicamente correta: scraping do Google Maps tem exposição contratual e de continuidade que nenhuma abstração elimina.

Só que a decisão *"trocar o motor de coleta"* é comercial, não técnica. Places API custa por chamada e retorna menos campos que o scraper; migrar muda a estrutura de custo do produto e possivelmente a tabela de preços. **Um agente não pode tomar essa decisão dentro de uma auditoria.**

Posição recomendada: manter o scraper como provider primário, e usar a abstração `LeadSourceProvider` — que já existe no escopo — para adicionar `GooglePlacesProvider` como *fallback* e como caminho de conformidade para clientes que exijam. O que muda hoje é só registrar o risco por escrito e não deixar o domínio acoplado. Essa é a decisão barata e reversível.

> **Decidido em 31/07/2026:** manter o scraper, registrar o risco. `GooglePlacesProvider` não entra na v0.1.1 nem na v0.2. Reavaliar apenas se surgir exigência contratual de cliente ou mudança de postura do provedor.

### 5.2 A squad de agentes de IA (F16) — cortar inteira

Sete meta-agentes (Revenue Strategist, Sales Ops, Prompt Optimization, Conversation QA, BI Analyst, Customer Success, Integration Monitor) com seis níveis de autonomia por tenant.

Todos eles otimizam um funil. **Não existe funil.** Não há tenant pagante, não há conversa registrada, não há histórico de conversão, não há prompt em produção para o Prompt Optimization Agent otimizar. É uma camada de otimização sobre dados que não foram gerados.

Custo se construído agora: complexidade arquitetural permanente, superfície de segurança nova (agentes com ferramentas autorizadas), consumo contínuo de tokens, e manutenção de sete conjuntos de avaliação — para produzir recomendações estatisticamente vazias.

**Recomendação: fora do roadmap até haver ≥20 tenants ativos e ≥3 meses de histórico de conversas.** Aproveitar apenas o *modelo de níveis de autonomia* (0 a 5) como princípio de design do único agente que de fato será construído.

### 5.3 WhatsApp oficial como P1 — sim, mas é produto de compliance, não feature

Concordo com a proibição de bibliotecas não oficiais e sessão por QR Code. Discordo do dimensionamento.

Cloud API oficial exige, **por tenant**: Business Manager verificado, número dedicado, aprovação de templates, prova de opt-in, gestão da janela de 24h, e onboarding via BSP. Para o público-alvo declarado — agências e prestadores locais pequenos — isso é a maior queda de funil de ativação de todo o produto. Não é um sprint de integração; é uma operação de onboarding assistido.

Sequência recomendada: **(a)** disparo outbound por template, unidirecional, um tenant piloto, atrás de feature flag → **(b)** recepção de webhook e inbox → **(c)** roteamento/omnichannel. Instagram só depois de (c) estar estável.

### 5.4 Copiar a superfície da Clint dissolve a cunha competitiva

A diferenciação declarada do PropectAI é descoberta local + detecção de lacuna digital + score explicável. Virar CRM completo o coloca de frente com RD Station, Kommo e HubSpot no terreno deles, com uma fração dos recursos.

**Posição:** construir CRM apenas o suficiente para não perder o lead — pipeline, atividades, notas, follow-up, que **já estão no escopo v0.1.1** — e integrar para fora (HubSpot, RD, Kommo, Pipedrive) em vez de substituir. A agência que já tem CRM não troca; ela quer alimentar o CRM que tem. Conector de saída é mais barato de construir, mais fácil de vender e não compete de frente.

A seção 20 propõe "unir Faro + Clint + camada superior de Revenue Autonomy". É uma tese de captação de investimento, não uma instrução de execução.

### 5.5 O Priority Score de §9 é falsa precisão

Seis fatores ponderados em escala 0–100 dão aparência de objetividade a números que serão escolhidos para justificar a decisão já tomada. Com 15 a 20 gaps, um 2x2 de impacto × esforço mais uma lista explícita de dependências ("X não começa antes de Y") é mais honesto, mais rápido e igualmente decidível.

### 5.6 A árvore de 40 documentos de §18 inverte a relação com o código

`SALES_PLAYBOOK.md`, `DEMO_SCRIPT.md`, `MARKET_POSITIONING.md`, `COMPETITOR_MATRIX.md` e `DIFFERENTIATION_STRATEGY.md` para um produto que ainda não completou as seis telas do núcleo. Documentação escrita antes do produto existir é escrita uma vez e apodrece na primeira semana.

Manter: `SYSTEM_INVENTORY.md`, `DATA_MODEL.md` (já existe), `API_REFERENCE.md` (gerado do Swagger), `CHANGELOG.md`, ADRs. O resto entra quando houver o que descrever.

### 5.7 Definition of Done impossível se torna DoD ignorada

A seção 23 exige 22 condições simultâneas, várias delas de v0.3+. Uma DoD que nunca pode ser marcada não é rigor — treina o time a não olhar para a DoD. Os 24 critérios de aceite do `scope-v0.1.1.md` são um modelo melhor: específicos, verificáveis, alcançáveis nesta versão.

### 5.8 Detalhe de forma: os 13 papéis simultâneos não ajudam

"Atue como arquiteto + PM + backend + frontend + CRM + Meta + IA + BI + LGPD + QA + DevOps + concorrência + redator" dilui, não soma. Um papel focado por tarefa produz saída melhor do que treze empilhados. Se o objetivo é cobertura multidisciplinar, o caminho é uma tarefa por disciplina, não um prompt com treze chapéus.

---

## 6. Como eu executaria — quatro entregas com portão entre elas

**Portão 0 — Decisões que só você pode tomar (nenhum código)**

1. ~~Faro ou PropectAI?~~ **Fechado 31/07: erro de cópia, o produto é PropectAI.**
2. ~~Postura sobre o scraper?~~ **Fechado 31/07: manter, registrar risco, não trocar provider.**
3. **Em aberto — segundo eixo de precificação.** A pergunta de `scope-v0.1.1.md` §9: créditos de abordagem por IA ou auditoria de presença digital? *(O §7 F03 do prompt responde isso muito bem: a auditoria de presença transforma um custo técnico obrigatório em produto vendável, e é o mesmo trabalho de enriquecimento que a regra 5.2 já exige. É a resposta que eu defenderia.)*

**Entrega 1 — Conferência de realidade (1 sessão, ~2h)**
Tabela única: cada um dos 24 critérios de aceite × estado real no código × evidência (arquivo, endpoint, teste). Zero documento novo, zero código novo. Substitui integralmente as seções 6 e 7 do prompt mestre, porque a especificação já existe e é recente.

**Entrega 2 — Fechar a v0.1.1**
Nada além dos 24 critérios. O prompt mestre não roda até isto estar verde. Regra: um produto com 6 telas que funcionam vale mais que 16 funcionalidades classificadas.

**Entrega 3 — v0.2, o núcleo do valor do prompt**
- classificação de site em 9 categorias com evidência, data e confiança (§7 F03)
- enriquecimento de presença digital → relatório exportável = segundo eixo de preço
- sub-scores + versionamento + explicabilidade do score (§7 F04)
- regras anti-alucinação, variações e aprovação na abordagem por IA (§7 F05)
- cadências e follow-up automático com as condições de parada de §7 F11

Isso é aproximadamente 80% do valor real do prompt mestre, em cerca de 10% do escopo dele.

**Entrega 4 — v0.3, um canal só**
WhatsApp Cloud API, outbound por template, feature flag, um tenant piloto. Agendamento em seguida, se o piloto sustentar.

**Fora do roadmap por ora:** squad de agentes, workflow engine genérico, Instagram, BI avançado, marketplace de playbooks, white-label.

---

## 7. Síntese

O prompt está certo no rigor e errado no dimensionamento e no momento.

Seu método — evidência obrigatória, ceticismo com telas bonitas, classificação honesta do não verificável — é exatamente a disciplina que este projeto declara querer. Suas seções F03, F04 e F05 contêm melhorias de produto genuínas, e F03 responde a uma pergunta comercial que está formalmente registrada como em aberto.

O que ele erra: trata um produto de quatro dias como sistema legado; pede em uma execução o que é roadmap de anos; delega ao agente decisões de estratégia e de exposição legal que são do dono; e — mais grave — omite as duas proibições invioláveis do projeto, uma delas protegendo um sistema de terceiro em produção.

**Executar como está produz um relatório longo, majoritariamente correto, majoritariamente inútil, com risco não trivial de o agente começar a construir a plataforma errada.** Extraído e sequenciado, vira o melhor insumo de roadmap que o projeto tem.
