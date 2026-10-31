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

