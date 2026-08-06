# PROMPT MESTRE — PROPECTAI v0.1.1

Você é o arquiteto principal, product designer, engenheiro full-stack, DevOps, QA e redator técnico responsável por criar o **PropectAI**, conceito de marca **Prospect + AI**.

Execute o trabalho diretamente no ambiente local, com decisões fundamentadas e o mínimo possível de perguntas. Quando houver uma escolha não crítica, use os padrões definidos neste documento. Faça perguntas apenas quando existir risco real de apagar dados, sobrescrever um projeto existente, utilizar uma credencial não fornecida ou tomar uma decisão comercial irreversível.

---

## 1. CONTEXTO DO AMBIENTE

- Sistema operacional: Windows.
- Pasta do projeto Bellvia existente: `F:\drmind`.
- O Bellvia usa Node.js, TypeScript, PostgreSQL e Docker.
- **Não modifique, mova, renomeie, pare, recrie ou reutilize nenhum arquivo, banco, container, volume, rede ou porta do Bellvia.**
- Crie o novo projeto em: `F:\prospectai`.
- O Docker Desktop já está instalado.
- O motor de coleta será o projeto open source:
  - `https://github.com/gosom/google-maps-scraper`
- O scraper deve permanecer isolado e acessível somente pela API do PropectAI em produção.
- Para desenvolvimento local, a interface original do scraper poderá ficar em `http://localhost:8081`.

Antes de criar arquivos:

1. Verifique se `F:\prospectai` já existe.
2. Se existir, inspecione seu conteúdo e preserve tudo que não foi criado por você.
3. Verifique containers, redes, volumes e portas em uso.
4. Não use comandos destrutivos globais como `docker system prune`, remoção global de volumes ou exclusão recursiva sem confirmação.
5. Crie um relatório inicial em `docs/technical/environment-audit.md` com o que foi encontrado.

---

## 2. OBJETIVO DO PRODUTO

Construir uma plataforma SaaS multi-tenant para prospecção de clientes locais. O sistema deverá:

1. Criar pesquisas por localização e nicho.
2. Enviar as pesquisas para o Google Maps Scraper.
3. Acompanhar o processamento em background.
4. Normalizar e deduplicar leads.
5. Calcular um score de oportunidade.
6. Identificar sinais de presença digital, como site, Instagram, Facebook e WhatsApp quando os dados estiverem disponíveis.
7. Organizar leads em uma base pesquisável.
8. Movimentar oportunidades em um pipeline Kanban.
9. Gerar mensagens de abordagem com IA.
10. Manter histórico, avisos, auditoria e limites por plano.
11. Preparar propostas, contratos e precificação em fases posteriores, deixando a arquitetura pronta.
12. Exibir versão do sistema e documentação dentro da aplicação.

O produto deve funcionar inicialmente para uso interno da Layart, mas nascer preparado para comercialização.

---

## 3. NOME, MARCA E RESTRIÇÕES VISUAIS

### Nome

- Nome inicial: **PropectAI**.
- Conceito: **Prospect + AI**.
- Slug técnico: `propectai`.
- Nome exibido no logo textual: `PROPECT AI`.
- Aplicar “PROPECT” em azul-marinho e “AI” em azul vivo.

### Referências visuais

Use as imagens anexadas a esta conversa como referência de:

- estrutura de navegação;
- proporções;
- densidade visual;
- cards;
- bordas;
- espaçamentos;
- hierarquia tipográfica;
- fundos azul-acinzentados;
- botões azuis;
- sidebar branca;
- topbar branca;
- modais de bloqueio e onboarding;
- dashboard, busca, leads, pipeline, histórico, IA, precificador, avisos, assinatura, configurações e ajuda.

A imagem complementar mais recente, que mostra a **ficha detalhada de um lead**, é a referência prioritária para a rota `/leads/[id]`. Reproduza sua lógica de distribuição espacial, hierarquia, densidade, cards, sidebar de pipeline, acompanhamento, observações, score, ações rápidas, histórico e follow-ups, adaptando tudo à identidade PropectAI. A referência contém ações e textos ligados a criação de sites; esses elementos devem ser ignorados conforme a restrição obrigatória deste documento.

Não reutilize o nome, logotipo ou textos proprietários “FARO AI”. Não copie arquivos, código-fonte ou ativos proprietários. Crie uma implementação original inspirada na linguagem visual apresentada.

### Restrição obrigatória

**Ignore completamente o módulo “Construtor de Sites”.**

- Não criar rota.
- Não criar item no menu.
- Não criar tabelas.
- Não criar feature flag.
- Não criar telas ou placeholders.
- Não mencionar o módulo no onboarding ou nos planos.

---

## 4. DESIGN SYSTEM

Implemente os tokens abaixo como CSS variables e também no tema do Tailwind.

```css
:root {
  --color-navy-950: #0F1B33;
  --color-navy-900: #14213D;
  --color-blue-600: #2F6BFF;
  --color-blue-700: #1F56D9;
  --color-blue-100: #DCEAFF;
  --color-blue-50: #EAF2FC;
  --color-surface: #FFFFFF;
  --color-surface-soft: #F5F8FD;
  --color-app-bg: #EAF2FC;
  --color-border: #D8E3F1;
  --color-text: #14213D;
  --color-text-muted: #6B7A99;
  --color-success: #22C55E;
  --color-warning: #F59E0B;
  --color-danger: #EF4444;
  --color-info: #3B82F6;
}
```

### Tipografia

- Fonte principal: `Inter`.
- Fallback: `ui-sans-serif, system-ui, sans-serif`.
- Título de página: 28 a 32 px, peso 700.
- Subtítulo: 14 a 16 px, peso 400, cor muted.
- Título de card: 12 a 14 px, peso 600 ou 700.
- KPI principal: 32 a 40 px, peso 700.
- Label de campo: 11 a 12 px, uppercase opcional, peso 600.
- Texto de tabela: 13 a 14 px.

### Geometria

- Sidebar desktop: 160 a 184 px.
- Topbar: 56 a 64 px.
- Cards: raio entre 12 e 16 px.
- Inputs e botões: raio entre 8 e 10 px.
- Borda: 1 px `var(--color-border)`.
- Sombra discreta: `0 8px 24px rgba(15, 27, 51, 0.06)`.
- Espaçamento principal de página: 20 a 24 px.
- Gap entre cards: 12 a 16 px.

