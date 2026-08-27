# ADR-002 — Estratégia de integração do Flowsint

**Status:** Accepted · 22/08/2026
**Fase:** Prompt 01, STEP 8
**Decisão:** **não adotar agora**, mantendo a opção aberta a custo zero

---

## Contexto

O programa foi concebido como "ProspectAI + Flowsint + IA". O Prompt 01 §13 pede escolha entre quatro opções de integração e declara preferência inicial pela híbrida.

O STEP 4 verificou os fatos, e três deles mudam a análise:

| Fato | Verificação |
|---|---|
| Release mais recente | **v1.2.10 de 05/06/2024** — não v1.2.11 de 01/07/2026 como o §3 afirma |
| Maturidade | README declara *"in early development"*, testes *"incomplete"* |
| Licença | Apache 2.0 — permissiva, e operar como SaaS não é redistribuição |

## Problema

O Flowsint entra no ProspectAI? Como, e quando?

## A análise que decide

O Prompt 02 §6 estabelece que **feature ≠ provider**. Aplicando ao caso: quais capabilities o ProspectAI precisa, e quais delas só o Flowsint atende?

| Capability | Flowsint | Alternativa |
|---|---|---|
| Maps Discovery | Não | `gosom/google-maps-scraper` — já operante |
| Website Health Audit | Não | Nativo — é a v0.2 aprovada |
| Tech Stack | Parcial | BuiltWith, Wappalyzer — maduros, mais baratos |
| Review Mining | Não | Scraper atual já traz |
| Social Intelligence | Parcial | **Bloqueado por login wall — medido no Gate 0** |
| Email / Phone / Decision Maker | **Sim** | — mas ver abaixo |
| Ads Intelligence | Não | Sem fonte legítima no Brasil |

**A única área de força real do Flowsint é justamente a que o produto proibiu:**

- `CLAUDE.md` regra 6 — dados pessoais de terceiros não são persistidos
- Prompt 01 §19 — breach lookup não entra por disponibilidade técnica
- `scope-v0.2.md` §3.2 — busca de perfil por nome fora de escopo

Removida a camada de dados pessoais, **o que resta do Flowsint que o produto precisa é pequeno, e tem substituto mais maduro.**

## Custo operacional

Adotar exige Neo4j, Celery, FastAPI e Redis adicional. Contra o orçamento declarado — 4 serviços, 2 datastores, 2 runtimes, 8h/mês — **um único provider consumiria o orçamento inteiro**, e ainda adicionaria Python ao stack Node.

## Decisão

**Opção C adaptada — não adotar o Flowsint, preservando o encaixe.**

1. `FlowsintAdapter` permanece **previsto e não implementado** no catálogo de adapters (Prompt 02 §5)
2. O `ProviderContract` e o `ProviderRouter` nascem provider-agnostic, sem nenhuma concessão ao Flowsint
3. Referência pinada e licença registradas em `THIRD_PARTY_FLOWSINT.md`
4. Nenhum código, container, dependência ou custo é incorrido

## Alternativas consideradas

| Opção | Avaliação |
|---|---|
| **A** — serviço externo isolado | Estoura o orçamento inteiro por capabilities que têm substituto melhor |
| **B** — fork interno | Dívida de merge em projeto de release parada há 2 anos. Pior opção |
| **D** — híbrida | Preferência inicial do prompt. Mesmo custo da A, sem benefício adicional identificado |
| **C** — adotada | Custo zero, opção preservada, nenhuma capability perdida hoje |

## Consequências

**Positivas:** orçamento operacional preservado; nenhuma dependência de projeto em early development; o stack permanece Node; a decisão é reversível sem trabalho descartado, porque o contrato é agnóstico.

**Negativas:** capabilities de dados pessoais ficam indisponíveis — o que é consequência desejada; se surgir necessidade de grafo, o trabalho começará do zero.

**Não é rejeição do programa Intelligence.** A foundation do Prompt 02 continua necessária. Muda apenas que o Flowsint sai do caminho crítico, e o primeiro consumidor real do Router passa a ser a auditoria da v0.2.

## Impacto

| Dimensão | Efeito |
|---|---|
| Custo | **Evita** ~R$/mês de infraestrutura e horas de operação não orçadas |
| Segurança | Evita superfície de OSINT com execução de ferramentas externas |
| Privacidade | Alinha com as três decisões já registradas |
| Roadmap | Elimina as subfases 03A–03D do Prompt 02 §96 |

## Gatilhos de revisão

Reabrir se **qualquer um** ocorrer:

1. Surgir pergunta de produto que exija travessia de grafo com profundidade maior que 2
2. O projeto cortar release nova com suíte de testes completa
3. Aparecer capability corporativa — não de pessoa física — que só ele atenda
4. O orçamento operacional crescer o suficiente para comportar 4 serviços adicionais

## Nota de método

O §3 do próprio Prompt 01 instrui: *"NÃO considere a documentação pública isoladamente como fonte absoluta de verdade"*. A regra se aplicou ao prompt: a versão que ele afirma existir não existe, e as datas divergem em dois anos. **A decisão foi tomada sobre o repositório verificado, não sobre a premissa recebida.**
