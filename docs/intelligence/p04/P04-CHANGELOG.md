# Intelligence Explorer — histórico de versão

## 0.1.0 (P04-I1) — primeira entrega, 31/10/2026
Rota `/intelligence`, 2 endpoints, grafo de relações verificáveis do próprio workspace, entrada pela ficha do lead, contrato tipado de IA (sem provedor), gancho de entitlements.

## 0.1.0 + QA-01 (P04-QA-01) — correções de homologação, 31/10/2026 (sem mudança de número de versão do módulo)

**Segurança**
- `GET /intelligence/expand` exige `parentDepthProof`: a profundidade deixou de ser declarada pelo navegador e passou a ser imposta pelo servidor (HMAC por nó e workspace). **Mudança de contrato:** `parentDepth` agora é obrigatório e só vale com a prova.
- Score, presença digital, auditoria e cartão de lead **excluído logicamente** deixam de abrir por referência conhecida (antes abriam, demonstrado em teste com a correção removida).
- Cartão cujo `tenantId` difere do tenant do lead (possível porque a FK é simples) não abre para nenhum dos dois workspaces.

**Interface**
- Controle de concorrência: respostas atrasadas de outro lead, de outra expansão, de filtro anterior ou de operação reiniciada são descartadas; requisições são abortadas; clique repetido na mesma expansão gera uma só requisição; duas expansões sobrepostas não se apagam.
- Rótulo "Verificada" substituído por "Vínculo no cadastro", com explicação de que isso não significa conferência externa. "Inferida" passou a "Inferência (não comprovada)".
- Rótulos de aresta só aparecem em grafos pequenos ou nas arestas do nó selecionado (até 8), para reduzir sobreposição.

**Fora do escopo desta rodada (não feitos):** IA, Flowsint, enriquecimento, regras comerciais, migration.

## 0.1.0 + QA-02 (P04-QA-02) — desbloqueio de CI e troca de workspace, 31/10/2026 (versão do módulo inalterada: 0.1.0)

**Interface**
- **Troca de sessão/workspace com o Explorer aberto.** A página lê a identidade (usuário + workspace) no servidor e a usa como `key` do workspace. Um vigia de sessão compara essa identidade com `GET /auth/me` ao focar a aba, ao voltar a ficar visível, ao restaurar da cache de navegação, ao voltar a rede, a cada 20 s e depois de um 401/403 do próprio Explorer. Mudou → grafo, seleção/detalhes, cursores, filtros de tipo, buscas e requisições pendentes são **descartados** (nada é reaproveitado), o `lead` da URL é removido e `router.refresh()` entrega a identidade nova. Sessão encerrada → o layout manda para o login. Falha de rede ou 5xx **não** descarta nada.
- Novo: `use-vigia-de-sessao.ts`; `packages/types/src/session-identity.ts` (função pura `chaveDeIdentidade`/`compararIdentidade`, com teste). `getSession` passou a ser deduplicado por requisição (`React.cache`), sem cache entre requisições.

**Integração contínua**
- `.github/workflows/ci.yml`: `lint`, `nest build`, `next build` (job `builds`), teste HTTP do Explorer como passo próprio e job final `Resultado do CI`; `permissions: contents: read`. Nada de deploy, SSH ou segredo de produção.

**Qualidade/documentação**
- `qa/validar-p04-qa.ps1` v1.1.0 endurecido (ver `qa/COMO-RODAR.md`).
- `P04-QA-INTEGRIDADE-RELACIONAL.md` corrigido para `pipeline_cards` (unicidade ≠ FK composta); novo `P04-SEC-DATA-01-HANDOFF.md`.

**Sem mudança** de contrato de API, de schema, de migration ou de produção.

## 0.1.0 + QA-03 (P04-QA-03) — homologação funcional, 01/11/2026 (versão do módulo inalterada: 0.1.0)

**Interface / segurança**
- **Mudança de sessão conhecida pela aplicação descarta o Explorer na hora**, sem depender da checagem de 20 s: login, logout, cadastro e aceite de convite anunciam a mudança às demais abas do navegador (`lib/session-events.ts`, `BroadcastChannel` com `storage` de reserva), **só depois de a API confirmar**. O vigia do Explorer reage: `logout` descarta sem esperar rede; `login`/`troca` consultam `/auth/me` na hora. O aviso é só um gatilho (sem identidade nem dado) e mensagens inválidas são ignoradas. A checagem periódica permanece como rede de segurança.
- Arquivos de outros módulos tocados (uma chamada cada, após a confirmação da API): `login-form.tsx`, `register-form.tsx`, `accept-invite-form.tsx`, `logout-button.tsx`.

**Sem mudança** de contrato de API, schema, migration, CI ou produção.

## 0.1.0 + QA-04 (P04-QA-04) — portão E2E real no GitHub Actions, 02/11/2026 (versão do módulo inalterada: 0.1.0)

**Integração contínua**
- Novo job `e2e` em `.github/workflows/ci.yml`: PostgreSQL 16 efêmero + Redis, migrations em dois estágios, seed, fixtures sintéticas Alfa/Beta, `nest build` + `next build`, API e Next reais em produção atrás de um gateway same-origin mínimo, Chromium/Playwright. `Resultado do CI` passou a exigir `tipos`, `builds`, `testes` **e** `e2e`.
- Specs `explorer-01…04` (E2E-01…08) e regressão `fluxo-0…4` (E2E-09, sem alteração). `playwright.ci.config.ts` (sem trace/vídeo/retry). Varredura de sanitização antes de publicar as evidências.
- `global-setup.ts`: o diagnóstico de falha do login deixou de imprimir o corpo da requisição (continha a senha).

**Dados de teste**
- `prisma/e2e-explorer-fixtures.ts` (`pnpm db:e2e-fixtures`): só banco local/efêmero; Alfa enriquecido e tenant Beta.

**Sem mudança** de código do produto, contrato de API, schema, migration ou produção. Nenhuma dependência nova.

**Estado:** autoria concluída; **execução pendente do primeiro run no Actions** (ver `P04-QA-04-RELATORIO.md`).

## 0.1.0 + QA-04R (P04-QA-04R) — correção direcionada após o run #76, 02/11/2026 (versão do módulo inalterada: 0.1.0)

**Testes (sem mudança no código do produto)**
- `explorer-support.ts`: `carregarRelacao` espera cada nó devolvido pela API aparecer no SVG (sem pausa fixa) e devolve as referências. E2E-05a passa a conferir contagem exata de `SCORE_REASON` no DOM.
- `fluxo-1`: o teste do rodapé verifica o `/api/v1/health` real (banco e Redis `ok`; status coerente com o scraper) em vez de exigir `API ok` com o scraper ausente.

**Integração contínua**
- Relatório bruto do Playwright fora do workspace (`$RUNNER_TEMP`); novo `apps/web/e2e/ci/sanitizar-resultados.mjs` gera a saída publicável por lista permitida e diagnostica marcadores por categoria de campo (sem valores). Varredura e upload cobrem só `e2e-publicavel/` e os logs de processo. HTML, JSON bruto e anexos de falha não são mais publicados.
- Novo passo que imprime banco/Redis/scraper separados e reprova se banco ou Redis não estiverem `ok`.

**Sem mudança** de produto, contrato de API, schema, migration ou produção. **Estado:** aguarda o run #77.

