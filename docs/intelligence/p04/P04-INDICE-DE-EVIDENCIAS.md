# P04 — Índice de evidências (atualizado em P04-CLOSE-01)

> **Estado atual:** o Explorer foi homologado pelo CI real do GitHub — Actions **#77** (commit `78e9fe2`): **Explorer E2E 27/27, regressão 29/29, 0 falhas/instáveis/pulados, sanitização PASS, upload verificado**. As evidências de **bancada** abaixo são históricas (QA-01…03) e **não** foram substituídas por estas; as de CI estão na seção “P04-CLOSE-01”.

**`F:\drmind` (Bellvia) não foi modificado.** Todas as evidências abaixo são de **bancada local** (PostgreSQL 16 local descartável com o schema real migrado e os papéis reais `propectai_app` sem BYPASSRLS; Prisma simulado sobre `psql`; esbuild + Chromium/Playwright). **Nenhuma** foi produzida contra produção e **nenhuma substitui o CI do monorepo**.

| Evidência | Arquivo | O que prova | Resultado |
|---|---|---|---|
| Isolamento em SQL puro sob RLS | `bancada/iso-check.*` (entrega anterior) | Beta, com ids do Alfa, lê 0 linhas | OK |
| Serviço **real** sobre PG local | `bancada/service-isolation.out` | Isolamento, soft delete, limites, **profundidade com prova**, **entidades de lead excluído**, cartão órfão | 37/37 |
| Mutações (provas de que os testes não são vazios) | descritas em `P04-QA-RELATORIO.md` | remover o filtro de lead ativo → 5 falhas; remover a verificação de prova → 4 falhas | confirmado na execução |
| UI em Chromium | `bancada/ui-run.out` | grafo, expansão, zoom/pan/teclado, Beta×Alfa, 390/820 px, sem modal, sem erro de console | 28/28 (repetido na QA-02) |
| Concorrência na UI | `bancada/ui-concorrencia.out`, `ui-concorrencia.cjs` | 7 cenários de resposta fora de ordem, repetição, reinício, troca de sessão | 16/16 (sem os controles: 7 falhas; repetido na QA-02) |
| Volume e desempenho | `bancada/volume.out`, `volume-metricas.tsv`, `volume-explain.txt`, `volume-seed.sql` | 3.000 leads, 35 mil notas: nº de consultas constante (13/16), tetos de página, groupBy de notas usa índice composto (3,7 ms) | 6/6 |
| Integridade relacional | `bancada/integridade-check.sql` / `.out` | 6 FKs simples aceitam referência entre tenants; 3 FKs compostas recusam | achado documentado |
| Capturas de tela da UI (bancada) | `capturas/01…11.png` | estados vazio, inicial, expandido, sinal desconhecido, pesquisa, erro, Beta×Alfa, mobile, tablet | **bancada, não o app completo** |
| Troca de workspace/sessão (QA-02) | `bancada/ui-workspace.cjs`, `ui-workspace.out`, `bancada/entry.tsx`, `bancada/stub-next-navigation.tsx`, `bancada/stub-lucide-react.tsx`, `capturas/troca-1…3.png` | texto e DOM sem rastro do workspace anterior após troca de workspace/usuário, logout, 401, requisições pendentes e checagem periódica; sem falso positivo com rede fora/500. Controle negativo (vigia desligado): reprova | **27/27 na QA-03 (era 20/20), só bancada** (emula layout+página do Next); inclui W9–W13: anúncio entre abas e componentes reais `LoginForm`/`LogoutButton` |
| Integridade `pipeline_cards` (QA-02) | `bancada/integridade-pipeline-cards.sql` / `.out` | unicidade `…leadId_key` ≠ proteção de tenant; cartão cruzado aceito em lead sem cartão; FK composta de estágio recusa | achado corrigido |
| `chaveDeIdentidade` | `packages/types/src/session-identity.test.ts` | 6 testes vitest escritos; as 7 asserções equivalentes foram executadas com `tsx` (o vitest não está instalado neste ambiente) | **não executado em vitest** |
| Tipos | `packages/types/src/intelligence-*.test.ts` | 35 testes e `tsc --strict` | OK |

## P04-CLOSE-01 — resultados comprovados no GitHub Actions #77