### Estados

- Hover: aumentar contraste sem deslocar layout.
- Focus: ring azul visível e acessível.
- Disabled: opacidade reduzida, cursor not-allowed e explicação quando bloqueado por plano.
- Loading: skeletons e indicadores de progresso.
- Empty state: ícone, título, texto e ação principal.
- Error state: mensagem clara, ação de repetir e código técnico expansível.

### Responsividade

- Desktop first, baseado nas referências de 1440 a 1920 px.
- Tablet: sidebar recolhível.
- Mobile: menu em drawer, cards empilhados e tabelas com visual alternativo em cards.
- Nenhuma tela poderá depender de largura fixa de 1920 px.

### Acessibilidade

- WCAG 2.1 AA.
- Navegação por teclado.
- `aria-label` em ícones.
- Contraste suficiente.
- Focus visível.
- Labels associados aos inputs.
- Modais com foco preso, fechamento por Escape e retorno de foco.

---

## 5. STACK OBRIGATÓRIA

Crie um monorepo com `pnpm workspaces` e Turborepo.

### Aplicações

- `apps/web`: Next.js com App Router, TypeScript, Tailwind CSS e shadcn/ui.
- `apps/api`: NestJS, TypeScript, Swagger, Prisma e autenticação.
- `apps/worker`: NestJS standalone ou Node TypeScript para BullMQ.

### Pacotes compartilhados

- `packages/ui`: componentes e tokens visuais.
- `packages/config`: ESLint, TypeScript e Prettier.
- `packages/types`: DTOs e tipos compartilhados sem acoplamento indevido.
- `packages/sdk`: cliente tipado da API.

### Infraestrutura

- PostgreSQL 16.
- Redis 7.
- BullMQ.
- Docker Compose.
- Google Maps Scraper em container separado.
- MinIO opcional somente quando houver necessidade de armazenar exportações; não adicionar sem uso real na v0.1.1.

### Bibliotecas sugeridas

- UI: shadcn/ui e Radix UI.
- Ícones: Lucide React.
- Formulários: React Hook Form e Zod.
- Tabelas: TanStack Table.
- Kanban: dnd-kit.
- Gráficos: Recharts.
- Estado servidor: TanStack Query.
- Autenticação: JWT access token curto e refresh token seguro em cookie HttpOnly.
- Senhas: Argon2.
- Logs: Pino.
- Testes: Vitest/Jest, Supertest e Playwright.

Não adicionar bibliotecas duplicadas para a mesma finalidade.

---

## 6. PORTAS LOCAIS

Use estas portas, mas confirme antes se estão disponíveis:

| Serviço | Porta |
|---|---:|
| Web Next.js | 3100 |
| API NestJS | 3101 |
| PostgreSQL | 5434 |
| Redis | 6381 |
| Google Maps Scraper | 8081 |
| Prisma Studio opcional | 5556 |

Se uma porta estiver ocupada, registre a alteração no `.env.example`, no README e em `docs/technical/environment-audit.md`.

---

## 7. ESTRUTURA DE DIRETÓRIOS

Crie esta estrutura ou uma equivalente justificada:

```text
F:\prospectai
├── apps
│   ├── web
│   ├── api
│   └── worker
├── packages
│   ├── ui
│   ├── config
│   ├── types
│   └── sdk
├── prisma
│   ├── schema.prisma
│   ├── migrations
│   └── seed.ts
├── infra
│   ├── docker
│   └── scripts
├── data
│   └── gmaps
├── docs
│   ├── technical
│   ├── strategic
│   └── commercial
├── .env.example
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── README.md
└── CHANGELOG.md
```

---

## 8. DOCKER COMPOSE

Crie serviços isolados, com nomes prefixados por `propectai-`:

- `propectai-web`
- `propectai-api`
- `propectai-worker`
- `propectai-postgres`
- `propectai-redis`
- `propectai-gmaps-scraper`

Regras:

1. Não reutilizar a rede do Bellvia.
2. Criar rede `propectai-network`.
3. Criar volumes nomeados com prefixo `propectai-`, exceto a pasta persistente do scraper, que deverá apontar para `./data/gmaps`.
4. Expor o scraper em `127.0.0.1:8081:8080` apenas em desenvolvimento.
5. Em produção, não publicar a porta do scraper; somente API e worker poderão acessá-lo pela rede Docker.
6. Adicionar healthchecks para PostgreSQL, Redis, API e scraper quando tecnicamente possível.
7. Configurar dependências por healthcheck, não apenas por ordem de criação.
8. Desativar telemetria do scraper com `DISABLE_TELEMETRY=1`.
9. Nunca colocar credenciais reais no compose versionado.

---

## 9. ARQUITETURA MULTI-TENANT

Implemente multi-tenancy desde a primeira migration.

### Regras

- Toda entidade de negócio deverá possuir `tenantId`.
- Usuário poderá participar de um ou mais tenants por meio de `Membership`.
- Papéis iniciais: `OWNER`, `ADMIN`, `MANAGER`, `SDR`, `VIEWER`.
- O tenant ativo deverá ser resolvido por sessão e, quando necessário, pelo header `x-tenant-id`.
- Nunca confiar em `tenantId` enviado no body sem validar membership.
- Criar `TenantGuard` no NestJS.
- Criar serviços/repositórios que recebam o contexto do tenant.
- Todos os índices únicos de negócio devem considerar `tenantId` quando aplicável.
- Testar vazamento horizontal de dados entre tenants.

### Entidades principais

Implemente no Prisma:

- `User`
- `Tenant`
- `Membership`
- `Plan`
- `Subscription`
- `PlanUsage`
- `OnboardingState`
- `ProspectingSearch`
- `ScrapeJob`
- `Lead`
- `LeadSourceRecord`
- `LeadDigitalPresence`
- `LeadScore`
- `LeadScoreReason`
- `LeadTag`
- `Tag`
- `PipelineStage`
- `PipelineCard`
- `LeadActivity`
- `LeadNote`
- `LeadFollowUp`
- `LeadContactRecord`
- `OutreachMessage`
- `Notification`
- `SuppressionEntry`
- `ExportJob`
- `AuditLog`
- `AppSetting`
- `FeatureFlag`

