# ADR-001 — ProspectAI é o produto e o System of Record

**Status:** Accepted · 22/08/2026
**Fase:** Prompt 01, STEP 8

---

## Contexto

O programa Intelligence introduz aquisição de dados por múltiplos providers. Sem uma fronteira declarada, o risco conhecido é o produto se tornar uma casca em torno de uma ferramenta de terceiro — perdendo controle de domínio, de dados e de evolução.

O ProspectAI já é um produto funcional: 40 modelos, 17 módulos, multi-tenant, com CRM, pipeline, planos e score explicável.

## Problema

Que relação o produto mantém com qualquer capacidade externa — Flowsint, Apify, BuiltWith, APIs oficiais ou crawlers próprios?

## Decisão

**O ProspectAI é o produto e o System of Record. Todo provider é capacidade substituível, acessada por contrato próprio.**

Consequências verificáveis:

1. Nenhum contexto do produto importa tipo, SDK, cliente ou modelo de domínio de provider
2. O frontend nunca chama provider direto
3. O usuário final nunca vê o nome de um provider na interface
4. Todo dado que o produto exibe vive no PostgreSQL, normalizado — nunca é lido de provider em tempo de renderização
5. Existe o modo `INTELLIGENCE_DISABLED`, sob o qual **o produto atual funciona integralmente**
6. Se qualquer provider desaparecer, o produto continua operante com menos sinais

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Produto como camada sobre um provider | Perda de controle de domínio; qualquer mudança de API vira incidente de produto |
| Domínio compartilhado com o provider | Acopla o modelo comercial a conceitos de OSINT que não pertencem a vendas |
| Sem fronteira formal, decidir caso a caso | É como a erosão acontece — sem regra, o atalho vence sob prazo |

## Consequências

**Positivas:** troca de provider sem refatoração de domínio; testabilidade com mocks; produto sobrevive ao desaparecimento de qualquer fonte; `INTELLIGENCE_DISABLED` protege a operação atual durante todo o programa.

**Negativas:** exige camada de adapter e normalização, que é código a mais; adiciona indireção entre a chamada e o resultado; a primeira feature através do Router custa mais que a chamada direta.

**Custo aceito** porque o segundo provider já está previsto — a auditoria da v0.2 — e a indireção se paga aí.

## Impacto

| Dimensão | Efeito |
|---|---|
| Segurança | Toda saída externa passa por ponto único, onde a egress policy se aplica |
| Tenant | Nenhum, direto |
| Custo | Ponto único para medir custo por provider |
| Rollback | Desligar a flag restaura o comportamento anterior |

## Verificação

Fitness functions F1, F2, F3, F6 e F7 do `BOUNDED-CONTEXTS.md` §4. **F7 — o produto funciona com Intelligence desligada — é teste E2E obrigatório, não intenção.**

## Gatilho de revisão

Se algum provider oferecer capacidade que não seja expressável pelo contrato interno sem distorcê-lo, reabrir para avaliar se o contrato está pobre ou se a capacidade não pertence ao produto.
