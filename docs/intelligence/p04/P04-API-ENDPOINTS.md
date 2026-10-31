# Intelligence Explorer — referência dos endpoints (módulo 0.1.0)

Prefixo global: `/api/v1`. Ambos os endpoints exigem sessão (`JwtAuthGuard`) e workspace ativo (`TenantGuard`), e leem somente pelo papel de runtime sujeito a RLS (`PrismaService.comTenant`). Nenhum usa o papel de sistema. `F:\drmind` não foi tocado.

## GET `/intelligence/graph`

**Função.** Devolve o lead raiz e suas relações diretas 1:1 (pesquisa, score, presença digital, cartão do pipeline). Relações com muitos itens vêm só como contagem em `expansions`.

**Entrada (query).** `leadId` (obrigatório; `^[A-Za-z0-9_-]{8,64}$`). Qualquer outro parâmetro é recusado (`forbidNonWhitelisted`).

**Saída 200 (`GraphResponse`).** `rootRef`, `nodes[]`, `edges[]`, `omitted`, `limits`, `moduleVersion`, `increment`, `generatedAt`. Cada nó traz `depth` e `depthProof` (ver abaixo). Cada aresta traz `verification` (`VERIFICADA` | `INFERIDA`) e `provenance` (`FOREIGN_KEY` | `SAME_ROW_FIELD` | `INFERENCE_RULE`, coluna de origem, descrição).

**Autorização.** Sessão válida; o lead precisa existir **neste workspace** e não estar excluído.

**Erros.** 400 parâmetro inválido · 401 sem sessão · 404 lead inexistente, excluído ou de outro workspace (corpo idêntico nos três casos, para não confirmar existência).

## GET `/intelligence/expand`

**Função.** Carrega uma página de filhos de um tipo a partir de um nó.

**Entrada (query).**

| Parâmetro | Obrigatório | Regra |
|---|---|---|
| `ref` | sim | `KIND:id` (ou `SIGNAL:presenceId:campo`), máx. 120 caracteres |
| `kind` | sim | um de `GRAPH_NODE_KINDS`; só combinações permitidas por `EXPANDABLE_KINDS` |
| `offset` | não | 0 a 10.000 (padrão 0) |
| `pageSize` | não | 1 a 25 (padrão 8) |
| `parentDepth` | sim | inteiro de 0 a 3: o `depth` do nó pai **exatamente como o servidor o devolveu** |
| `parentDepthProof` | sim | o `depthProof` devolvido junto do nó pai (22 caracteres base64url) |

**Saída 200 (`GraphExpandResponse`).** Nós e arestas novos, `expanded.nextOffset` (ou `null` ao fim), `omitted`.

**Autorização.** Sessão válida; o nó pai precisa existir no workspace ativo. Score, presença, auditoria e cartão **só abrem se o lead associado existir e não estiver excluído** (esses registros não têm exclusão lógica própria).

**Erros.** 400 referência malformada, relação não permitida para o tipo, prova de profundidade inválida (ausente, adulterada, de outro nó ou de outro workspace), profundidade máxima atingida · 401 sem sessão · 404 nó inexistente, de lead excluído, de outro workspace ou inconsistente entre workspaces.

## Profundidade (regra do servidor)

`GRAPH_LIMITS.maxDepth = 3`. A API é sem estado, então o servidor não lembra por onde o usuário passou: ele **assina** `(workspace, ref, depth)` com HMAC-SHA-256 em cada nó devolvido (`depthProof`) e **exige a assinatura de volta** em `expand`. Reduzir `parentDepth` para escapar do teto, reaproveitar a prova de outro nó, ou de outro workspace, resulta em 400 **antes de qualquer consulta ao banco**. A chave é derivada do segredo de acesso com rótulo próprio (nunca se confunde com um JWT). A prova não é autorização: quem pode ler o nó continua sendo decidido por tenant e RLS. Rotacionar o segredo de acesso invalida as provas em circulação; o efeito para o usuário é "recarregue o grafo".

## O que os endpoints não fazem

Não gravam nada. Não chamam provedor de IA. Não devolvem JSON livre (`activity.metadata`, `check.result`) nem URL de prospect. Não mostram texto de nota além de 140 caracteres. Não revelam o telefone completo quando o plano o mascara.
