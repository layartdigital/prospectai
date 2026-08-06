# Relatório final — v0.1.1

**Data:** 28 de julho de 2026
**Raiz:** `F:\prospectai`
**Motor de coleta:** `gosom/google-maps-scraper`

---

## 1. Declaração de isolamento

**`F:\drmind` não foi modificado.** Nenhum arquivo, container, rede, volume ou
porta do Bellvia foi alterado, movido, parado ou reutilizado em nenhuma fase.
Nenhum comando de remoção global (`docker system prune`, `volume prune`,
`network prune`) foi executado.

Os quatro containers `drm-*`, as três redes `drmind_*`, os seis volumes
`drmind_*` e os dois volumes anônimos de origem desconhecida permanecem
exatamente como estavam na auditoria da Fase 0.

---

## 2. Árvore do projeto

```text
F:\prospectai
├── apps
│   ├── api        NestJS · Prisma · Swagger · porta 3101
│   ├── web        Next.js App Router · Tailwind · porta 3100
│   └── worker     BullMQ · providers de coleta
├── packages
│   ├── config     tsconfig compartilhado
│   └── types      contratos, motor de score, normalização
├── prisma         schema, seed e scripts operacionais
├── services
│   └── google-maps-scraper   clone de terceiros, não versionado
├── data
│   └── gmapsdata  estado de runtime do scraper, não versionado
├── infra          docker e scripts
└── docs           técnica e estratégica
```

## 3. Portas e URLs

| Serviço | Porta | URL |
|---|---:|---|
| Web | 3100 | http://localhost:3100 |
| API | 3101 | http://localhost:3101/api/v1 |
| Swagger | 3101 | http://localhost:3101/api/docs |
| PostgreSQL | 5434 | — |
| Redis | 6381 | — |
| Scraper | 8081 | 127.0.0.1 apenas, só em dev |
| Prisma Studio | 5556 | http://localhost:5556 |

## 4. Credenciais de demonstração

Fictícias e configuráveis por `.env`.

```
owner@demo.propectai.local   Demo@123456   OWNER
sdr@demo.propectai.local     Demo@123456   SDR
```

---

## 5. Critérios de aceite

### Cumpridos

| # | Critério |
|---|---|
| 1 | Bellvia intocado |
| 2 | Ambiente sobe do zero por comando documentado |
| 3 | Postgres, Redis e scraper isolados com prefixo `propectai-` |
| 4 | Login, refresh e logout funcionam; sessão resolve o tenant |
| 5 | Teste automatizado prova o isolamento entre tenants |
| 7 | Dashboard calcula todos os KPIs por query |
| 8 | Nova Busca completa o ciclo com provider mock |
| 9 | `GoogleMapsScraperProvider` traz leads reais do container |
| 10 | Busca repetida não duplica leads nem consome cota |
| 11 | Nenhum lead concluído fica sem `LeadScoreReason` |
| 12 | Ficha mostra pontos positivos e de atenção com evidência |
| 13 | Copiar telefone, abrir mapa e WhatsApp geram `LeadActivity` |
| 14 | Registrar contato atualiza timeline; follow-up atualiza a lista |
| 15 | Pipeline move card por drag and drop com rollback |
| 16 | Meus Leads pagina no servidor e combina filtros |
| 17 | Histórico reflete buscas com duração e duplicados |
| 18 | IA de abordagem gera com `MockAIProvider` e salva histórico |
| 19 | Feature gates funcionam nos 4 planos, sem modal automático |
| 20 | Versão 0.1.1 no rodapé, em Configurações e na API |
| 21 | Swagger documenta todos os endpoints implementados |
| 22 | Nenhum dado pessoal de avaliador é persistido |
| 24 | Módulo Construtor de Sites não existe |

### Pendentes