Use UUIDs ou CUID2. Defina `createdAt`, `updatedAt` e campos de autoria quando necessário.

---

## 10. PLANOS NATIVOS E FEATURE GATES

Implemente os planos:

### FREE

- 5 leads de demonstração.
- Telefones parcialmente ocultos na interface.
- Sem exportação.
- Pipeline somente leitura ou bloqueado por modal.
- IA de abordagem bloqueada.
- Recursos futuros com explicação clara.

### START

- 150 leads incluídos.
- Pipeline básico.
- IA de abordagem com limite mensal.
- Exportação CSV.
- Um usuário por tenant.

### PRO

- 500 leads incluídos.
- Pipeline completo.
- Exportação CSV e Excel.
- IA com limite maior.
- Propostas, contratos e precificador.
- Usuários adicionais.

### AGENCY

- 3.000 leads incluídos.
- Multiusuário.
- Múltiplos clientes ou unidades dentro do tenant, preparados por estrutura de workspace.
- Auditoria ampliada.
- Limites maiores.
- Suporte prioritário.

Os valores comerciais devem ser configuráveis por seed ou admin, nunca hardcoded em componentes espalhados.

Implemente um serviço central `EntitlementService` para verificar:

- acesso a módulo;
- limite de leads;
- limite de pesquisas;
- limite de gerações por IA;
- exportação;
- usuários;
- retenção.

---

## 11. ONBOARDING E PRODUCT TOUR

Na primeira entrada, abrir um modal central com fundo desfocado e cinco etapas.

### Etapa 1 — Qual serviço você vende?

Opções:

- Sites
- Tráfego pago
- Social media
- Design
- Consultoria
- Outro serviço

O item “Sites” representa o serviço vendido pelo usuário, não um módulo de criação de sites.

### Etapa 2 — Quais nichos você prospecta?

Sugestões:

- Clínicas de estética
- Salões de beleza
- Barbearias
- Academias
- Restaurantes
- Advogados
- Dentistas
- Imobiliárias
- Pet shops
- Contadores
- Oficinas mecânicas
- Lojas de roupas
- Campo livre para adicionar nicho

### Etapa 3 — Quais cidades ou regiões atende?

- Campo com tags.
- Sugestões por histórico.
- Suporte a cidade, bairro ou região.

### Etapa 4 — Canal preferido

- WhatsApp
- Instagram
- E-mail
- Ligação

### Etapa 5 — Meta mensal

- 1 a 3
- 4 a 10
- 11 a 20
- Mais de 20

Requisitos:

- Barra de progresso.
- Botão “Pular”.
- Botão “Continuar”.
- Validação por etapa.
- Persistir progresso.
- Permitir reiniciar em Configurações.

Após concluir, iniciar Product Tour guiado:

1. Dashboard.
2. Nova Busca.
3. Meus Leads.
4. Pipeline.
5. Histórico.
6. IA de Abordagem.
7. Avisos e Configurações.

---

## 12. APP SHELL

### Sidebar

Itens nesta ordem:

1. Dashboard
2. Nova Busca
3. Meus Leads
4. Pipeline
5. Histórico
6. IA de Abordagem
7. Propostas
8. Contratos
9. Precificador
10. Avisos

Separador inferior:

- Fazer Upgrade
- Assinatura
- Configurações
- Ajuda
- Sair

Não criar “Construtor de Sites”.

### Topbar

- Breadcrumb.
- Indicação de dias de teste quando aplicável.
- Botão “Ativar Plano”.
- Badge do plano atual.
- Nome, e-mail e avatar do usuário.
- Menu do perfil.

### Rodapé discreto

Exibir:

- `PropectAI v0.1.1`
- ambiente;
- status da API;
- link “Documentação”.

---

## 13. ESPECIFICAÇÃO DAS TELAS

### 13.1 Dashboard — `/dashboard`

Cabeçalho:

- Título “Visão Geral”.
- Subtítulo “Acompanhe suas oportunidades e prospecções.”
- Botão “Nova Busca”.

Primeira linha de KPIs:

1. Leads encontrados.
2. Oportunidades altas — card azul destacado.
3. Pipeline ativo.

Segunda linha de KPIs:

1. Score médio.
2. Sem website.
3. Com WhatsApp.
4. Follow-ups.

Conteúdo inferior:

- Card “Buscas Recentes”.
- Card “Funil de Vendas”.
- Ações rápidas:
  - Nova Busca de Leads.
  - Gerar Abordagem IA.
  - Ver Oportunidades Altas.

Estados:

- Empty state quando não houver busca.
- Skeleton durante carregamento.
- Erro com botão de repetir.

### 13.2 Nova Busca — `/search`

Campos:

- Estado.
- Cidade dependente do estado.
- Nicho com busca e criação de termo personalizado.
- Bairro ou região opcional.
- Raio em quilômetros.
- Quantidade de leads conforme plano.
- Filtros avançados em seção recolhível:
  - possui site;
  - sem site;
  - possui telefone;
  - possui e-mail;
  - nota mínima;
  - avaliações mínimas;
  - somente empresas abertas.

Botão: “Buscar Oportunidades”.

Fluxo:

1. Validar entitlement e saldo do tenant.
2. Criar `ProspectingSearch`.
3. Criar `ScrapeJob`.
4. Enviar job ao BullMQ.
5. Worker chamar o provider do scraper.
6. Interface acompanhar via polling ou SSE.
7. Mostrar progresso, mensagem e contagem.
8. Ao concluir, carregar cards de resumo e resultados.

KPIs pós-busca:

- Leads encontrados.
- Score médio.
- Sem site detectado.
- Com WhatsApp.

Cards de resultado:

- Nome.
- Categoria.
- Cidade/UF.
- Score e nível.
- Sinais de presença digital.
- Botões “Ver Detalhes”, “WhatsApp” quando aplicável e “Abordagem IA”.
- Não exibir botão “Gerar Site”.

### 13.3 Meus Leads — `/leads`

Topo:

- Título e quantidade.
- Botões CSV e Excel conforme plano.
- Banner de limite ou ocultação no FREE.

