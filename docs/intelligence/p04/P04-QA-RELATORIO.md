# P04-QA-01 v1.0.0 — Relatório de qualidade e veredito

**Módulo:** Intelligence Explorer 0.1.0 · **Branch:** `feat/prompt-04-intelligence-explorer` · **Commit de referência da ordem:** `1505d25` · **Commit desta rodada:** ver `git log` da branch e a mensagem de entrega.
**`F:\drmind` (Bellvia) não foi modificado.** Nenhuma alteração em produção, nenhum deploy, merge, migration, restart, push.

## Veredito

```
P04_QA_EXECUTION = PARTIAL
P04_QA_RESULT    = INCONCLUSIVE
```

**Por que INCONCLUSIVE e não PASS_WITH_LIMITATIONS.** Os critérios de aprovação exigem compilação real do backend e do frontend, testes relevantes aprovados e integração HTTP real. Nenhum desses portões foi executado: o ambiente da Executora tem o registro npm negado pela política de rede (403 do proxy de saída), o push da branch foi barrado pelo proxy de git (repositório fora do conjunto autorizado da sessão), e o PC do usuário não consegue iniciar o ambiente Linux (pouco espaço em disco). Nada foi contornado. As correções de segurança e de concorrência **foram demonstradas** em bancada com o banco e o serviço reais, mas bancada não é homologação técnica. A decisão cabe ao dono depois que a Rota A ou B (`qa/COMO-RODAR.md`) devolver o resultado real.

## Cobertura por exigência da ordem

| § | Exigência | Estado | Evidência |
|---|---|---|---|
| 2 | Preservação (branch, commit, patch, bundle, árvore limpa) | **Feito** | branch/commit conferidos; `git bundle verify` OK (pré-requisito `2c4b1b2`); árvore sem alterações antes de editar |
| 3 | Ambiente com dependências (A, B, C) | **Bloqueado** | A: PC sem espaço para o ambiente; B: push barrado; C: registro npm 403. Sem contorno |
| 4 | typecheck, prisma generate, lint, builds, jest | **NÃO EXECUTADO** | substituto parcial: `tsc --strict` dos 4 arquivos de `packages/types` (OK) e checagem de tipos dos arquivos da API contra stubs (só artefatos de stub). **Não é typecheck real** |
| 5 | Profundidade (`parentDepth`) | **Corrigido e demonstrado em bancada** | `service-isolation.out` (7 testes) + spec HTTP escrito. Mutação: sem a verificação, 4 testes falham |
| 6 | Soft delete na resolução de pais | **Corrigido e demonstrado em bancada** | 4 entidades de lead excluído **abriam** antes (mutação: 5 falhas ao remover o filtro). Spec HTTP escrito |
| 7 | Isolamento multi-tenant com Prisma real e PG | **Parcial** | PG 16 real + papel `propectai_app` sem BYPASSRLS + serviço real, mas com **Prisma simulado**. O jest HTTP com Prisma real está escrito e **não foi executado** |
| 8 | Concorrência na interface | **Corrigido e demonstrado em bancada** | `ui-concorrencia.out`: 16/16 em Chromium com respostas atrasadas; sem os controles, 7 verificações falham |
| 9 | Limites e desempenho | **Medido em bancada** | `volume.out`, `volume-metricas.tsv`, `volume-explain.txt` |
| 10 | Testes de interface no app completo + captura da ficha do lead | **NÃO EXECUTADO** | exige a stack completa; nenhuma captura artificial foi gerada |
| 11 | Ajustes visuais pontuais | **Feito** | rótulos de aresta condicionais; layout 3 colunas confirmado |
| 12 | Proveniência e comunicação | **Feito** | "Vínculo no cadastro" + explicação; "Inferência (não comprovada)" |
| 13 | Planos, RBAC, dados sensíveis | **Parcial** | mesma cadeia `JwtAuthGuard` + `TenantGuard`; sem RBAC novo; telefone mascarado testado em bancada; **RBAC/planos reais não executados** |
| 14 | Integridade relacional | **Feito (documental)** | `P04-QA-INTEGRIDADE-RELACIONAL.md`; testado no schema real; nenhuma migration |
| 15 | Regressão do produto | **NÃO EXECUTADO** | ver tabela abaixo; nenhum teste foi marcado como PASS sem execução |
| 16 | Documentação | **Feito** | `P04-API-ENDPOINTS.md`, `P04-CHANGELOG.md`, técnico/funcional/comercial atualizados, índice de evidências |

## O que mudou no código (resumo)

- `apps/api/src/intelligence/depth-proof.ts` (novo): HMAC de profundidade. `intelligence.service.ts`: injeta `ConfigService`, assina nós, verifica antes do banco, filtra lead ativo. `intelligence.dto.ts` e `.controller.ts`: `parentDepth` e `parentDepthProof` obrigatórios.
- `packages/types`: `GraphNode.depthProof?`.
- Web: `explorer-workspace.tsx` (geração de requisições, abort, guarda de repetição, merge sobre o grafo mais recente), `intelligence-api.ts`, `node-details-panel.tsx`, `graph-canvas.tsx`.
- Testes: `intelligence-tenant.spec.ts` (+ profundidade e soft delete, HTTP), bancada de serviço (37), concorrência (16), volume (6).

**Mudança de contrato a registrar:** `GET /intelligence/expand` agora exige `parentDepthProof`. Só a UI do Explorer consome o endpoint; nenhum outro módulo foi alterado.

## Regressão do produto (§15)

| Área | Estado | Observação |
|---|---|---|
| Login, workspace, lista de leads, ficha, dashboard, busca, scores, pipeline, planos | **NÃO EXECUTADO** | Os arquivos de outros módulos alterados nesta rodada: **nenhum**. A ficha do lead e o menu foram alterados na entrega anterior (botão e item); nesta rodada, só arquivos do Explorer |
| Suíte completa `pnpm test` | **NÃO EXECUTADO** | Rota A ou B |

Falhas preexistentes versus regressões: **não distinguidas**, pois nenhuma suíte foi executada.

## Limitações da bancada (para não superestimar a evidência)

Prisma simulado sobre `psql` (traduz `where` de igualdade/`in`/`null`/relação `lead`, `select`, `orderBy`, `skip/take`, `groupBy`); serviço real e RLS reais; `ConfigService` e Nest simulados; `ValidationPipe` não roda (DTOs não exercitados); tempos incluem um processo `psql` por consulta (teto pessimista). Os tipos do Prisma gerado e do Next/React reais nunca foram usados.

## Riscos residuais

1. Erro de tipo ou de lint nos arquivos da API/web que só o compilador real acusaria. Probabilidade moderada (mais de 3.000 linhas de TS novas, nunca compiladas contra tipos reais).
2. Diferença entre o Prisma simulado e o real (por exemplo, filtro de relação `lead: {…}` em `findFirst`): sintaxe padrão do Prisma, mas não executada.
3. `@Type(() => Number)` e `ValidationPipe` com `forbidNonWhitelisted` nos DTOs novos: cobertos só no spec HTTP, não executado.
4. FKs simples (documento de integridade): decisão do dono.

## Recomendações

1. Rodar a Rota A (PR rascunho, sem merge) ou B e devolver os logs; corrigir na branch o que o compilador/lint/jest apontarem.
2. Só então reavaliar este veredito (`PASS_WITH_LIMITATIONS` é o teto razoável enquanto a captura da ficha e a regressão manual não existirem).
3. Decidir sobre a migration de integridade em ordem separada.
4. Não promover para `main` nem para produção antes disso.