**Run:** https://github.com/layartdigital/prospectai/actions/runs/41450846331 · **commit** `78e9fe2588ee1ee0aafe1804c4f62c1b2d58d225` · PR #7 **Draft** · sem merge · 0 deploys.

| Item | Resultado | Fonte |
|---|---|---|
| `CI_77` (Tipos, Builds, Testes e RLS, E2E real, Resultado do CI) | **PASS** (5/5 verdes) | página do PR #7 e do run |
| `EXPLORER_E2E` | **27/27** (0 falhas · 0 instáveis · 0 pulados) | log do passo “Resumo dos testes” |
| `PRODUCT_REGRESSION` | **29/29** (0 falhas · 0 instáveis · 0 pulados) | log do passo “Resumo dos testes” |
| `ARTIFACT_SANITIZATION` | **PASS** | passos “Montar a saída publicável e sanitizada” e “Varredura de sanitização do que será publicado” verdes |
| `ARTIFACT_UPLOAD` | **VERIFIED** (passo verde; conteúdo não inspecionado pela Executora) | passo “Publicar evidências sanitizadas” |
| Artefato `e2e-evidencias` | retenção 30 dias · **ID e expiração: PENDENTE** (a informar pelo proprietário) | ver `P04-CLOSE-01-RELATORIO.md`, seção 5 |
| CI do commit documental | **PENDENTE** (run #78 a registrar) | — |

As contagens foram lidas na saída de texto do log, enviada pelo proprietário; a Executora não tem acesso direto ao Actions. Relatório definitivo: `P04-CLOSE-01-RELATORIO.md`.

## P04-QA-04 — E2E real (GitHub Actions)

Artefatos de **autoria** desta rodada (commit `84a96c6`); o resultado de execução está na seção anterior (#77 aprovado) e em `P04-QA-04-RELATORIO.md`. Os estados `NOT_EXECUTED` desta tabela são o **registro histórico da autoria**, superados pelo #77.

| Item | Arquivo | O que é | Estado |
|---|---|---|---|
| Portão no CI | `.github/workflows/ci.yml` (job `e2e`, `resultado`) | Next/NestJS/Prisma/PostgreSQL reais + Playwright; obrigatório no “Resultado do CI” | **NOT_EXECUTED** (aguarda push) |
| Specs E2E-01…08 | `apps/web/e2e/explorer-01…04-*.spec.ts`, `explorer-support.ts` | 27 testes (6 + 5 + 12 + 4 por arquivo; ver matriz) | tipados (0 erros); **NOT_EXECUTED** |
| Regressão E2E-09 | `apps/web/e2e/fluxo-0…4-*.spec.ts` | existentes, sem alteração | **NOT_EXECUTED** no CI |
| Gateway e config | `apps/web/e2e/ci/gateway.mjs`, `apps/web/playwright.ci.config.ts` | /api → API, resto → Next; sem trace/vídeo/retry | gateway testado localmente com servidores de teste |
| Fixtures | `prisma/e2e-explorer-fixtures.ts` | Alfa enriquecido + Beta, só banco local | sintaxe OK; **NOT_EXECUTED** |
| Matriz e conformidade | `P04-QA-04-RELATORIO.md` | cenário → teste → o que provará → resultado | preenchida como NOT_EXECUTED |
| Como funciona | `qa/E2E-REAL.md` | passos do job, regras, fixtures, leitura | — |
| Linha de base do CI | Actions #75 (`0028802`) | 4/4 jobs verdes; sem teste de navegador real | PASS (informado pelo proprietário) |

## P04-QA-04R — correção direcionada (commit `78e9fe2`; **aprovada no run #77**)

| Item | Arquivo | O que é | Estado |
|---|---|---|---|
| Sanitizador | `apps/web/e2e/ci/sanitizar-resultados.mjs` | saída publicável por lista permitida; diagnóstico por categoria de campo; falha apaga a saída | testado com JSON sintético e real; **PASS no #77** |
| Correção A | `apps/web/e2e/explorer-support.ts`, `explorer-02-…spec.ts` | espera dos nós devolvidos pela API; contagem exata de motivos | tipado (0 erros); **PASS no #77** |
| Correção B | `apps/web/e2e/fluxo-1-sessao-e-dashboard.spec.ts`, passo de saúde em `ci.yml` | rodapé conferido contra o `/health` real | tipado; **PASS no #77** |
| Correção C | `.github/workflows/ci.yml`, `.gitignore` | bruto em `$RUNNER_TEMP`; publicar só o sanitizado | YAML válido; **PASS no #77** |
| Relatório | `P04-QA-04-RELATORIO.md` (seção QA-04R) | causa raiz, classificação, antes × depois, riscos | — |
| Linha de base | Actions #76 (`84a96c6`) | Explorer 25/27 · regressão 28/29 · sanitização bloqueou | informado pelo proprietário |
| Resultado | Actions #77 (`78e9fe2`) | Explorer 27/27 · regressão 29/29 · sanitização PASS | **PASS** (log) |

## O que NÃO existe (não foi executado) — texto histórico

> **Atualização P04-CLOSE-01:** a lista abaixo descreve o que faltava nas rodadas de **bancada**. Desde o CI #75/#77, typecheck, `prisma generate`, builds, jest da API (inclusive o spec HTTP do Explorer), suíte completa, portão de RLS e a regressão do produto em navegador real **foram executados e estão verdes** (jobs Tipos, Builds, Testes e RLS, E2E real). Seguem **não executados**: `validar-p04-qa.ps1` (script local, fora do CI), implantação em servidor e qualquer teste em produção.

typecheck real do monorepo, `prisma generate`, ESLint, `nest build`, `next build`, jest da API (inclui `intelligence-tenant.spec.ts`), suíte completa, portão de RLS, vitest, regressão do produto, captura da ficha do lead no aplicativo completo, troca de workspace no aplicativo completo, execução do `ci.yml` e do `validar-p04-qa.ps1`. Obtê-los: `qa/COMO-RODAR.md` (Rota A: CI do GitHub).

## Hashes SHA-256

```
0538cf27db8d2dcabcdba42dd6b3f24deb7b07b62de0bfd6086ac3a0080daa37 | bancada/entry.tsx
d3ae921bdca5e7aea06f2469175ad568fb0551149a41c0a4318d395b9fc2b235 | bancada/fake-prisma.ts
673210d9389a90caee379ffb040d86f6261dba17f308e0f03af3808ae61ca891 | bancada/integridade-check.out
7690e3faa65a11450b3f7f8429eadb20195d5efb9c8fb1827e2b565e0b8c7483 | bancada/integridade-check.sql
269d7739a25c3b7f197af68e0c89d06409db6e0128e8b76e9982fa38dc3c1cce | bancada/integridade-pipeline-cards.out
cbda32754f9c729842333a4359e90592d603586411d2ecb2651c5e997f5e5e45 | bancada/integridade-pipeline-cards.sql
9b43998a588934d44da2be93c818bed76e148d9527af4bf38150f7166334829d | bancada/iso-check.out
7c26b83e7490b5cf0f5a8689d5cd97841edac1fbae45da23b66b62963a6fbc44 | bancada/iso-check.sql
f1b9fbd732b136b4693a965eefe540b3efe4755502a6167d6d87890a54ee4de5 | bancada/run-service.ts
3602ad7c25bb235a5cbc9fffaa5255a015c06e1b7755d29f6e1e5859a6469cd0 | bancada/seed-p04.sql
71632fd2e10ab4bf510df94d14a952710a8e0f0e9ac568ca83a44317d1451162 | bancada/server.ts
810be779a7a0d83597707c386549c0067ff9eaa905d4b2225f2a9af7612c9124 | bancada/service-isolation.out
e1edf5962fb0a47dacad74ee8f567b3fd2cea54de94db8f706775b08846e7b00 | bancada/service-isolation.test.ts
c16a58ba8a943d3fc9ee1c3192b6fba179d80e3cac6e169374d569cf8b268965 | bancada/stub-lucide-react.tsx
097fbdc611b4ce2804f2a2306d1c51adf15e1ed3a349b115dcc473e1bdd8548d | bancada/stub-next-navigation.tsx
d5a425c2d5618bae675e31f2f0d177917de2ecd6826981117959d55b5cccd895 | bancada/ui-concorrencia.cjs
0b56d140120be693ea76f95abe2c70d12a011c7cdd6234fd4644a0733c553000 | bancada/ui-concorrencia.out
154479242bbb4f1d9f0924f45029e2a06523a43ad33465f552109f925531039f | bancada/ui-run.cjs
f1aa6ca0dc929f718484d538dd3b06dad9c737ecb8e11473635c007e532a3430 | bancada/ui-run.out
7268b70b86d45d4072a69bcc6345a87eff0651e5e7d933100d55785417de6875 | bancada/ui-workspace.cjs
5941579ad099acd757276c56ccac866849cd021f7d765f2871f9fdfa8e3e16e4 | bancada/ui-workspace.out
8490e329448e092d03f89427add72c09f6869323ff2f4ce5920e8ca73f2af0d9 | bancada/volume-explain.txt
99eb48eef7a8d7886443ebbd08d6a82f0068c15e97d18a7913b58901d6590093 | bancada/volume-metricas.tsv
a19a791ab9a4a8970d8ffa3192eb383471a8f173e1f75c11a292d640db309c22 | bancada/volume-seed.sql
987b2c8923941234241587fdffeaaa972777c4dae5d842b66b27f07d4463a035 | bancada/volume.out
cde3a02b3f4128a1434530b62a3dfd35cfa294153f711ed5beb180fd0db50efe | bancada/volume.test.ts
907c30dfa4534ccebfc6fe716daeee11012fe20172f897bfc5689654838a4a0e | capturas/01-estado-vazio.png
3fcd252ea93729e35d74d5416fdb3a7b4c0e21e0fd5534f14309936d49feeb67 | capturas/02-grafo-inicial.png
b5b78cae48da2162e7a94e33b32ff4a90d709e192befd2ecebcd610a6d93547e | capturas/03-grafo-expandido.png
35f1cec85ae512fbd652ff64190abae4e1fba21ade7146f9655f35dc04d402e2 | capturas/04-sinal-desconhecido.png
abf3c3c4ce88b2db9290ed9717094b0e54bc59f4ecaca5f31ad4fc805cd2a646 | capturas/05-pesquisa-expandida.png
34073e0ab224bea106182c2f8d9c9235e53f6f9b8509f3c5048f5985923f3ec1 | capturas/06-outro-lead.png
1230492a4fc53b736637937ef012a48493442da8d452570e1323ef966aafef0c | capturas/07-erro-nao-encontrado.png
28afc771fd299c618287f7bd2e83cf5054a9028f9ebeb3254779149ee9b37c9c | capturas/08-beta-lead-do-alfa.png
0b1bdf3f9b490f43e1d94b8b12a4658fa09df7b3b43dcf6fa548444234fa9e3b | capturas/09-beta-proprio-grafo.png
3800003bed2515f4cb3a18bb1144d82cb20b1d7ce550b1525c52f04e16a3e81d | capturas/10-mobile-390.png
f204d33f00ea0819377f30c2ad235458bccd5a477279be2f42e79da97cfcea84 | capturas/11-tablet-820.png
eb471a3c0a0d98c0aed7dacbd39bcdd793054d28ac8f4ab8223d69d25be6ed2d | capturas/troca-1-antes-alfa.png
76bee70797e5c972250efea02935187880ddec224eb0bedc7f01e523de1cfd11 | capturas/troca-2-aviso-descartado.png
234a8937b4ee44147192c5d04401f7033458c61dce36828a253cafa1b115a303 | capturas/troca-3-depois-beta.png
```

### Hashes SHA-256 — arquivos da QA-04R (conteúdo do commit)

```
7a379f4aa280782011695cc89c483658bca170aa66a3b9cbbb78c6e0e22ae6f7 | apps/web/e2e/ci/sanitizar-resultados.mjs
d9b9c2d2ec049f5d47d7d3a532cb631ce5534a1cb088fd108ae9b7797ff3a3c9 | apps/web/e2e/explorer-support.ts
d85374c4a6429f114c518f14553f1df9b1a2478f22ca579406fb315e268c6beb | apps/web/e2e/explorer-02-expansao-e-interface.spec.ts
dba4bbce8908111581e2c762b1d833851a2a703e81cb202eff2f3d557e37416f | apps/web/e2e/fluxo-1-sessao-e-dashboard.spec.ts
f7c2fa66045e2d4968e37d80bf3973eb841803e58142d5c0533fbaa3e0aa2c68 | apps/web/playwright.ci.config.ts
06ef3984cc00e920111ed1a2981802535f70c3a74bf755c5206064a3c05b0f7e | .github/workflows/ci.yml
d15b1788337eda7cbaa7afd08117242936b8a5d0a9da2aa2ddb4ec06a9d18d99 | .gitignore
```