Filtros:

- Estado.
- Nicho.
- Cidade.
- Sem site.
- Sem Instagram.
- Com WhatsApp.
- Favoritos.
- Score alto.
- Status do pipeline.

Tabela:

- Seleção.
- Empresa.
- Localização.
- Contato.
- Score.
- Presença digital.
- Etapa.
- Responsável.
- Ações.

Ações:

- Favoritar.
- Adicionar ao pipeline.
- Gerar abordagem.
- Ver detalhes.
- Adicionar à lista de supressão.
- Excluir do tenant sem apagar auditoria.

### 13.4 Detalhes do Lead — `/leads/[id]`

Esta tela é uma das áreas centrais do produto. Use a imagem complementar anexada como referência prioritária de layout, mas crie componentes originais e aplique a marca PropectAI.

#### Objetivo da página

Concentrar em uma única visão todas as informações necessárias para o usuário avaliar, qualificar, abordar e acompanhar um lead, sem precisar alternar entre várias páginas. A tela deve carregar dados reais do lead e não utilizar valores mockados fora do seed de desenvolvimento.

#### Cabeçalho contextual

No topo da área de conteúdo, mostrar:

- breadcrumb `PropectAI > Meus Leads > [Nome do lead]`;
- nome da empresa;
- categoria ou nicho;
- cidade e UF;
- badges principais, como `Sem site`, `Com WhatsApp`, `Alta oportunidade`, `Favorito` e `Suprimido`;
- status atual do pipeline;
- score com nível visual, por exemplo `Alta (85)`;
- ação de voltar para a lista preservando filtros, ordenação e página anteriores.

Não exibir botão, link ou menção a `Criar Site`, `Gerar Site`, `Construtor de Sites` ou qualquer ação equivalente.

#### Layout desktop

Usar grid principal com duas regiões:

- coluna principal ocupando aproximadamente 68% a 72% da largura;
- sidebar direita ocupando aproximadamente 28% a 32%;
- gap entre regiões de 12 a 16 px;
- cards brancos, bordas discretas e fundo azul-acinzentado;
- sidebar sticky abaixo da topbar quando houver altura disponível;
- não permitir que a sidebar cubra o conteúdo ou dependa de largura fixa.

Em tablet, permitir que a sidebar seja recolhida. Em mobile, empilhar todos os blocos, posicionando pipeline e acompanhamento depois das informações principais.

#### Card “Informações de contato”

Criar um card amplo com duas colunas internas no desktop. Exibir somente campos disponíveis e usar placeholder informativo quando um dado não tiver sido encontrado.

Campos:

- telefone principal;
- telefones alternativos;
- botão `Copiar` com feedback por toast;
- botão para iniciar WhatsApp somente quando houver número compatível;
- endereço completo;
- botão `Abrir no Google Maps` em nova aba com `noopener noreferrer`;
- horário de funcionamento;
- situação atual `Aberto`, `Fechado` ou `Horário indisponível`, quando calculável;
- website e estado `Sem website`;
- Instagram, Facebook e outras redes detectadas;
- link de visualização do perfil social;
- avaliação média do Google;
- quantidade de avaliações;
- link para a origem quando permitido;
- data da última atualização dos dados.

Regras:

- telefones devem respeitar mascaramento do plano FREE;
- não renderizar links vazios ou inventados;
- copiar telefone, abrir mapa, abrir rede social e iniciar WhatsApp devem gerar `LeadActivity`;
- toda URL externa deve ser validada e sanitizada;
- dados pessoais potencialmente sensíveis não devem ser destacados sem necessidade comercial legítima.

#### Card “Score de oportunidade”

Exibir:

- score numérico de 0 a 100;
- badge de nível `Baixa`, `Média`, `Alta` ou `Muito alta`;
- data do último cálculo;
- botão `Recalcular score`, condicionado à permissão;
- indicadores de presença digital: site, celular/telefone, WhatsApp, Instagram, Facebook e avaliações;
- seção `Pontos positivos`;
- seção `Pontos de atenção`;
- pesos e motivos em formato compreensível;
- tooltip explicando que o score é uma priorização comercial, não uma garantia de conversão.

Exemplos de motivos positivos:

- não possui site próprio;
- WhatsApp disponível;
- volume relevante de avaliações;
- perfil social ativo;
- endereço completo;
- segmento prioritário do tenant.

Exemplos de pontos de atenção:

- telefone ausente;
- empresa temporariamente fechada;
- avaliação muito baixa;
- dados desatualizados;
- lead já contatado recentemente;
- entrada na lista de supressão;
- duplicidade provável.

O score deve ser explicado por registros `LeadScoreReason`; não armazenar apenas o número final.

#### Card “Ações rápidas”

Disponibilizar, conforme permissões, plano e presença dos dados:

- `Copiar telefone`;
- `Abrir WhatsApp`;
- `Gerar abordagem`;
- seletor para mudar a etapa do pipeline;
- `Registrar contato`;
- `Criar follow-up`;
- `Criar proposta`, quando o módulo estiver habilitado;
- `Marcar como contatado`;
- `Favoritar` ou `Remover favorito`;
- `Descartar`;
- `Adicionar à supressão`;
- menu secundário com `Editar dados`, `Recalcular score`, `Ver origem` e `Registrar problema`.

É proibido incluir `Criar Site` ou qualquer substituto dessa funcionalidade.

Ações destrutivas ou de supressão exigem confirmação com explicação do efeito. Toda ação deve gerar auditoria.

#### Card “IA de abordagem”

Criar uma área dedicada a mensagens personalizadas com base nos dados do lead.

Conteúdo:

- texto explicativo;
- seleção de canal: WhatsApp, e-mail, Instagram ou ligação;
- serviço oferecido, preenchido pelas preferências do tenant;
- tom: consultivo, direto, informal ou executivo;
- objetivo e CTA;
- observações adicionais;
- botão `Gerar`;
- estados loading, sucesso, erro e limite excedido;
- resultado editável;
- ações `Copiar`, `Salvar`, `Regenerar` e `Registrar como enviado`;
- histórico das versões geradas.

Feature gate:

