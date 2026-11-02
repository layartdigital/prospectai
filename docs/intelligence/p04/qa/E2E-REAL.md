# E2E real do Intelligence Explorer — como funciona, como roda, como ler (P04-QA-04)

**`F:\drmind` (Bellvia) não é tocado por nada aqui.** O E2E roda **só no GitHub Actions** (job `e2e`), com infraestrutura efêmera. Não usa o computador do proprietário, não usa a bancada e não usa produção.

## O que o job `e2e` faz, em ordem

1. Instala dependências e compila `@propectai/types`; gera o cliente Prisma.
2. Banco efêmero (serviço PostgreSQL 16 + Redis do job), com **as mesmas etapas do job `testes`**: migrations até o DB-REM-06 como superusuário, senhas dos quatro papéis, migrations seguintes como `propectai_dono`.
3. `pnpm db:seed` (tenant de demonstração = **Alfa**) e `pnpm db:e2e-fixtures` (Alfa enriquecido + tenant **Beta**; escreve `apps/web/e2e/.generated/e2e-manifest.json` com ids e nomes, nunca senhas).
4. `nest build` e `next build`; instala o Chromium do Playwright.
5. Sobe a **API** (`node apps/api/dist/main.js`, `NODE_ENV=production`, sem `DATABASE_URL`/`DATABASE_URL_MIGRATOR`), o **Next** (`next start --port 3200`) e o **gateway** (`apps/web/e2e/ci/gateway.mjs`, porta 3100) e espera cada um responder (API direta, Next direto, `/api` e `/login` pelo gateway).
6. Playwright, com `playwright.ci.config.ts`:
   - `explorer-` → E2E-01…08 (**antes**, porque os fluxos antigos escrevem no lead de maior score do Alfa);
   - `fluxo-` → E2E-09, a regressão existente, sem alteração.
7. Sempre: encerra a pilha, mostra o fim dos logs `api/web/gateway`, imprime a contagem por estado, **varre as evidências em busca de senha/cookie** e, se limpas, publica o artefato `e2e-evidencias`.

O job falha se qualquer passo falhar; `Resultado do CI` exige `tipos`, `builds`, `testes` **e** `e2e`.

## Por que existe um gateway

Em produção o nginx dá ao navegador uma origem só: `/api/*` vai para a API, o resto para o Next. Em `next dev` o `rewrites()` faz isso; em `next start` ele **não** faz (de propósito, ver `next.config.mjs`). Sem algo no lugar do nginx, o login do navegador não alcança a API. O gateway é esse algo, com `node:http` e nenhuma dependência: repassa a requisição inteira (cabeçalhos, cookies, corpo) e devolve a resposta inteira. Não inventa resposta.

## Regras do portão

- Sem `continue-on-error`, `|| true`, `test.skip`/`fixme`, `retries` ou `waitForTimeout`. `forbidOnly` ativo.
- Sem `trace` e sem `video` (gravariam cookies e o POST do login). As evidências são capturas explícitas de telas autenticadas com dados sintéticos e os logs de processo.
- `APP_VERSION` **não** é definida neste job (o rodapé mostra `0.1.1`, como no servidor).
- Credenciais do job (`SEED_OWNER_PASSWORD`, `SEED_SDR_PASSWORD`, `E2E_BETA_PASSWORD`, URLs de banco) são **descartáveis**, vivem só no `env` do job e nunca saem dele; não são secrets do repositório.
- As fixtures recusam rodar se o host do banco não for local.

## Fixtures (resumo)

| Workspace | Registros | Para quê |
|---|---|---|
| Alfa (`layart-demo`) | `Alfa Hub Relacional E2E` (pesquisa, score+motivos, presença, cartão “Respondeu”, 11 notas, 4 atividades, 2 contatos, 1 follow-up, sem auditoria); 11 satélites na mesma pesquisa (o 01 com presença); `Alfa Removido E2E` (excluído logicamente, na mesma pesquisa) | paginação 8+3, contagem da pesquisa = 12, teto de profundidade, soft delete |
| Beta (`e2e-beta`) | `Beta Exclusiva Cardio E2E` (3 notas), `Beta Exclusiva Podologia E2E`, 1 usuário OWNER | isolamento e troca de sessão |

## Como ler o resultado

No artefato `e2e-evidencias`: `test-results-ci-explorer/` e `test-results-ci-regressao/` com `resultado.json` (estado de cada teste), `relatorio-html/index.html`, `evidencias/*.png` (capturas) e `artefatos/` (capturas de falha); `e2e-logs/*.log` (inicialização, requisições e desligamento de API, Next e gateway). O título de cada teste começa pelo ID da matriz (`E2E-0x`).

## Rodar fora do CI (opcional, não exigido)

Precisa de PostgreSQL 16 com as migrations e os papéis (como o job), Redis, `pnpm db:seed`, `pnpm db:e2e-fixtures`, os dois builds, e as três pontas no ar. O caminho de verdade é o CI; esta seção existe só para quem quiser depurar um teste isolado:

```
pnpm --filter @propectai/web exec playwright test -c playwright.ci.config.ts explorer-03
```

(com `E2E_BASE_URL`, `E2E_BETA_PASSWORD`, `SEED_OWNER_PASSWORD`, `SEED_SDR_PASSWORD` no ambiente).