| # | Critério | Situação |
|---|---|---|
| 6 | Onboarding de 5 etapas | As preferências existem e são editáveis em Configurações, mas o fluxo guiado de primeira entrada não foi construído. Quem se cadastra hoje começa com as listas vazias |
| 23 | Layout verificado em 1920, 1440, 1366 e 390 px | Validado visualmente em desktop durante o desenvolvimento; sem captura sistemática nas quatro resoluções |

### Fora do escopo aprovado

Exportação CSV, centro de Avisos como tela, Precificador, Propostas e
Contratos com interface, e o Product Tour. Todos com tabela no schema quando
aplicável, nenhum com rota ou item de menu.

---

## 6. Testes

```
packages/types   35 asserções   vitest
apps/api         14 asserções   jest
```

| Suíte | Cobre |
|---|---|
| `scoring-engine.test.ts` | Reproduz o caso documentado (65 pontos), faixas, desqualificação, teto de 100, inversão da faixa de avaliações |
| `normalize.test.ts` | UF por extenso e com prefixo em inglês, E.164, celular como `LIKELY`, classificação de site precário, convergência do fingerprint |
| `mock-ai.provider.spec.ts` | Vazamento de rótulos do prompt, determinismo, ausência de dado inventado |
| `tenant-isolation.spec.ts` | Busca por id sem tenant, mesmo negócio em dois tenants, duplicata recusada pelo banco, idempotência por tenant |

O teste de isolamento roda contra o PostgreSQL real: metade das garantias é
do índice único, não do código da aplicação.

---

## 7. Regras que este produto implementa e o concorrente não

1. **Site precário vale +22.** Domínio de construtor gratuito é oportunidade
   comercial, não "já tem site". O lead com página em `base44.app` que o
   concorrente pontuava como 0 vale 73 aqui.
2. **Ausência de sinal é `DESCONHECIDO`.** Instagram, Facebook e WhatsApp não
   vêm da fonte. Marcá-los como ausentes é falso negativo em massa.
3. **Lead duplicado não consome cota.** Reserva no início do job, liquidação
   com o número real de leads novos, devolução integral em caso de falha.
4. **Nenhum modal de bloqueio abre sozinho.** Todo gate age depois de uma
   tentativa explícita do usuário.
5. **Dados pessoais de terceiros não são persistidos.** Nome, foto e link de
   perfil de avaliadores são descartados antes de gravar.

---

## 8. Limitações conhecidas

- **Enriquecimento de redes sociais não existe.** Instagram e Facebook ficam
  `DESCONHECIDO` para todo lead. Quatro pesos do score aguardam isso.
- **Coleta sujeita a bloqueio pela fonte.** Sem rotação de proxy configurada.
  Job que falha devolve a cota, mas não contorna o bloqueio.
- **Contratação de plano não é automática.** O provedor de pagamento é uma
  abstração; nenhuma integração financeira foi ativada.
- **Sem Playwright.** Os fluxos são cobertos por unitários e integração, não
  ponta a ponta pelo navegador.
- **CSRF depende de SameSite=Lax.** Suficiente para front e API no mesmo host.
  Domínios distintos em produção vão exigir token CSRF.

---

## 9. Rollback

O projeto é autocontido em `F:\prospectai`. Para desfazer por completo:

```powershell
cd F:\prospectai
pnpm docker:down
docker volume rm propectai-postgres-data propectai-redis-data
docker network rm propectai-network
```

Nenhum desses comandos toca recurso do Bellvia — todos são nominais.
Os dados do scraper em `data/gmapsdata` sobrevivem, por serem bind mount.

---

## 10. Próximo passo recomendado

A questão comercial aberta desde a Fase 0 continua aberta e agora é a decisão
mais relevante: **removido o Construtor de Sites, os planos se diferenciam
apenas por volume de lead** — que é commodity.

A auditoria de presença digital resolve dois problemas de uma vez: preenche os
quatro pesos do score que hoje ficam `DESCONHECIDO` e cria o segundo eixo de
valor que a tabela de preços não tem. É trabalho que o produto vai precisar
fazer de qualquer forma; transformá-lo em item vendável é a diferença entre
custo e receita.
