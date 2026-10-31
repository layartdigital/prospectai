# P04 — Comparativo: ProspectAI atual × experiência investigativa do Flowsint × Intelligence Explorer

**`F:\drmind` (Bellvia) não foi modificado.**

**Método e limites.** A coluna "Flowsint" usa **apenas** o que está medido nos documentos internos do programa (`THIRD_PARTY_FLOWSINT.md`, ADR-002; releases e README medidos em 17/09/2026). **Não foi feita nova medição nem uso da aplicação Flowsint nesta sessão**; onde o Flowsint não foi observado, a célula diz "não verificado". "Proposto" é o que o Explorer **pretende** ser, e fica separado do que foi verificado em execução.

| Aspecto | ProspectAI atual (verificado no código) | Flowsint (documentado internamente) | Explorer 0.1.0 |
|---|---|---|---|
| Finalidade | Prospecção de negócios locais: busca, leads, score, pipeline | Investigação OSINT em grafo, centrada em pessoas e identidades (analistas, jornalistas, pesquisadores) | Entender **um lead da base do tenant** e a origem de cada dado |
| Fonte dos dados | Scraper `gosom` + verificações próprias, no PostgreSQL | Enrichers/Tools que consultam fontes externas | Somente o cadastro do próprio tenant. **Verificado em execução (bancada)** |
| Modelo de relação | Tabelas relacionais; sem visão de grafo | Entidades e relacionamentos com "confidence" | 13 relações por FK/coluna, todas `VERIFICADA`; `INFERIDA` reservada sem regras. **Verificado (bancada)** |
| Visualização | Listas, ficha do lead, kanban | Grafo interativo (não observado nesta sessão) | Grafo SVG com zoom, pan, teclado, filtros, expansão paginada. **Verificado em Chromium (bancada)** |
| Explicabilidade do score | Motivos de score na ficha | Não aplicável/não verificado | Motivos como nós ligados ao score, com origem |
| Multi-tenant e RLS | Sim (RLS forçada, papel `propectai_app`) | Não verificado | Herdado; testado em SQL, serviço real e UI (bancada). **Teste jest HTTP escrito, não executado** |
| Dados pessoais de terceiros | Regra permanente: não persistir | Foco é justamente investigar pessoas (ADR-002 aponta conflito) | Excluídos por desenho; JSON livre fora dos selects |
| IA | Nenhuma | Não verificado | **Somente contrato**; estado "indisponível" na tela |
| Infraestrutura | PostgreSQL, Redis, scraper | FastAPI, Celery, Neo4j, Redis | Nenhuma nova |
| Licença | Proprietária | Apache 2.0 | Código próprio; nada copiado |
| Maturidade | v0.1.1 em construção | README: "early development", testes "incomplete" (v1.2.12) | 0.1.0, primeiro incremento |

## Leitura honesta

- O Explorer **não compete** com o Flowsint em amplitude de investigação, enriquecimento externo nem profundidade; não é o objetivo.
- O ganho do Explorer sobre o ProspectAI atual é **explicabilidade e navegação** de dados que já existem.
- A vantagem declarada (verificabilidade e isolamento) vale para o escopo atual; relações entre leads e IA são lacunas reais.

## Proposto, ainda não verificado

Relações entre leads, investigação salva, exportação, IA com evidência, diferenciação por plano.
