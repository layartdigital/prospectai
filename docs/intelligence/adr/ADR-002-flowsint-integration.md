# ADR-002 — Estratégia de integração do Flowsint

**Status:** Accepted · 22/08/2026 · **base factual corrigida em 17/09/2026 — a decisão permanece, dois dos argumentos que a sustentavam não**
**Fase:** Prompt 01, STEP 8
**Decisão:** **não adotar agora**, mantendo a opção aberta a custo zero

---

## Contexto

O programa foi concebido como "ProspectAI + Flowsint + IA". O Prompt 01 §13 pede escolha entre quatro opções de integração e declara preferência inicial pela híbrida.

O STEP 4 verificou os fatos, e três deles mudam a análise:

| Fato | Verificação (22/08/2026) | **Medido em 17/09/2026** |
|---|---|---|
| Release mais recente | ~~**v1.2.10 de 05/06/2024** — não v1.2.11 de 01/07/2026 como o §3 afirma~~ | **v1.2.12 de 26/08/2026.** A v1.2.11 existe e é de 01/07/2026, exatamente como o §3 afirmava |
| Maturidade | README declara *"in early development"*, testes *"incomplete"* | **Confirmado na v1.2.12** — as duas frases continuam no README |
| Licença | Apache 2.0 — permissiva, e operar como SaaS não é redistribuição | Confirmado. `NOTICE` existe |

---

## Correção de fato — 17/09/2026

**A primeira linha da tabela acima estava errada, e com ela dois argumentos deste ADR.**

A medição está em `THIRD_PARTY_FLOWSINT.md` §1: tags obtidas por `git ls-remote --tags` e datas lidas do commit de cada tag. As releases vão de **03/12/2025 (v1.0.0) a 26/08/2026 (v1.2.12)**; a v1.2.10, que este ADR tomou por mais recente, é de **05/06/2026** — e não de 2024. Os meses da leitura original estavam certos; os anos, todos errados por exatamente dois.

**O que cai:**

1. **"Projeto de release parada há 2 anos"**, usado para descartar a opção B. O projeto cortou 12 releases em 2026 e o `CHANGELOG` da v1.2.12 é de endurecimento de base — `mypy`, `ruff`, `eslint`, *typecheck ratchet* em CI, tipagem das fronteiras de API.
2. **A leitura implícita de abandono**, que tornava a decisão confortável. Ela não era verdade.

**O que não cai, e é a maior parte:**

- **A análise de capabilities.** A tabela abaixo compara o que o produto precisa com o que o Flowsint oferece. Nada nela depende da data de uma release
- **O custo operacional.** Neo4j, Celery, FastAPI e Redis adicionais custam o mesmo em 2026 que custariam em 2024
- **O conflito com a regra 6.** É decisão de produto, não fato de upstream
- **A conclusão sobre a opção B.** Continua sendo a pior opção — **e agora por motivo inverso**: dívida de merge contra upstream *ativo*, cortando release a cada poucas semanas, é mais cara que contra um projeto parado, não menos

**Sobre a "Nota de método" no fim deste documento:** ela se congratula por ter verificado o prompt em vez de acreditar nele. Fica, porque a regra é boa — mas com a correção ao lado, porque **a verificação errou e o prompt acertou**. Uma nota de método que sobrevive ao seu próprio contraexemplo vale mais do que uma apagada.

**Gatilho nº 2 — disparo parcial.** *"O projeto cortar release nova com suíte de testes completa"* tem duas partes. Release nova: **sim**, duas desde este ADR. Suíte completa: **não** — o README da v1.2.12 ainda diz *"Each module has its own (incomplete) test suite"*. O gatilho **não fecha**, e passa a valer a pena reconferir a cada release, em vez de nunca.

---

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

**Removida a camada de dados pessoais, o que resta do Flowsint que o produto precisa é pequeno, e tem substituto mais maduro.**

> **Ressalva de 17/09/2026 à frase em negrito acima.** Ela é larga demais. A regra 6 proíbe dados de avaliadores e o link de perfil pessoal do `owner`; **e-mail e telefone comerciais já são coletados e pontuados** pelo pipeline atual. O que colide de fato é **decision maker como pessoa física nomeada**. E o `scope-v0.2` §3.2 exclui busca por nome por **qualidade** — falso positivo de homônimo —, não por privacidade. A conclusão da seção não muda; a extensão dela, sim.

## Custo operacional

Adotar exige Neo4j, Celery, FastAPI e Redis adicional. Contra o orçamento declarado — 4 serviços, 2 datastores, 2 runtimes, 8h/mês — **um único provider consumiria o orçamento inteiro**, e ainda adicionaria Python ao stack Node.

> **Nota de 17/09/2026.** Esta conta continua valendo integralmente. O que o adendo `FLOWSINT-EGRESS-REFERENCIA-INTERNA.md` mostrou é **outro** número: o custo do trabalho de **isolamento de rede** que o Prompt 03B exige, que tem implementação de referência dentro de casa — 115 testes em `apps/worker/src/egress`, `ADR-004` e três versões da `SECURITY-EGRESS-POLICY`. São duas contas diferentes, e o adendo não abate nenhum serviço desta aqui.

## Decisão

**Opção C adaptada — não adotar o Flowsint, preservando o encaixe.**

1. `FlowsintAdapter` permanece **previsto e não implementado** no catálogo de adapters (Prompt 02 §5)
2. O `ProviderContract` e o `ProviderRouter` nascem provider-agnostic, sem nenhuma concessão ao Flowsint
3. Referência pinada e licença registradas em `THIRD_PARTY_FLOWSINT.md` — **pin movido para v1.2.12 em 17/09/2026**, ver a §2 de lá
4. Nenhum código, container, dependência ou custo é incorrido

## Alternativas consideradas

| Opção | Avaliação |
|---|---|
| **A** — serviço externo isolado | Estoura o orçamento inteiro por capabilities que têm substituto melhor |
| **B** — fork interno | ~~Dívida de merge em projeto de release parada há 2 anos.~~ **Corrigido em 17/09/2026:** dívida de merge contra upstream **ativo**, que corta release a cada poucas semanas. Continua sendo a pior opção, por motivo inverso ao escrito |
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
2. O projeto cortar release nova com suíte de testes completa — **disparo parcial em 17/09/2026**: releases novas sim (v1.2.11 de 01/07, v1.2.12 de 26/08), suíte completa não. Reconferir a cada release
3. Aparecer capability corporativa — não de pessoa física — que só ele atenda
4. O orçamento operacional crescer o suficiente para comportar 4 serviços adicionais

## Nota de método

O §3 do próprio Prompt 01 instrui: *"NÃO considere a documentação pública isoladamente como fonte absoluta de verdade"*. A regra se aplicou ao prompt: a versão que ele afirma existir não existe, e as datas divergem em dois anos. **A decisão foi tomada sobre o repositório verificado, não sobre a premissa recebida.**

> **Correção de 17/09/2026 — este parágrafo é falso, e fica.**
>
> A versão que o prompt afirma existir **existe**: v1.2.11, de 01/07/2026, exatamente a data escrita nele. As datas divergiam em dois anos, sim — **para o lado de quem verificou.**
>
> A regra do §3 é boa e continua valendo. O que este caso ensina é que ela é incompleta: *não tome a documentação pública como verdade absoluta* **e não tome a própria verificação como isenta**. Uma leitura de página não é uma medição; `git ls-remote` é. O comando estava escrito como pendência na §2 do `THIRD_PARTY_FLOWSINT.md` desde o primeiro dia, e teria custado dez segundos.
