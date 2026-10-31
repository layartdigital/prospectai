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
