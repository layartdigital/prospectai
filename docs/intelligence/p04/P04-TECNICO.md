# P04 — Intelligence Explorer · Documentação técnica

**Módulo:** Intelligence Explorer · **Versão do módulo:** 0.1.0 · **Incremento:** P04-I1
**Branch:** `feat/prompt-04-intelligence-explorer` · **Versão global do ProspectAI:** inalterada
**`F:\drmind` (Bellvia) não foi modificado.**

---

## 1. O que existe

Uma rota `/intelligence` que mostra, como grafo, como um lead se liga ao restante do cadastro do próprio tenant: a pesquisa que o encontrou, o score e seus motivos, a presença digital e seus sinais, a auditoria e suas checagens, o cartão e a etapa do pipeline, atividades, notas, contatos registrados e follow-ups.

**Só entram relações comprovadas no banco.** Cada aresta carrega `verification` e `provenance` (tipo, coluna de origem, descrição). Hoje todas as 13 relações são `VERIFICADA` e vêm de chave estrangeira ou de coluna da mesma linha. O valor `INFERIDA` existe no tipo, está reservado e **nenhuma regra de inferência foi escrita na 0.1.0**.

## 2. Mapa de arquivos

| Camada | Arquivo | Papel |
|---|---|---|
| Tipos | `packages/types/src/intelligence-graph.ts` | DTOs do grafo, limites técnicos, construtores de nó/aresta, fusão idempotente, `parseNodeRef`, `podeExpandir` |
| Tipos | `packages/types/src/intelligence-layout.ts` | Layout de forças determinístico e enquadramento/zoom (puro, sem DOM) |
| Tipos | `packages/types/src/intelligence-ai-contract.ts` | Contrato tipado da IA. **Sem provedor, sem endpoint, sem botão** |
| API | `apps/api/src/intelligence/*` | Controller, DTOs, módulo e serviço (2 endpoints) |
| API | `apps/api/test/intelligence-tenant.spec.ts` | Teste HTTP de isolamento (escrito; **não executado aqui**, ver §8) |
| Web | `apps/web/src/app/(app)/intelligence/page.tsx` | Rota |
| Web | `apps/web/src/components/intelligence/*` | Workspace, canvas SVG, painel de detalhes, busca de entidade, estilos |
| Web | `apps/web/src/lib/intelligence-api.ts` | Cliente tipado |
| Alterados | `app.module.ts`, `lib/nav.ts`, `leads/[id]/page.tsx`, `packages/types/src/index.ts` | Registro do módulo, item de menu, botão "Explorar relações", exports |

Nenhuma dependência nova. Nenhuma migration. Nenhuma alteração de RLS.

## 3. API

Ambos os endpoints usam `JwtAuthGuard` + `TenantGuard` (mesma cadeia dos demais módulos).

`GET /intelligence/graph?leadId=` devolve o lead e as relações 1:1 (pesquisa, score, presença, cartão). Relações de muitos itens (notas, atividades, auditorias, contatos, follow-ups, motivos, sinais) vêm só como contagem em `expansions`. 404 se o lead não existe **neste tenant**.

`GET /intelligence/expand?ref=&kind=&offset=&pageSize=&parentDepth=&parentDepthProof=` carrega uma relação de um nó, paginada. 400 se o par `(tipo do pai → kind)` não é expansível (`podeExpandir`, mesma função usada pela UI), se a prova de profundidade é inválida, se a profundidade máxima foi atingida ou se o `ref` é malformado. 404 se o pai não pertence ao tenant ou pertence a lead excluído. **Referência completa em `P04-API-ENDPOINTS.md`.**

A busca de leads de partida **reutiliza `GET /leads`** e as facetas existentes; não há endpoint de busca novo.

### Limites (técnicos, não comerciais)

`GRAPH_LIMITS`: 60 nós por resposta, página padrão 8, máxima 25, profundidade máxima 3, 150 nós no canvas. São proteção de payload e de tela. O método `limitesDoPlano(planCode)` do serviço é o **gancho de entitlements**: hoje devolve os limites técnicos sem distinguir plano. Nenhum valor comercial foi inventado.

## 4. Isolamento entre tenants (defesa em profundidade)

