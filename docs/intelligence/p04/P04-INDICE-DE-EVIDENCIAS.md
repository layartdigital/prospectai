# P04 — Índice de evidências (atualizado em P04-QA-02)

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
| Troca de workspace/sessão (QA-02) | `bancada/ui-workspace.cjs`, `ui-workspace.out`, `bancada/entry.tsx`, `bancada/stub-next-navigation.tsx`, `capturas/troca-1…3.png` | texto e DOM sem rastro do workspace anterior após troca de workspace/usuário, logout, 401, requisições pendentes e checagem periódica; sem falso positivo com rede fora/500. Controle negativo (vigia desligado): reprova | **20/20, só bancada** (emula layout+página do Next) |
| Integridade `pipeline_cards` (QA-02) | `bancada/integridade-pipeline-cards.sql` / `.out` | unicidade `…leadId_key` ≠ proteção de tenant; cartão cruzado aceito em lead sem cartão; FK composta de estágio recusa | achado corrigido |
| `chaveDeIdentidade` | `packages/types/src/session-identity.test.ts` | 6 testes vitest escritos; as 7 asserções equivalentes foram executadas com `tsx` (o vitest não está instalado neste ambiente) | **não executado em vitest** |
| Tipos | `packages/types/src/intelligence-*.test.ts` | 35 testes e `tsc --strict` | OK |

## O que NÃO existe (não foi executado)

typecheck real do monorepo, `prisma generate`, ESLint, `nest build`, `next build`, jest da API (inclui `intelligence-tenant.spec.ts`), suíte completa, portão de RLS, vitest, regressão do produto, captura da ficha do lead no aplicativo completo, troca de workspace no aplicativo completo, execução do `ci.yml` e do `validar-p04-qa.ps1`. Obtê-los: `qa/COMO-RODAR.md` (Rota A: CI do GitHub).

## Hashes SHA-256

```
2b150b24c6a76b19c89fb05ed6a29e19d7d9946e444fa0b2b23fb57dc592575a | bancada/entry.tsx
d3ae921bdca5e7aea06f2469175ad568fb0551149a41c0a4318d395b9fc2b235 | bancada/fake-prisma.ts
673210d9389a90caee379ffb040d86f6261dba17f308e0f03af3808ae61ca891 | bancada/integridade-check.out
7690e3faa65a11450b3f7f8429eadb20195d5efb9c8fb1827e2b565e0b8c7483 | bancada/integridade-check.sql
269d7739a25c3b7f197af68e0c89d06409db6e0128e8b76e9982fa38dc3c1cce | bancada/integridade-pipeline-cards.out
cbda32754f9c729842333a4359e90592d603586411d2ecb2651c5e997f5e5e45 | bancada/integridade-pipeline-cards.sql
9b43998a588934d44da2be93c818bed76e148d9527af4bf38150f7166334829d | bancada/iso-check.out
7c26b83e7490b5cf0f5a8689d5cd97841edac1fbae45da23b66b62963a6fbc44 | bancada/iso-check.sql
f1b9fbd732b136b4693a965eefe540b3efe4755502a6167d6d87890a54ee4de5 | bancada/run-service.ts
3602ad7c25bb235a5cbc9fffaa5255a015c06e1b7755d29f6e1e5859a6469cd0 | bancada/seed-p04.sql
d8f612888614c84448efbe1fa5d7d44402867cc75d39d181f9ff75cbc417a3f4 | bancada/server.ts
810be779a7a0d83597707c386549c0067ff9eaa905d4b2225f2a9af7612c9124 | bancada/service-isolation.out
e1edf5962fb0a47dacad74ee8f567b3fd2cea54de94db8f706775b08846e7b00 | bancada/service-isolation.test.ts
097fbdc611b4ce2804f2a2306d1c51adf15e1ed3a349b115dcc473e1bdd8548d | bancada/stub-next-navigation.tsx
d5a425c2d5618bae675e31f2f0d177917de2ecd6826981117959d55b5cccd895 | bancada/ui-concorrencia.cjs
0b56d140120be693ea76f95abe2c70d12a011c7cdd6234fd4644a0733c553000 | bancada/ui-concorrencia.out
154479242bbb4f1d9f0924f45029e2a06523a43ad33465f552109f925531039f | bancada/ui-run.cjs
f1aa6ca0dc929f718484d538dd3b06dad9c737ecb8e11473635c007e532a3430 | bancada/ui-run.out
c50ab41f3a97cf43937c8ec5fa0f0c46b997f39bdf39b2a5abbe8eb7cc12073f | bancada/ui-workspace.cjs
8310e0b1f3b8cdc85ad622a6ae10bfe0c9c976c7a64e9af6d0993b348d18a6b2 | bancada/ui-workspace.out
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
