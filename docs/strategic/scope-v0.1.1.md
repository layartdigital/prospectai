# Escopo da v0.1.1 — Núcleo Profundo

**Projeto:** PropectAI
**Princípio orientador:** ultra funcional. Menos telas, todas de verdade.
**Data:** 27 de julho de 2026

---

## 1. A decisão central

O documento mestre especifica 14 telas, 28 entidades, 60+ endpoints e três camadas de teste. Esse é o destino correto — mas não é uma versão 0.1.1.

Entregar tudo de uma vez produz exatamente o produto que a análise de concorrentes identificou como falho: um menu com onze itens em que cinco só abrem um modal de bloqueio. Menu cheio, produto vazio.

**A v0.1.1 entrega seis telas que funcionam de ponta a ponta com dado real no banco.** O resto é modelado no schema — porque `tenantId` e relacionamentos não se retrofitam — mas não ganha rota nem item de menu enquanto não tiver substância.

---

## 2. Decisões de arquitetura aprovadas

| Tema | Decisão |
|---|---|
| **Ambiente de dev** | Híbrido: Postgres, Redis e scraper em Docker; web/api/worker locais com `pnpm dev`. O compose completo existe e funciona, mas o ciclo diário não passa por rebuild de imagem |
| **Autenticação** | Real desde a v0.1.1: JWT curto, Argon2, refresh com rotação em cookie HttpOnly |
| **Multi-tenant** | Completo desde a primeira migration. `tenantId` em toda entidade de negócio, `TenantGuard`, teste explícito de vazamento horizontal |
| **Raiz do projeto** | `C:\ResgateProjetos\prospectai`, sempre — migrado de `F:\prospectai` em 06/08/2026 por falha de hardware do disco externo |
| **Motor de coleta** | `gosom/google-maps-scraper`, sempre |

Auth e multi-tenant entram agora justamente porque são as duas coisas impossíveis de acrescentar depois sem reescrever tudo. Uma tela a mais é barata; um schema sem `tenantId` é uma migração de dados dolorosa.

---

## 3. Dentro do escopo

### 3.1 Telas — as seis do núcleo

| Tela | Rota | O que significa "funcional" aqui |
|---|---|---|
| **Dashboard** | `/dashboard` | Sete KPIs calculados por query real, buscas recentes, funil com contagem por etapa, ações rápidas. Zero card estático |
| **Nova Busca** | `/search` | Estado → cidade → nicho → raio → quantidade. Cria `ProspectingSearch` + `ScrapeJob`, enfileira, acompanha por polling, mostra progresso e resultados |
| **Meus Leads** | `/leads` | Tabela paginada no servidor, filtros combináveis, ordenação, seleção múltipla, exportação CSV conforme plano |
| **Ficha do Lead** | `/leads/[id]` | A tela mais importante do produto. Detalhamento em 3.2 |
| **Pipeline** | `/pipeline` | Kanban de 8 colunas, drag and drop com dnd-kit, persistência otimista com rollback, contagem por coluna |
| **Histórico** | `/history` | KPIs de busca, tabela com duração e taxa de duplicidade, ações ver leads / repetir busca |

Mais as telas de suporte que não são opcionais: `/login`, `/register`, `/onboarding`, `/settings`, `/subscription`.

### 3.2 Ficha do Lead — detalhamento

Grid 70/30 no desktop. Coluna principal com quatro cards, sidebar direita com dois blocos.

**Coluna principal**

- `LeadContactCard` — telefone com máscara por plano e botão copiar; WhatsApp quando o número for compatível; endereço com link para o Google Maps; horário de funcionamento com situação calculada (aberto/fechado); website ou o estado real de ausência; avaliação e contagem; data da última atualização dos dados
- `LeadScoreCard` — número de 0 a 100, badge de faixa, pontos positivos e pontos de atenção vindos de `LeadScoreReason`, botão recalcular
- `LeadOutreachCard` — geração de abordagem por IA, canal, tom, objetivo, resultado editável, histórico de versões
- `LeadContactTimeline` + `LeadFollowUpList` — registro de contatos e follow-ups com agendar, concluir, reagendar e cancelar

**Sidebar**

- `LeadPipelineSidebar` — as 8 etapas na vertical, etapa atual em destaque, clique muda o status com atualização otimista
- `LeadTrackingCard` — status, responsável, última ação, próxima ação, observações persistidas como `LeadNote` com autoria

**Duas regras inegociáveis:** nenhum modal de bloqueio abre sozinho ao carregar a página — só depois de uma tentativa explícita do usuário. E nenhum elemento de criação de site aparece em lugar algum.

### 3.3 Backend