1. Toda leitura roda dentro de `PrismaService.comTenant(tenantId, fn)`: transação com `set_config('app.tenant_id', id, true)`, sob o papel `propectai_app`, que é submetido a RLS forçada. Nenhum atalho com `propectai_sistema`.
2. Além do RLS, **todo `where` leva `tenantId` explícito** e filtros de soft-delete.
3. `resolverPai` reconfirma que o nó pai pertence ao tenant antes de qualquer expansão.
4. Colunas de JSON livre ou URL (`activity.metadata`, `check.result`, `observedUrl`) **ficam fora dos `select`**; texto de nota é truncado em 140 caracteres; telefone é mascarado no servidor conforme o plano (`EntitlementsService.maskPhone`).
5. **Profundidade imposta pelo servidor (QA-01).** Cada nó sai com `depthProof` (HMAC-SHA-256 de `tenant|ref|depth`, chave derivada de `JWT_ACCESS_SECRET` com rótulo próprio); `expand` recusa com 400, antes de consultar o banco, `parentDepth` sem prova válida.
6. **Soft delete (QA-01).** Score, presença, auditoria e cartão não têm `deletedAt`; `resolverPai` exige `lead: { tenantId, deletedAt: null }`. Isso também esconde cartão cujo lead é de outro tenant.
7. `ref` é validado por regex (`^[A-Za-z0-9_-]{8,64}$` por segmento) antes de chegar ao Prisma.

**Achado registrado (decisão do dono, não executado; detalhes em `P04-QA-INTEGRIDADE-RELACIONAL.md`):** `leads.searchId` (e as FKs `leadId` de notas, atividades, contatos, follow-ups e cartões) são FKs simples, não composta com `tenantId`. Em tese permite um ponteiro para pesquisa de outro tenant. O serviço não é afetado (RLS + `tenantId` no where), mas a correção estrutural é uma migration de integridade que **não foi feita** por estar fora da autorização.

## 5. Front-end

Renderizador SVG próprio, sem biblioteca de grafos (decisão: nenhuma nova dependência; o conjunto de requisitos cabe em ~350 linhas). Layout de forças determinístico (semente derivada do `ref`): o mesmo grafo produz o mesmo desenho. Posições já mostradas ficam fixas ao expandir.

Acessibilidade: cada nó é `role="button"` com `aria-label`, navegação por Tab, setas movem a vista, `+`/`-`/`0` controlam zoom, Esc limpa a seleção, botões visíveis para aproximar/afastar/enquadrar, e uma lista alternativa só para leitor de tela. Sinal `DESCONHECIDO` aparece em cinza neutro com a explicação "Não verificado. Isso não significa que o sinal não exista."

Rótulos de aresta aparecem só em grafos pequenos ou nas arestas do nó selecionado (até 8), para não gerar ruído com dezenas de notas.

Âncoras para um futuro tour: `data-tour="explorer-header|search|canvas|details|filters"`. Nenhuma biblioteca de tour foi adicionada.

## 6. Camada de IA

Só o contrato (`intelligence-ai-contract.ts`): estado `INDISPONIVEL`, requisição sobre subgrafo já filtrado por tenant, resposta com afirmações que **exigem evidências** (refs presentes no contexto), relações sugeridas sempre `INFERIDA`, e `validarRespostaIa` que rejeita o que viole isso. A tela diz explicitamente que a IA ainda não está disponível. **Nenhuma resposta de IA é simulada.**

## 7. Flowsint

ADR-002 (aceito) mantém "não adotar agora". O Explorer é implementação própria; **nenhum código do Flowsint foi copiado**. Referência de licença e releases em `THIRD_PARTY_FLOWSINT.md`.

## 8. Verificação — estado após P04-QA-01

Nenhum gate do monorepo (typecheck, lint, build, jest) pôde ser executado no ambiente desta sessão (registro npm negado pela política de rede; push para o GitHub barrado pelo proxy de git). **Nenhuma dessas etapas é declarada aprovada.** O que existe é evidência de bancada, rotulada como tal, em `P04-INDICE-DE-EVIDENCIAS.md` e `P04-QA-RELATORIO.md`.