- no FREE, manter o card visível e contextualizado, mas bloquear a geração;
- abrir modal de upgrade somente depois de uma tentativa explícita do usuário;
- não abrir modal automaticamente ao carregar a página;
- o modal deve listar apenas recursos existentes no PropectAI;
- remover qualquer menção a criação ou construtor de sites;
- usuários internos com entitlement administrativo podem acessar sem bloqueio comercial.

#### Card “Histórico de contatos”

Mostrar timeline ordenada da mais recente para a mais antiga. Cada registro deve conter:

- data e hora;
- usuário responsável;
- canal;
- direção `Enviado` ou `Recebido`;
- resultado;
- observação;
- vínculo opcional com abordagem gerada;
- mudança de pipeline causada pelo contato;
- anexos ou links somente quando a infraestrutura suportar com segurança.

Botão `Registrar` abre modal ou drawer com formulário. Não apagar definitivamente registros; permitir correção por evento de retificação e auditoria.

#### Card “Follow-ups”

Mostrar:

- follow-ups pendentes, concluídos, vencidos e cancelados;
- data e hora;
- responsável;
- canal planejado;
- prioridade;
- observação;
- ação `Concluir`;
- ação `Reagendar`;
- ação `Cancelar`;
- botão `Agendar`.

Follow-up vencido deve gerar aviso e aparecer no dashboard. A criação e alteração devem respeitar timezone do tenant.

#### Sidebar “Pipeline”

Exibir verticalmente todas as etapas, com destaque forte na etapa atual:

1. Novo.
2. Contato Enviado.
3. Respondeu.
4. Reunião Agendada.
5. Proposta Enviada.
6. Negociação.
7. Fechado.
8. Perdido.

Requisitos:

- clicar em etapa permitida altera o status após confirmação quando necessário;
- aplicar atualização otimista com rollback em erro;
- registrar usuário, etapa anterior, etapa nova, data e origem da mudança;
- impedir transições inválidas configuradas pelo tenant;
- `Fechado` pode solicitar valor estimado e serviço contratado;
- `Perdido` deve solicitar motivo opcional ou obrigatório conforme configuração;
- bloqueio por plano deve manter a visualização e explicar o motivo.

#### Sidebar “Acompanhamento”

Mostrar:

- status comercial atual;
- responsável;
- última ação registrada;
- próxima ação;
- data do próximo follow-up;
- data da última atualização;
- campo de observações livres;
- botão `Salvar observação`;
- histórico ou contagem de observações anteriores;
- indicação visual quando existem alterações não salvas.

Observações devem ser armazenadas como `LeadNote`, com autoria e timestamps. Não sobrescrever silenciosamente notas anteriores.

#### Abas complementares

Além da visão geral, disponibilizar abas ou seções secundárias:

- `Presença digital`;
- `Score e motivos`;
- `Atividades`;
- `Abordagens`;
- `Dados de origem`.

A aba `Dados de origem` deve ser restrita a administradores e mostrar payload bruto de forma expansível, com dados sensíveis mascarados.

#### Estados da tela

Implementar:

- skeleton individual por card;
- estado de lead inexistente;
- acesso negado por tenant;
- lead suprimido;
- dados parcialmente disponíveis;
- erro de carregamento com retry;
- atualização concorrente com aviso de conflito;
- toast de sucesso ou erro para todas as ações;
- proteção contra clique duplo em ações assíncronas.

#### Componentes sugeridos

Criar componentes reutilizáveis, evitando uma página monolítica:

- `LeadDetailHeader`;
- `LeadContactCard`;
- `LeadScoreCard`;
- `LeadQuickActions`;
- `LeadOutreachCard`;
- `LeadContactTimeline`;
- `LeadFollowUpList`;
- `LeadPipelineSidebar`;
- `LeadTrackingCard`;
- `LeadNoteComposer`;
- `PlanGateModal`;
- `LeadSourceDataDrawer`.

#### Critérios específicos de aceite

- nenhum elemento de criação de site aparece na página ou nos modais;
- todos os dados exibidos pertencem ao tenant ativo;
- a etapa atual do pipeline é visível sem rolagem excessiva em desktop;
- copiar telefone produz feedback;
- links externos funcionam e são seguros;
- score apresenta motivos positivos e pontos de atenção;
- registrar contato atualiza timeline e acompanhamento;
- criar follow-up atualiza a lista e os avisos;
- salvar observação preserva autoria e histórico;
- feature gates não abrem modal automaticamente;
- a página funciona em 1366, 1440, 1920 px e mobile;
- todos os fluxos principais possuem testes unitários, de integração e E2E.

### 13.5 Pipeline — `/pipeline`

Colunas iniciais:

1. Novo.
2. Contato Enviado.
3. Respondeu.
4. Reunião Agendada.
5. Proposta Enviada.
6. Negociação.
7. Fechado.
8. Perdido.

Requisitos:

- Drag and drop com dnd-kit.
- Persistência otimista e rollback em erro.
- Contagem por coluna.
- Filtros por responsável, score, nicho e cidade.
- Drawer de detalhes ao clicar no card.
- Histórico de movimentação.
- Feature gate por plano com modal elegante, sem ocultar o contexto da tela.

### 13.6 Histórico — `/history`

KPIs:

- Total de buscas.
- Total de leads.
- Média por busca.
- Taxa de duplicidade.

Tabela:

- Data.
- Nicho.
- Localização.
- Status.
- Leads.
- Duplicados.
- Duração.
- Ações.

Ações:

- Ver leads.
- Repetir busca.
- Baixar exportação.
- Excluir registro, preservando auditoria.

### 13.7 IA de Abordagem — `/ai-outreach`

Layout com coluna de seleção à esquerda e área principal à direita.

Inputs:

- Lead.
- Canal.
- Tom.
- Serviço oferecido.
- Objetivo.
- CTA.
- Observações.

Saídas:

- Mensagem curta.
- Mensagem consultiva.
- E-mail.
- Follow-up.

Regras:

- Na v0.1.1, criar interface `AIProvider`.
- Provider padrão local: `MockAIProvider`, sem exigir chave externa.
- Preparar `OpenAIProvider` e `AnthropicProvider` apenas como adapters documentados, sem ativar ou inserir chaves.
- Registrar prompts, modelo, tokens estimados, versão e usuário.
- Permitir copiar, editar, salvar e registrar como atividade.
- Não disparar mensagens automaticamente na v0.1.1.