- Auth completo: register, login, refresh, logout, me
- `TenantGuard` + RBAC (`OWNER`, `ADMIN`, `MANAGER`, `SDR`, `VIEWER`)
- `EntitlementService` central — nenhuma verificação de plano espalhada por componente
- `LeadSourceProvider` com duas implementações: `MockLeadSourceProvider` e `GoogleMapsScraperProvider`
- Worker BullMQ com o ciclo completo: coleta → normalização → deduplicação → presença digital → score → cota → notificação → auditoria
- Motor de score determinístico e versionado, com motivos persistidos
- Deduplicação idempotente por `place_id` e por fingerprint
- Swagger em todos os endpoints
- `GET /api/v1/health` e `GET /api/v1/system/version`

### 3.4 Dados e planos

- Quatro planos por seed: FREE, START, PRO, AGENCY. Valores configuráveis, nunca hardcoded em componente
- Seed de demonstração **rico** — ver seção 6
- Onboarding de 5 etapas, persistido, reiniciável em Configurações

---

## 4. Fora do escopo da v0.1.1

### 4.1 Cortado por completo

| Item | Motivo |
|---|---|
| **Construtor de Sites** | Proibição absoluta do documento mestre. Sem rota, sem menu, sem tabela, sem flag, sem menção em plano ou modal |
| **Rota `/ai-outreach`** | Duplicação. O card na ficha do lead já entrega a função; a tela dedicada seria só um seletor de lead. A geração em lote fica em `/leads` |
| **Product Tour de 7 passos** | Exige as 7 telas estáveis. Entra na v0.2, quando houver o que tourear |
| **MinIO** | Sem uso real na v0.1.1 |
| **Assinatura digital de contrato** | Sem provedor contratado, seria promessa falsa |

### 4.2 Modelado no schema, sem interface

Tabelas criadas na primeira migration para não exigir retrofit. Sem rota, sem item de menu, sem placeholder.

- `Proposal` e `ProposalItem`
- `Contract`
- `ExportJob`
- `Tag` e `LeadTag`

`AppSetting` e `FeatureFlag` também não têm tela, mas **são usados** desde a v0.1.1: os pesos do score e a lista de domínios de site precário vivem em `AppSetting`, editáveis sem deploy.

### 4.4 Desvios aceitos — 31/07/2026

A conferência dos 24 critérios (`docs/audit/CONFERENCIA-V011.md`) encontrou cinco telas construídas além do escopo aprovado, todas com backend real. Como o código existe, funciona e tem custo de manutenção já pago, **remover para satisfazer este documento seria desperdício.** A decisão foi por item, com base em mérito de produto — não em fidelidade ao papel.

| Tela | Decisão | Motivo |
|---|---|---|
| `/notifications` — Avisos | **Promovida ao escopo** | Funciona com dado real. O sino da topbar continua, a tela dá o histórico |
| `/pricing-calculator` — Precificador | **Promovida ao escopo** | Client-side, barata, sem dependência externa |
| `/proposals` — Propostas | **Promovida ao escopo** | Consome `/proposals` com dado real; `Proposal` e `ProposalItem` saem de 4.2 |
| `/ai-outreach` — IA de Abordagem | **Fora do menu, código mantido** | Duplica o `LeadOutreachCard`. Dois caminhos para a mesma tarefa geram dúvida sobre qual é o oficial. A ficha do lead continua sendo a porta de entrada |
| `/contracts` — Contratos | **Fora do menu, código mantido** | Sem provedor de assinatura digital, a tela promete um fluxo que não fecha — exatamente o defeito que a seção 1 deste documento existe para evitar |

Nenhuma das duas últimas é placeholder ou paywall: quem chega pela URL encontra tela funcional. O que se decidiu foi não convidar para elas ainda.

Menu principal resultante: **8 itens**, contra 5 no escopo original e 10 no que estava implementado.

#### Critérios de aceite adicionais

Os três recursos promovidos passam a valer pela mesma barra dos demais:

25. Avisos lista notificações por query real, com marcação de lida persistida — nenhum contador escrito em componente
26. Precificador calcula client-side, sem inventar valores de plano: as faixas vêm de `AppSetting` ou do `EntitlementService`, nunca hardcoded
27. Propostas cria, edita e lista com dado real, respeitando `tenantId`, e **nenhum modal de bloqueio abre ao carregar a tela**

### 4.3 Adiado com data

| Item | Versão |
|---|---|
| Precificador com interface | v0.2 — é client-side e barato, mas não é núcleo |
| Centro de Avisos como tela | v0.2 — na v0.1.1 as notificações são geradas e contadas no sino da topbar |
| Propostas e Contratos com interface | v0.2 |
| Exportação Excel | v0.2 — CSV cobre a necessidade |
| Enriquecimento de redes sociais | v0.2 — ver 5.2 |
| Playwright E2E completo | v0.2 — na v0.1.1, os 3 fluxos críticos apenas |

---

