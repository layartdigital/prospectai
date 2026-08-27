# score-v1 — dispersão dentro da faixa `SEM_SITE`

**Data:** 22/08/2026
**Origem:** análise derivada do Gate 0, sobre os mesmos 111 leads reais
**Status:** achado, não decisão — precisa de validação comercial

---

## O que foi medido

Apliquei o `score-v1` conforme `docs/technical/scoring.md` aos 28 leads `SEM_SITE` da amostra, com um tenant hipotético que tem `Dermatologista` como nicho prioritário e São Paulo como região atendida.

| Métrica | Valor |
|---|---|
| Score mínimo | 56 |
| Score máximo | 81 |
| **Amplitude** | **25 pontos** |
| Média | 72,3 |
| Valores distintos | **11 para 28 leads** |
| Concentração | **22 de 28 na mesma faixa** (70–84, "Alta") |

---

## O problema

Um vendedor que abre a lista de `SEM_SITE` vê 22 leads rotulados "Alta" com scores entre 71 e 77. **Não há por onde começar.** O score existe para dar ordem de abordagem, e dentro desta faixa ele está quase plano.

## A inversão

O caso mais revelador:

| Lead | Avaliações | Nota | Score |
|---|---:|---:|---:|
| Alergo Dermatologia Integrada | **870** | 4,5 | **68** |
| Dermatologia e Tricologia Dra Natália | **5** | 5,0 | **81** |

Um negócio com **870 avaliações e sem site** fica 13 pontos **abaixo** de um com 5 avaliações.

Isso é uma anomalia comercial de alto valor sendo despriorizada. 870 avaliações significa fluxo real, operação consolidada, faturamento — e nenhum site. Para quem vende presença digital, esse é provavelmente o melhor lead da lista inteira: necessidade evidente, capacidade de pagar comprovada.

---

## A causa

Não é falta de sinal. É que **`review_count` está sendo usado para medir duas coisas que puxam em direções opostas**:

1. **Maturidade digital** — poucas avaliações sugerem presença imatura, alguém que ainda não cuidou do digital. É a leitura que `scoring.md` §3.3 declara, e é defensável.
2. **Porte e atividade do negócio** — muitas avaliações indicam fluxo, operação estabelecida, capacidade de contratar.

Hoje o peso trata as duas como a mesma coisa, com sinal invertido, e a leitura (1) domina. O resultado é que porte alto vira penalidade.

A regra em `scoring.md` §3.3 diz: *"Um negócio com 500 avaliações provavelmente já tem agência."* Isso é razoável **para quem tem site**. Para quem **não tem site**, o inverso é mais provável: 870 avaliações sem site é justamente o negócio que ninguém atendeu ainda.

---

## Hipótese a testar

Separar os dois sinais em vez de sobrepô-los:

- **Volume de avaliações** deixa de ser peso direto e passa a ser **modulador do peso de site**. Sem site + volume alto = oportunidade máxima. Com site próprio + volume alto = provavelmente já atendido.
- **Recência da atividade** — se o scraper trouxer data da última avaliação — mede se o negócio está vivo, que é o que a faixa 1–9 tenta capturar hoje de forma indireta.

Isso é uma hipótese, não uma recomendação. O peso atual foi uma decisão deliberada e documentada; mudá-lo exige validação comercial, não só o argumento acima.

---

## O que isso tem a ver com o Gate 0

O Gate 0 concluiu que o Instagram não é obtenível para leads sem site, e levantou a preocupação de que a distinção "ativo vs. frio" ficaria sem sinal.

**Os dados mostram que o sinal existe e é abundante:**

| Sinal | Cobertura (n=28) |
|---|---|
| `about` preenchido | 28/28 |
| Pelo menos 1 avaliação | 27/28 |
| Telefone | 27/28 |
| Horário cadastrado | 22/28 |
| 10 ou mais avaliações | 19/28 |
| `descriptions` | 0/28 |
| E-mail | 0/28 |

O problema de diferenciação **não é falta de dado — é a curva de pesos.** Contratar fornecedor de dado social para resolver isso seria pagar por informação nova quando a informação existente ainda não está sendo bem usada.

---

## Próximo passo sugerido

Simular variações de peso contra os 111 leads reais e comparar os rankings resultantes. Custa minutos e não toca em código de produção.

O critério de escolha não é estatístico: é qual ordenação você abordaria primeiro se fosse vender para essa lista amanhã. O `scoring.md` §8 já estabelece o precedente certo — um caso real com resultado esperado, virando teste unitário.
