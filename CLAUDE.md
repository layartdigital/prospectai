# PropectAI — Regras permanentes do projeto

Este arquivo vale para **todas** as sessões de trabalho neste projeto. Ler antes de qualquer alteração.

---

## Contexto

**PropectAI** — plataforma SaaS multi-tenant de prospecção de clientes locais. Conceito de marca: Prospect + AI.
**Versão atual:** 0.1.1 (em construção)
**Raiz:** `C:\ResgateProjetos\prospectai` — todo o trabalho acontece aqui, sem exceção.

> **Migrado de `F:\prospectai` em 06/08/2026.** O volume F: é um HD externo USB que
> apresentou erro de hardware durante o desenvolvimento: falha de I/O em blocos
> lógicos, perda de dados em escrita atrasada e corrupção de índice NTFS, todos
> registrados no Visualizador de Eventos. O projeto foi copiado para o SSD interno.
> Referências a `F:\prospectai` em documentos anteriores a esta data são registro
> histórico e ficam como estão — reescrevê-las falsificaria o que se sabia à época.

---

## Regras invioláveis

### 1. Não tocar no Bellvia
O Bellvia vive em `F:\drmind` e usa a mesma stack (Node, TypeScript, PostgreSQL, Docker). Nenhum arquivo, pasta, container, rede, volume ou porta dele pode ser modificado, movido, parado ou reutilizado.

A regra não mudou com a migração do PropectAI para o C:. Os dois projetos deixaram de dividir o disco, mas continuam dividindo a **mesma instância do Docker** — que é onde o risco real sempre esteve. Backup do Bellvia feito em `C:\backup-drmind` em 06/08/2026: 5.146 arquivos, zero falhas.

**Nunca executar** `docker system prune`, `docker volume prune`, `docker network prune` ou qualquer remoção global.

Todo recurso Docker do PropectAI usa o prefixo `propectai-`.

### 2. O módulo "Construtor de Sites" não existe
Sem rota, sem item de menu, sem tabela, sem feature flag, sem placeholder, sem menção em onboarding, planos, textos de upgrade ou modais.

Nenhum botão `Criar Site`, `Gerar Site` ou equivalente em lugar algum — em especial na ficha do lead, onde a referência visual original tinha um.

### 3. Motor de coleta é o `gosom/google-maps-scraper`
Clonado em `services/google-maps-scraper/`, consumido como container via API REST. Não modificar o código do clone. Toda interação passa pela abstração `LeadSourceProvider`.

Em produção a porta do scraper não é publicada — só API e worker o acessam pela rede Docker.

### 4. Ausência de sinal é `DESCONHECIDO`, nunca `AUSENTE`
Instagram, Facebook e WhatsApp não vêm do scraper. Marcar um lead como "Sem Instagram" sem nunca ter verificado é falso negativo e destrói a confiança no score.

Todo sinal usa três estados: `PRESENTE`, `AUSENTE`, `DESCONHECIDO`. Só vira `AUSENTE` após verificação real. `DESCONHECIDO` não pontua no score e aparece em cinza neutro na interface.

### 5. Nenhum modal de bloqueio abre sozinho
Feature gate só abre modal **depois** de uma tentativa explícita do usuário. Carregar uma página nunca dispara paywall.

### 6. Dados pessoais de terceiros não são persistidos
O CSV do scraper traz `user_reviews`, `user_reviews_extended` e link de perfil em `owner` — nome, foto e URL de pessoas físicas. Descartados na normalização, antes de gravar `LeadSourceRecord`. `extra_reviews` fica permanentemente em `false`.

### 7. Zero mock no front-end
Se a tela mostra um número, ele veio de query. Dados de demonstração vivem no PostgreSQL via seed, marcados com `isDemo: true`.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| `apps/web` | Next.js App Router, TypeScript, Tailwind, shadcn/ui |
| `apps/api` | NestJS, TypeScript, Swagger, Prisma |
| `apps/worker` | Node TypeScript + BullMQ |
| `packages/` | `ui`, `config`, `types`, `sdk` |
| Banco | PostgreSQL 16 |
| Fila | Redis 7 + BullMQ |

**Bibliotecas:** React Hook Form + Zod, TanStack Table, TanStack Query, dnd-kit, Recharts, Lucide React, Argon2, Pino.

Não adicionar biblioteca duplicada para a mesma finalidade.

---

## Ambiente de desenvolvimento

**Modo híbrido:** Postgres, Redis e scraper em Docker; web, API e worker rodando local com `pnpm dev`. O compose completo existe e funciona para produção, mas o ciclo diário não passa por rebuild de imagem.

| Serviço | Porta |
|---|---:|
| Web | 3100 |
| API | 3101 |
| PostgreSQL | 5434 |
| Redis | 6381 |
| Scraper | 8081 (só em dev) |
| Prisma Studio | 5556 |

Portas de banco e fila são deslocadas de propósito, para tornar impossível conectar no Bellvia por engano.

**Volume do scraper:** `./data/gmapsdata` (não `./data/gmaps` — já está populado com histórico real).

---

## Design system

```css
--color-navy-900: #14213D;   /* texto e "PROPECT" no logo */
--color-blue-600: #2F6BFF;   /* ação primária e "AI" no logo */
--color-app-bg:   #EAF2FC;   /* fundo da aplicação */
--color-surface:  #FFFFFF;   /* cards, sidebar, topbar */
--color-border:   #D8E3F1;
--color-text-muted: #6B7A99;
```

Fonte Inter. Sidebar 160–184px. Topbar 56–64px. Cards raio 12–16px. Inputs e botões raio 8–10px. Sombra `0 8px 24px rgba(15, 27, 51, 0.06)`.

Desktop first (1440–1920), mas nenhuma tela pode depender de largura fixa. Acessibilidade WCAG 2.1 AA.

---

## Sidebar da v0.1.1

Só entra no menu o que funciona:

1. Dashboard
2. Nova Busca
3. Meus Leads
4. Pipeline
5. Histórico

Separador inferior: Fazer Upgrade · Assinatura · Configurações · Ajuda · Sair

Propostas, Contratos, Precificador e Avisos ficam para a v0.2 — as tabelas existem no schema, a interface não. Menu com item que só abre paywall é o defeito que este produto existe para evitar.

---

## Documentação de referência

| Arquivo | Conteúdo |
|---|---|
| `docs/technical/environment-audit.md` | Estado do ambiente, inventário do scraper, portas, pendências |
| `docs/strategic/scope-v0.1.1.md` | Escopo aprovado, regras de negócio, fases, critérios de aceite |
| `docs/technical/data-model.md` | Entidades, deduplicação, isolamento entre tenants, migrations |
| `docs/technical/scoring.md` | Motor de score, pesos, explicabilidade |
| `PropectAI_Prompt_Ultra_Detalhado_Claude_v0.1.1.md` | Documento mestre original |

Onde o documento mestre e o escopo aprovado divergirem, **vale o escopo aprovado** — as divergências estão justificadas lá.

---

## Comandos

```bash
pnpm dev              # turbo run dev --parallel
pnpm build
pnpm lint
pnpm test
pnpm docker:up        # docker compose up -d
pnpm docker:down
pnpm db:migrate       # prisma migrate dev
pnpm db:seed          # idempotente
pnpm db:studio        # porta 5556
```

---

## Qualidade

TypeScript strict, sem `any` desnecessário. ESLint sem erros. Migrations reproduzíveis a partir de banco vazio. Seed idempotente. Nenhum `TODO` sem issue ou linha de roadmap associada.

Todo relatório de fase declara explicitamente que `F:\drmind` não foi modificado.