### 13.8 Propostas — `/proposals`

Na v0.1.1:

- Estrutura funcional mínima.
- Lista, status e vínculo com lead.
- Criar proposta básica com itens e valor.
- Exportação poderá ficar como “planejado”, claramente documentada.

### 13.9 Contratos — `/contracts`

Na v0.1.1:

- Lista e vínculo com proposta/lead.
- Status: rascunho, enviado, assinado, cancelado.
- Não implementar assinatura digital real sem provedor.
- Criar adapter e tela de placeholder funcional, sem prometer assinatura concluída.

### 13.10 Precificador — `/pricing-calculator`

Campos:

- Tipo de serviço.
- Valor hora.
- Horas previstas.
- Complexidade.
- Urgência.
- Extras configuráveis.
- Margem.

Saída lateral:

- Valor base.
- Valor final.
- Faixa mínima, ideal e premium.
- Simulação de lucro.

Valores devem ser configuráveis por tenant.

### 13.11 Avisos — `/notifications`

Tipos:

- Lead com score alto.
- Pesquisa concluída.
- Pesquisa com erro.
- Follow-up vencido.
- Limite próximo.
- Resumo semanal.
- Atualização de perfil do lead quando houver reprocessamento.

Criar centro de notificações real, mesmo que algumas automações sejam ativadas em fases posteriores.

### 13.12 Assinatura — `/subscription`

- Cards FREE, START, PRO e AGENCY.
- Comparação de recursos.
- Consumo atual.
- Histórico de recargas ou alterações.
- Provider de pagamento abstrato.
- Na v0.1.1, usar modo mock e não inventar integração financeira.

### 13.13 Configurações — `/settings`

Seções:

- Preferências de prospecção.
- Serviços vendidos.
- Nichos.
- Cidades/regiões.
- Canal preferido.
- Meta mensal.
- Perfil.
- Segurança.
- Equipe e papéis.
- Tenant ativo.
- Retenção e privacidade.
- Integrações.
- Versão do sistema.
- Reiniciar onboarding e Product Tour.

### 13.14 Ajuda — `/help`

Cards:

- Documentação.
- Tutoriais.
- Suporte.
- FAQ.

A documentação técnica não deve ficar pública para usuários sem permissão administrativa. A central de ajuda deve apresentar conteúdo conforme o papel.

---

## 14. INTEGRAÇÃO COM O GOOGLE MAPS SCRAPER

Crie uma abstração:

```ts
export interface LeadSourceProvider {
  createSearch(input: CreateSourceSearchInput): Promise<SourceJob>;
  getJob(jobId: string): Promise<SourceJobStatus>;
  getResults(jobId: string): Promise<RawLead[]>;
  cancelJob(jobId: string): Promise<void>;
}
```

Implemente:

- `GoogleMapsScraperProvider`.
- `MockLeadSourceProvider` para testes.
- `CsvImportProvider` preparado para importação.

### Fluxo do worker

1. Receber job da fila.
2. Validar tenant e estado do job.
3. Enviar consulta ao scraper.
4. Acompanhar status.
5. Baixar resultados.
6. Armazenar payload bruto em `LeadSourceRecord`.
7. Normalizar campos.
8. Deduplicar.
9. Calcular presença digital.
10. Calcular score.
11. Atualizar consumo do plano.
12. Criar notificação.
13. Gravar `AuditLog`.
14. Marcar job como concluído ou falho.

### Idempotência

- Todo job deve possuir `idempotencyKey`.
- Reprocessamento não pode duplicar leads.
- Use `source + sourceId + tenantId` como parte da estratégia.
- Quando sourceId não existir, usar fingerprint normalizado de nome, telefone, endereço e website.

### Estados de job