## 5. Regras de negócio novas

Cinco regras que não estão no documento mestre e que a análise do motor de coleta tornou necessárias.

### 5.1 Site precário é oportunidade, não ausência de oportunidade

Classificar em três estados, não dois:

| Estado | Critério | Peso no score |
|---|---|---|
| `SEM_SITE` | Campo `website` vazio | +30 |
| `SITE_PRECARIO` | Domínio de construtor gratuito, encurtador ou rede social: `*.base44.app`, `*.wixsite.com`, `*.negocio.site`, `linktr.ee`, `instagram.com`, `facebook.com`, `*.blogspot.com` | **+22** |
| `SITE_PROPRIO` | Domínio próprio com site respondendo | 0 |

Um lead com página em construtor gratuito é comercialmente quase tão bom quanto um sem site nenhum — e tratá-lo como "já tem site" descarta oportunidade real. Nenhum concorrente analisado faz essa distinção.

A lista de domínios fica em `AppSetting`, editável sem deploy.

### 5.2 Ausência de sinal é `DESCONHECIDO`, jamais `NÃO POSSUI`

O scraper não retorna Instagram, Facebook nem WhatsApp. Marcar "Sem Instagram" quando o sistema nunca olhou é falso negativo.

Todo sinal de presença digital usa três estados: `PRESENTE`, `AUSENTE`, `DESCONHECIDO`. Só vira `AUSENTE` depois de uma verificação que efetivamente aconteceu.

Na interface, `DESCONHECIDO` aparece em cinza neutro ("Instagram não verificado"), nunca em vermelho. E **não pontua negativamente no score**.

Para WhatsApp especificamente:

| Estado | Critério |
|---|---|
| `VERIFIED` | Verificação externa confirmou. Não existe na v0.1.1 |
| `LIKELY` | Telefone brasileiro com 9 dígitos após o DDD (celular) |
| `UNKNOWN` | Telefone fixo, ausente ou fora do padrão |

O rótulo na interface é honesto: "WhatsApp provável", não "Com WhatsApp".

### 5.3 Lead duplicado não consome cota

Regra comercial obrigatória, ausente do documento mestre.

- Lead novo no tenant → consome 1 crédito
- Lead que já existe no tenant (mesmo `place_id` ou mesmo fingerprint) → atualiza os dados, **não consome crédito**
- Job que termina em `FAILED` → **devolve toda a cota reservada**

A reserva de cota acontece no início do job e a liquidação no fim, com o número real de leads novos. O cliente paga por lead novo, não por linha retornada.

### 5.4 Nenhum lead concluído fica sem score

Um job em `COMPLETED` cujos leads têm score nulo ou zero sem nenhum `LeadScoreReason` é um bug, não um resultado. Isso vira asserção de teste de integração, não só boa intenção.

O ciclo de estados garante isso: `RUNNING` → `NORMALIZING` → `SCORING` → `COMPLETED`. Nenhum lead fica visível ao usuário antes de `SCORING` terminar.

### 5.5 Dados pessoais de terceiros não são persistidos

`user_reviews`, `user_reviews_extended` e o link de perfil em `owner` trazem nome, foto e URL de pessoas físicas identificáveis. O produto precisa da média e da contagem de avaliações — não de quem escreveu.

O normalizador descarta esses campos **antes** de gravar `LeadSourceRecord`. `extra_reviews` fica permanentemente em `false`.

---

## 6. Seed de demonstração

O documento mestre pede cinco leads. **Cinco leads não permitem validar nada:** não dá para ver distribuição de score, funil com movimento, nem follow-up vencido.

| Elemento | Quantidade | Composição |
|---|---|---|
| Tenant | 1 | `Layart Agência Digital`, plano FREE |
| Usuários | 2 | Um `OWNER`, um `SDR`. Credenciais por variável de ambiente |
| Leads | 25 | Distribuídos: 6 muito alta, 7 alta, 8 média, 4 baixa. Cada um com `LeadScoreReason` completo |
| Presença digital | — | 8 `SEM_SITE`, 5 `SITE_PRECARIO`, 12 `SITE_PROPRIO`. Instagram/Facebook majoritariamente `DESCONHECIDO`, refletindo a realidade |
| Pipeline | 25 cards | Espalhados pelas 8 etapas, com peso maior nas iniciais |
| Buscas no histórico | 3 | Uma concluída, uma com duplicados, uma falha |
| Follow-ups | 6 | 2 vencidos, 3 pendentes, 1 concluído |
| Notificações | 5 | Score alto, busca concluída, busca com erro, follow-up vencido, limite próximo |
| Contatos registrados | 12 | Distribuídos entre os leads das etapas avançadas |

**Regras do seed:** dados 100% fictícios, telefones na faixa reservada de documentação, nenhum e-mail real, flag `isDemo: true` em toda entidade, execução idempotente.

