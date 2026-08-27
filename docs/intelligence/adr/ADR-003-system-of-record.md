# ADR-003 — System of Record e a decisão sobre grafo

**Status:** Accepted · 22/08/2026
**Fase:** Prompt 01, STEP 8

---

## Contexto

O Prompt 01 §10 pede que se defina o System of Record e trate o grafo explicitamente, sugerindo Neo4j como projeção especializada. O §11 pede um catálogo de entidades de grafo com nomes de relacionamento.

O estado real: **PostgreSQL 16 é o único datastore transacional.** Redis existe como fila BullMQ e cache. Não há Neo4j, nem qualquer segundo store.

## Problema

Duas decisões acopladas: quem é dono da verdade, e o produto precisa de um banco de grafo?

## Decisão 1 — System of Record

**PostgreSQL é o System of Record de todo dado do produto. Sem exceção.**

- Redis é infraestrutura de execução — fila e cache. **Nada nele é fonte da verdade**, e nada pode passar a ser sem novo ADR
- Nenhum dado essencial pode existir apenas fora do PostgreSQL
- Qualquer store futuro é projeção derivada, com estratégia de reconstrução obrigatória

## Decisão 2 — Grafo: **G0, não adotar**

> Este critério exige uma decisão registrada, não a adoção de uma tecnologia. *Não adotar* é o resultado.

### As perguntas de produto

O teste é concreto: que pergunta o produto precisa responder que exija travessia?

| Pergunta | Profundidade | Resolve com |
|---|---|---|
| Que tecnologias este lead usa? | 1 | JOIN |
| Que sinais digitais tem? | 1 | JOIN |
| Que leads do meu tenant usam WordPress? | 1 | índice |
| Quem são concorrentes deste lead? | 2 | JOIN + `WITH RECURSIVE` se necessário |
| Que leads compartilham a mesma agência? | 2 | JOIN |

**Nenhuma pergunta identificada excede profundidade 2.** O `scope-v0.2.md` não contém uma sequer. O Prompt 02 §8 proíbe Neo4j nesta fase e o §13 reserva `INTELLIGENCE_GRAPH` como `DISABLED`.

### O custo

Um banco de grafo dedicado é, tipicamente, o componente mais caro de operar da arquitetura proposta: instância, backup, upgrade, monitoramento, e a projeção que dessincroniza e precisa ser reconstruída. Contra um orçamento de uma pessoa, é o item de maior custo pelo menor retorno demonstrado.

### O que fica no lugar

O **modelo conceitual** de entidades e relacionamentos é útil independente do datastore, e fica registrado para uso em tabelas relacionais:

Entidades: `Organization`, `Domain`, `Website`, `SocialProfile`, `Technology`, `BusinessCategory`, `Location`, `PublicContact`, `Competitor`, `Evidence`, `Provider`

Relacionamentos: `HAS_DOMAIN`, `HAS_WEBSITE`, `HAS_SOCIAL_PROFILE`, `USES_TECHNOLOGY`, `LOCATED_AT`, `COMPETES_WITH`, `DISCOVERED_FROM`

Convenção própria e versionada, não copiada de rótulos de terceiros — conforme §11 do Prompt 01.

## Alternativas consideradas

| Opção | Avaliação |
|---|---|
| **G0** — sem grafo, relacional | **Adotada.** Nenhuma pergunta atual exige mais |
| **G1** — relacional com API preparada para migrar | Considerada. Adiciona indireção sem consumidor. Adotável se o gatilho disparar |
| **G2** — Neo4j como projeção | Rejeitada. Maior custo operacional da arquitetura, sem pergunta que a justifique |

## Consequências

**Positivas:** um datastore a operar, um backup, um modelo de consistência; nenhuma projeção para dessincronizar; orçamento preservado para o que entrega valor.

**Negativas:** se surgir necessidade real de travessia profunda, haverá trabalho de migração. Mitigado por manter o modelo conceitual documentado e o acesso a relacionamentos atrás de um serviço, não espalhado em queries.

## Gatilhos de revisão

Reabrir se **qualquer um** ocorrer:

1. Pergunta de produto exigir travessia de profundidade 3 ou mais
2. Consulta recursiva em PostgreSQL exceder latência aceitável com volume real
3. Cliente demandar exploração visual de rede como funcionalidade
4. Volume de relacionamentos tornar o modelo relacional impraticável

**Nenhum gatilho está próximo hoje**, e o primeiro é o único que realmente muda a resposta.

## Verificação

- Fitness function: nenhum dado essencial persistido fora do PostgreSQL
- Nenhuma dependência de Neo4j em `package.json` ou `docker-compose.yml`
