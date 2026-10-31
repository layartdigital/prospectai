# P04 — Índice de evidências

**`F:\drmind` (Bellvia) não foi modificado.** Todas as evidências abaixo são de **bancada local** (PostgreSQL 16 local descartável, Prisma falso sobre `psql`, esbuild + Chromium/Playwright). **Nenhuma** foi produzida contra produção, e nenhuma substitui o CI do monorepo.

| Evidência | Arquivo | O que prova |
|---|---|---|
| Isolamento em SQL puro como `propectai_app` sob RLS | `evidencias/bancada/iso-check.sql` / `.out` | Beta, com ids do Alfa, lê 0 linhas; sem `tenantId` no where só a RLS já segura |
| Serviço **real** (`IntelligenceService`) sobre PG local | `evidencias/bancada/service-isolation.out` | 19/19: dono vê o seu, Beta recebe 404 idêntico a inexistente, 12 combinações de expansão negadas, sem JSON livre/URL, DESCONHECIDO preservado, limites |
| UI em Chromium | `evidencias/bancada/ui-run.out` | 28/28 (grafo, expansão, paginação, zoom/pan/teclado, Beta×Alfa, 390 px/820 px, sem modal, sem erro de console) |
| Seed da bancada | `evidencias/bancada/seed-p04.sql` | Dados fictícios **apenas no PG local da bancada**; a UI do produto não contém dado fictício |
| Capturas de tela | `evidencias/capturas/01…11.png` | Estados vazio, inicial, expandido, sinal desconhecido, pesquisa expandida, outro lead, erro, Beta×Alfa, mobile, tablet |
| Tipos | `packages/types/src/intelligence-*.test.ts` | 35 testes (22 grafo + 9 layout + 4 contrato de IA) e `tsc --strict` limpo nos 3 módulos |

**Limite das capturas:** não há captura da ficha do lead com o botão "Explorar relações" (a ficha exige o app completo, não a bancada).

## Hashes SHA-256

```
9b43998a588934d44da2be93c818bed76e148d9527af4bf38150f7166334829d | bancada/iso-check.out
7c26b83e7490b5cf0f5a8689d5cd97841edac1fbae45da23b66b62963a6fbc44 | bancada/iso-check.sql
70d2cde4bbee0cc347be60a9d51cb330220e65d7cc01658279b7b49211002994 | bancada/seed-p04.sql
74ad9e17339ed98233af7f69ef52282c8bc4125d1362d718cc0ec28b98f3f021 | bancada/service-isolation.out
9f3bd55d4fcc2d52130715be87c7c41432deacff7e334ad216802db9ffaa57c1 | bancada/ui-run.out
7369c03fcafa624024be190d349b20ab2d82b7566737b32ee50fb996dc5b385c | capturas/01-estado-vazio.png
3fcd252ea93729e35d74d5416fdb3a7b4c0e21e0fd5534f14309936d49feeb67 | capturas/02-grafo-inicial.png
3cf9773c8591cd8514a023873fa7e43fcd800c80f4ce4f89a5babcea28aafa2b | capturas/03-grafo-expandido.png
a077f4513e5288bdc3d947ffa802263baeec6caf8446986ea8ce238fdfa66b41 | capturas/04-sinal-desconhecido.png
2cf12546732b4da3b2da04d7ea23ec948ad29c3ff92825677e65db4581bffc01 | capturas/05-pesquisa-expandida.png
366619e7dea23983cedad963b953279411e875060504039f74294f4395c6e80a | capturas/06-outro-lead.png
481a61ee68a3ff442ff2a74d608f0b665dabcc46d296af9cdc53b4b30e1b7438 | capturas/07-erro-nao-encontrado.png
9fc51c2918ebe30a244e40608e07eb7d167df391706e19716a9d15203b57d10d | capturas/08-beta-lead-do-alfa.png
823c600d6df589322ab556270d9d483fcb2d113edd44ea25a38d100426867976 | capturas/09-beta-proprio-grafo.png
7ef5a5504ad55f00a96ce7b14b19c435579ee9cce4339ea16e83b608cd6c764d | capturas/10-mobile-390.png
17701df081342659151d09b8785cc63d5b645e4f1f1766fe6483db3842ba66e6 | capturas/11-tablet-820.png
```