O seed é gravado no PostgreSQL. **Nenhum dado de demonstração vive como mock no front-end** — se a tela mostra, veio de query.

---

## 7. Plano de execução

Ordem invertida em relação ao documento mestre, de propósito: o seed rico vem antes das telas, para que cada tela nasça com dado e o Visual QA aconteça desde a Fase 2, não no fim.

### Fase 1 — Fundação
Monorepo pnpm + Turborepo. Docker Compose com Postgres, Redis e scraper. Prisma com o schema completo e a primeira migration. Design system e tokens. App Shell (sidebar, topbar, rodapé com versão). `/health` e `/system/version`.

**Pronto quando:** `pnpm dev` sobe tudo e o App Shell renderiza com a versão vinda da API.

### Fase 2 — Auth, tenant e seed
Register, login, refresh, logout. `TenantGuard` e RBAC. `EntitlementService`. Onboarding de 5 etapas. **Seed rico completo.**

**Pronto quando:** login funciona, o tenant de demonstração tem 25 leads no banco e o teste de vazamento entre tenants passa.

### Fase 3 — Operação comercial
Meus Leads com filtros e paginação. Ficha do Lead completa. Pipeline com drag and drop. Histórico. Notas, contatos e follow-ups.

**Pronto quando:** as quatro telas operam sobre o seed, sem nenhuma linha de mock no front.

### Fase 4 — Prospecção real
`LeadSourceProvider` e o mock. Worker BullMQ. Nova Busca. Normalização, deduplicação, presença digital, score. Depois disso — e só depois — ligar o `GoogleMapsScraperProvider`.

**Pronto quando:** uma busca real no scraper produz leads deduplicados e pontuados, e repetir a mesma busca não duplica nem cobra de novo.

### Fase 5 — IA, planos e fechamento
`MockAIProvider` e o card de abordagem. Feature gates nas quatro faixas de plano. Configurações. Assinatura. Testes. Visual QA. README e CHANGELOG.

**Pronto quando:** os critérios da seção 8 passam.

---

## 8. Critérios de aceite da v0.1.1

1. `F:\drmind` não foi modificado — declarado explicitamente no relatório final
2. `pnpm install && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` sobe o ambiente a partir do zero
3. Postgres, Redis e scraper rodam isolados com prefixo `propectai-`
4. Login, refresh e logout funcionam; sessão resolve o tenant ativo
5. Teste automatizado prova que o tenant A não enxerga dado do tenant B
6. Onboarding de 5 etapas persiste e é reiniciável
7. Dashboard calcula todos os KPIs por query — nenhum número escrito no componente
8. Nova Busca completa o ciclo com o provider mock, com progresso visível
9. `GoogleMapsScraperProvider` traz leads reais do container do scraper
10. Repetir a mesma busca não duplica leads nem consome cota de novo
11. **Nenhum lead em job concluído tem score nulo ou zero sem `LeadScoreReason`**
12. A ficha do lead mostra pontos positivos e pontos de atenção do score
13. Copiar telefone, abrir mapa e abrir WhatsApp geram `LeadActivity`
14. Registrar contato atualiza a timeline; criar follow-up atualiza lista e avisos
15. Pipeline move card por drag and drop, com rollback em erro
16. Meus Leads pagina no servidor e combina filtros
17. Histórico reflete as buscas com duração e duplicados
18. IA de abordagem gera com `MockAIProvider` e salva histórico
19. Feature gates funcionam nos 4 planos, e **nenhum modal abre sem ação do usuário**
20. Versão `0.1.1` aparece no rodapé, em Configurações e em `/api/v1/system/version`
21. Swagger documenta todos os endpoints implementados
22. Nenhum dado pessoal de avaliador é persistido em lugar algum
23. Layout íntegro em 1920, 1440, 1366 e 390 px, sem overflow horizontal
24. **O módulo Construtor de Sites não existe** — sem rota, menu, tabela, flag ou menção

---

## 9. O que fica pendente de decisão comercial

Uma questão que a v0.1.1 não resolve e que precisa de resposta antes da v0.2.

Removido o Construtor de Sites, os planos passam a se diferenciar **apenas por volume de lead**. Volume de lead é commodity — Apify e Outscraper vendem mais barato. A tabela de preços fica sem um segundo eixo de valor.

Duas direções possíveis, ambas coerentes com a arquitetura já desenhada:

- **Créditos de abordagem por IA** como métrica de plano, separada do volume de leads
- **Auditoria de presença digital** com relatório exportável — que é, não por acaso, o mesmo trabalho de enriquecimento que a seção 5.2 já exige

A segunda tem uma vantagem: transforma um custo técnico obrigatório em produto vendável. A decisão fica registrada aqui como aberta.