- `PENDING`
- `QUEUED`
- `RUNNING`
- `NORMALIZING`
- `SCORING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

---

## 15. SCORE DE OPORTUNIDADE

Implemente inicialmente um motor determinístico e versionado.

Exemplo de pesos configuráveis:

- Sem site: +30.
- Site sem HTTPS: +15.
- Site não responsivo: +15.
- Poucas avaliações: +10.
- Perfil incompleto: +10.
- E-mail corporativo: +10.
- Telefone disponível: +5.
- Nicho prioritário do tenant: +15.
- WhatsApp detectado: +5.
- Empresa fechada permanentemente: desqualificar.

Faixas:

- 0–39: baixa.
- 40–69: média.
- 70–84: alta.
- 85–100: muito alta.

Requisitos:

- Limitar resultado entre 0 e 100.
- Armazenar versão do algoritmo.
- Armazenar cada motivo em `LeadScoreReason`.
- Permitir recálculo.
- Mostrar explicação na interface.
- Não deixar a IA inventar dados ausentes.

---

## 16. API E ENDPOINTS

Prefixo obrigatório: `/api/v1`.

Crie pelo menos:

### Sistema

- `GET /api/v1/health`
- `GET /api/v1/system/version`

### Autenticação

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

### Tenants

- `GET /api/v1/tenants`
- `POST /api/v1/tenants`
- `GET /api/v1/tenants/:id`
- `PATCH /api/v1/tenants/:id`
- `GET /api/v1/tenants/:id/members`
- `POST /api/v1/tenants/:id/members`

### Onboarding

- `GET /api/v1/onboarding`
- `PATCH /api/v1/onboarding`
- `POST /api/v1/onboarding/complete`
- `POST /api/v1/onboarding/reset`

### Pesquisas e jobs

- `POST /api/v1/prospecting/searches`
- `GET /api/v1/prospecting/searches`
- `GET /api/v1/prospecting/searches/:id`
- `POST /api/v1/prospecting/searches/:id/retry`
- `POST /api/v1/prospecting/jobs/:id/cancel`
- `GET /api/v1/prospecting/jobs/:id`

### Leads

- `GET /api/v1/leads`
- `GET /api/v1/leads/:id`
- `PATCH /api/v1/leads/:id`
- `POST /api/v1/leads/:id/favorite`
- `DELETE /api/v1/leads/:id/favorite`
- `POST /api/v1/leads/:id/recalculate-score`
- `POST /api/v1/leads/:id/suppress`
- `POST /api/v1/leads/export`
- `GET /api/v1/leads/:id/activities`
- `POST /api/v1/leads/:id/contact-records`
- `PATCH /api/v1/leads/:id/contact-records/:recordId`
- `GET /api/v1/leads/:id/notes`
- `POST /api/v1/leads/:id/notes`
- `GET /api/v1/leads/:id/follow-ups`
- `POST /api/v1/leads/:id/follow-ups`
- `PATCH /api/v1/leads/:id/follow-ups/:followUpId`
- `POST /api/v1/leads/:id/follow-ups/:followUpId/complete`
- `POST /api/v1/leads/:id/follow-ups/:followUpId/cancel`
- `PATCH /api/v1/leads/:id/pipeline-stage`

### Pipeline

- `GET /api/v1/pipeline`
- `POST /api/v1/pipeline/cards`
- `PATCH /api/v1/pipeline/cards/:id/move`
- `DELETE /api/v1/pipeline/cards/:id`

### IA

- `POST /api/v1/ai/outreach/generate`
- `GET /api/v1/ai/outreach/history`
- `PATCH /api/v1/ai/outreach/:id`

### Notificações

- `GET /api/v1/notifications`
- `PATCH /api/v1/notifications/:id/read`
- `POST /api/v1/notifications/read-all`

### Assinatura e uso

- `GET /api/v1/subscription`
- `GET /api/v1/subscription/usage`
- `GET /api/v1/plans`

### Auditoria

- `GET /api/v1/audit-logs`

Para cada endpoint:

1. Adicionar `@ApiOperation` com resumo e descrição detalhada.
2. Explicar o que o endpoint faz.
3. Informar permissões e plano necessário.
4. Documentar DTOs.
5. Documentar respostas e erros.
6. Informar efeitos no banco e eventos de auditoria quando aplicável.
7. Validar tenant.
8. Não inserir assinatura pessoal no código.

---

## 17. SEGURANÇA E PRIVACIDADE

Implemente:

- Argon2 para senha.
- Access token curto.
- Refresh token com rotação e hash no banco.
- Cookies HttpOnly, Secure em produção e SameSite apropriado.
- Rate limit.
- Helmet.
- CORS restrito.
- Validação global de DTOs.
- Proteção contra mass assignment.
- RBAC.
- TenantGuard.
- Logs sem segredos ou dados pessoais completos.
- Auditoria de exportações, alterações de plano, supressões e acessos administrativos.
- Lista de supressão.
- Retenção configurável.
- Exclusão lógica quando necessário.
- Exportação e correção de dados.
- Política de não disparar abordagem automática na v0.1.1.

Crie `docs/technical/privacy-and-compliance.md` explicando que dados publicamente acessíveis ainda precisam de finalidade, necessidade, transparência, balanceamento e salvaguardas.

---

## 18. AVISOS, AUTOMAÇÕES E AGENTES

Estruture agentes e jobs com o mínimo de interação humana, porém não automatize contatos externos sem aprovação.

Agentes lógicos:

- `ProspectingPlannerAgent`: transforma ICP em consultas.
- `DataQualityAgent`: normaliza e deduplica.
- `LeadScoringAgent`: calcula score e motivos.
- `WebsiteAuditAgent`: arquitetura preparada, sem auditoria invasiva na v0.1.1.
- `OutreachAgent`: gera rascunhos.
- `ComplianceGuard`: verifica supressão, origem e regras.
- `OpsAgent`: monitora jobs e falhas.
- `QAAgent`: executa testes e registra evidências.

Todos os agentes devem possuir interfaces, logs e versões. Use implementações determinísticas ou mocks quando não houver provider externo.

---

## 19. DOCUMENTAÇÃO OBRIGATÓRIA

Crie e mantenha:

### Técnica

- `README.md`
- `docs/technical/environment-audit.md`
- `docs/technical/architecture.md`
- `docs/technical/data-model.md`
- `docs/technical/api.md`
- `docs/technical/docker.md`
- `docs/technical/runbook.md`
- `docs/technical/security.md`
- `docs/technical/privacy-and-compliance.md`
- `docs/technical/testing.md`
- `docs/technical/troubleshooting.md`

### Estratégica

- `docs/strategic/product-vision.md`
- `docs/strategic/icp.md`
- `docs/strategic/scoring.md`
- `docs/strategic/roadmap.md`
- `docs/strategic/kpis.md`
- `docs/strategic/competitors.md`

No estudo de concorrentes, analisar ao menos:

- FARO AI como referência visual e de posicionamento, sem copiar propriedade intelectual.
- Apollo.
- Clay.
- Outscraper.
- Apify.
- LeadsDB.
- Google Places API.

Para cada concorrente, registrar pontos fortes, limitações e como o PropectAI pretende superar ou diferenciar-se.

### Comercial

- `docs/commercial/plans.md`
- `docs/commercial/onboarding.md`
- `docs/commercial/sales-narrative.md`
- `docs/commercial/faq.md`

### Versionamento

- `CHANGELOG.md` seguindo SemVer.
- Versão inicial `0.1.0`.
- Endpoint de versão.
- Versão visível na interface.

---

## 20. SQUADS ENVOLVIDOS

Crie `docs/strategic/squads.md` com:

### Product & Strategy Squad

- visão;
- ICP;
- roadmap;
- planos;
- KPIs;
- regras de score.

### UX & Frontend Squad

- design system;
- telas;
- acessibilidade;
- onboarding;
- Product Tour.

### Backend & Data Squad

- API;
- banco;
- multi-tenancy;
- integração;
- qualidade dos dados.

### DevOps & Security Squad

- Docker;
- CI/CD;
- backup;
- observabilidade;
- segurança;
- incidentes.

### Growth & RevOps Squad

- segmentação;
- pipeline;
- abordagem;
- conversão;
- métricas.

### Compliance Squad

- privacidade;
- retenção;
- supressão;
- fontes permitidas.

### QA Squad

- testes;
- critérios de aceite;
- regressão;
- evidências.

Ao final de cada fase, informe quais squads atuaram e quais artefatos produziram.

---

## 21. TESTES E QUALIDADE

### Backend

- Unit tests para score, entitlement, tenant context e deduplicação.
- Integration tests com PostgreSQL e Redis de teste.
- Supertest para endpoints principais.
- Testes explícitos de vazamento entre tenants.
- Testes de idempotência.

### Frontend

- Component tests para forms, cards, tabela e modais.
- Playwright para:
  - cadastro e login;
  - onboarding;
  - criar busca com provider mock;
  - visualizar leads;
  - mover card no pipeline;
  - gerar abordagem mock;
  - visualizar plano bloqueado;
  - reiniciar Product Tour.

### Visual QA

- Validar em 1920×1080, 1440×900, 1024×768 e 390×844.
- Confirmar ausência de overflow horizontal indevido.
- Confirmar consistência com screenshots de referência.
- Gerar screenshots em `artifacts/visual-qa`.

### Qualidade de código

- ESLint sem erros.
- TypeScript strict.
- Prettier.
- Build de todas as apps.
- Migrations reproduzíveis.
- Seed idempotente.
- Sem `any` desnecessário.
- Sem TODO silencioso; TODO deve estar documentado com issue ou roadmap.

---

## 22. SEED DE DEMONSTRAÇÃO

Crie seed com:

- Tenant: `Layart Agência Digital`.
- Usuário owner de demonstração configurável por env.
- Plano FREE.
- Preferências de onboarding preenchidas parcialmente.
- Cinco leads fictícios, claramente marcados como dados de demonstração.
- Pipeline com colunas iniciais.
- Pesquisa de demonstração concluída.
- Notificações de exemplo.

Não use dados reais das imagens, e-mails reais ou telefones reais.

---

## 23. FASES DE IMPLEMENTAÇÃO

### Fase 0 — Auditoria

- Inspecionar ambiente.
- Registrar portas e containers.
- Confirmar isolamento.
- Criar documentação inicial.

### Fase 1 — Fundação

- Monorepo.
- Docker Compose.
- PostgreSQL.
- Redis.
- Prisma.
- API health/version.
- Design system.
- App Shell.

### Fase 2 — Auth, multi-tenant e planos

- Usuários.
- Tenants.
- Membership.
- TenantGuard.
- RBAC.
- Entitlements.
- Onboarding.

### Fase 3 — Prospecção

- Search.
- Jobs.
- Provider mock.
- Integração com scraper.
- Worker.
- Normalização.
- Deduplicação.
- Score.

### Fase 4 — Operação comercial

- Leads.
- Detalhes.
- Pipeline.
- Histórico.
- Atividades.

### Fase 5 — IA, avisos e configurações

- AIProvider mock.
- IA de abordagem.
- Notificações.
- Assinatura.
- Configurações.
- Ajuda.

### Fase 6 — QA e documentação

- Testes.
- Visual QA.
- Segurança.
- Runbook.
- Changelog.
- Relatório final.

Não avance para integração real com o scraper antes de o provider mock, a persistência e os testes básicos estarem funcionando.

---

## 24. CRITÉRIOS DE ACEITE DA v0.1.1

A versão somente estará concluída quando:

1. O Bellvia não tiver sido alterado.
2. O monorepo iniciar localmente por comando documentado.
3. Web, API, worker, PostgreSQL, Redis e scraper tiverem containers isolados.
4. Login e tenant ativo funcionarem.
5. Onboarding de cinco etapas funcionar.
6. Dashboard usar dados reais do banco ou seed, sem cards estáticos desconectados.
7. Nova Busca funcionar com provider mock e com scraper configurável.
8. Jobs possuírem estados, logs e retry controlado.
9. Leads forem normalizados e deduplicados.
10. Score mostrar motivos.
11. Meus Leads possuir filtros e paginação.
12. Pipeline permitir drag and drop.
13. Histórico refletir pesquisas.
14. IA de abordagem funcionar com MockAIProvider.
15. Planos e feature gates funcionarem.
16. Configurações persistirem preferências.
17. Versão 0.1.1 aparecer no rodapé, Configurações e API.
18. Swagger documentar endpoints.
19. Documentação técnica, estratégica e comercial existir.
20. Testes principais passarem.
21. Screenshots de visual QA estiverem gerados.
22. O módulo Construtor de Sites não existir.

---

## 25. COMANDOS E EXPERIÊNCIA DO DESENVOLVEDOR

Crie scripts raiz:

```json
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "test:e2e": "playwright test",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f",
    "db:migrate": "prisma migrate dev",
    "db:seed": "prisma db seed",
    "db:studio": "prisma studio --port 5556"
  }
}
```

Adapte se necessário, mantendo a finalidade.

O README deve conter um fluxo “Dummies”:

1. Instalar dependências.
2. Copiar `.env.example`.
3. Iniciar Docker.
4. Executar migrations.
5. Executar seed.
6. Iniciar desenvolvimento.
7. Abrir URLs.
8. Executar testes.
9. Parar ambiente.
10. Resolver erros comuns.

---

## 26. FORMATO DA ENTREGA

Ao terminar cada fase, apresente:

1. Resumo do que foi feito.
2. Arquivos principais criados ou alterados.
3. Comandos executados.
4. Evidências de testes.
5. Squads envolvidos.
6. Riscos ou pendências.
7. Próximo passo recomendado.

No relatório final, inclua:

- árvore resumida do projeto;
- portas;
- credenciais de demonstração somente se forem fictícias e configuráveis;
- URLs locais;
- status dos containers;
- status das migrations;
- status dos testes;
- versão;
- limitações conhecidas;
- instruções de rollback;
- confirmação explícita de que `F:\drmind` não foi modificado.

Comece agora pela **Fase 0 — Auditoria do ambiente**, e prossiga sem pedir confirmação para decisões não destrutivas. Não faça alterações no Bellvia.


---

## ADENDO DA VERSÃO v0.1.1

Esta revisão incorpora a referência visual complementar da ficha detalhada do lead. Foram aprofundados o layout `/leads/[id]`, pipeline lateral, acompanhamento, observações, score explicável, ações rápidas, IA de abordagem, histórico de contatos, follow-ups, modelos de dados e endpoints relacionados. A proibição do módulo de criação de sites permanece absoluta, inclusive em botões, planos, textos de upgrade e modais.
