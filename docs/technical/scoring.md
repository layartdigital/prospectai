# Motor de Score de Oportunidade — v1

**Versão do algoritmo:** `score-v1`
**Natureza:** determinístico, versionado e explicável. Nenhuma IA participa do cálculo.

---

## 1. O que o score é e o que não é

O score é uma **priorização comercial**: em que ordem vale a pena abordar os leads de uma lista. Não é previsão de conversão, não é nota de qualidade da empresa e não é julgamento sobre o negócio.

Essa distinção precisa aparecer na interface, num tooltip. Um usuário que interpreta 85 como "85% de chance de fechar" vai perder confiança no produto na primeira semana.

**Regra fundadora:** o score só pontua o que foi efetivamente observado. Sinal não verificado não pontua — nem a favor nem contra.

---

## 2. Estados de sinal

Todo sinal de presença digital tem três estados possíveis, nunca dois.

| Estado | Significado |
|---|---|
| `PRESENTE` | Verificado e existe |
| `AUSENTE` | **Verificado** e não existe |
| `DESCONHECIDO` | Não foi verificado |

`DESCONHECIDO` **nunca pontua**. Nem positivo, nem negativo.

Isso resolve o defeito mais grave observado nos concorrentes: uma clínica com 5,0 estrelas e 69 avaliações recebendo score 0 porque o sistema marcou "Sem Instagram" e "Sem Facebook" sem nunca ter olhado. Falso negativo em massa destrói a credibilidade da lista inteira.

**Na interface:** `DESCONHECIDO` aparece em cinza neutro com rótulo honesto — "Instagram não verificado" — nunca em vermelho ao lado de sinais realmente ausentes.

---

## 3. Pesos

Todos os pesos vivem em `AppSetting`, editáveis por tenant sem deploy. Os valores abaixo são o padrão de fábrica.

### 3.1 Presença de site — o sinal mais forte

Mutuamente exclusivos: apenas um se aplica.

| Condição | Peso | Fonte |
|---|---:|---|
| `SEM_SITE` — campo `website` vazio | **+30** | Direto do scraper |
| `SITE_PRECARIO` — construtor gratuito, encurtador ou rede social usada como site | **+22** | Domínio comparado à lista em `AppSetting` |
| `SITE_PROPRIO` sem HTTPS | **+15** | Prefixo da URL |
| `SITE_PROPRIO` com HTTPS | 0 | — |

**Lista padrão de domínios precários:** `base44.app`, `wixsite.com`, `negocio.site`, `blogspot.com`, `wordpress.com`, `linktr.ee`, `instagram.com`, `facebook.com`, `linkbio.co`, `beacons.ai`, `bio.link`

Um negócio cujo "site" é uma página de construtor gratuito é oportunidade quase tão boa quanto um sem site nenhum. Tratá-lo como "já resolvido" descarta receita real.

### 3.2 Contatabilidade

| Condição | Peso |
|---|---:|
| Telefone presente | +5 |
| WhatsApp `LIKELY` (celular brasileiro) | +5 |
| E-mail presente | +8 |
| E-mail em domínio próprio, não gratuito | +2 adicional |

### 3.3 Sinais de negócio ativo

| Condição | Peso |
|---|---:|
| Entre 1 e 9 avaliações | +10 |
| Entre 10 e 49 avaliações | +6 |
| 50 ou mais avaliações | +2 |
| Nota média ≥ 4,0 | +5 |
| Horário de funcionamento cadastrado | +3 |
| Endereço completo com CEP | +3 |

A lógica da faixa de avaliações é intencionalmente invertida em relação à intuição. Poucas avaliações indica presença digital imatura — que é justamente quem precisa do serviço. Um negócio com 500 avaliações provavelmente já tem agência.

### 3.4 Alinhamento com o tenant

| Condição | Peso |
|---|---:|
| Categoria está nos nichos prioritários do tenant | +15 |
| Cidade está nas regiões atendidas pelo tenant | +5 |

Vem das preferências coletadas no onboarding. É o que torna o score específico de cada cliente em vez de genérico.

### 3.5 Penalidades

| Condição | Peso |
|---|---:|
| Nota média < 3,0 com 10+ avaliações | −10 |
| Dados com mais de 90 dias | −5 |
| Lead contatado nos últimos 30 dias | −15 |
| Está na lista de supressão | **desqualifica** |
| Marcado como permanentemente fechado | **desqualifica** |

"Desqualifica" força score 0 e badge `Desqualificado` — estado distinto de "score baixo". Um lead desqualificado não aparece em listagens de oportunidade nem consome atenção.

---

## 4. Cálculo

```
bruto  = Σ (pesos aplicáveis)
score  = min(100, max(0, bruto))
```

Se qualquer condição de desqualificação for verdadeira, `score = 0` e o lead recebe `disqualified = true`, sem passar pela soma.

### Faixas

| Faixa | Rótulo | Cor |
|---|---|---|
| 0–39 | Baixa | Cinza |
| 40–69 | Média | Âmbar |
| 70–84 | Alta | Azul |
| 85–100 | Muito alta | Azul destacado |

---

## 5. Explicabilidade

**O número sozinho não é gravado.** Cada peso aplicado gera um registro em `LeadScoreReason`:

| Campo | Conteúdo |
|---|---|
| `code` | `NO_WEBSITE`, `POOR_WEBSITE`, `WHATSAPP_LIKELY`, `PRIORITY_NICHE`, … |
| `label` | Texto exibido: "Não possui site próprio" |
| `weight` | O valor aplicado, com sinal |
| `polarity` | `POSITIVE`, `NEGATIVE` ou `DISQUALIFYING` |
| `evidence` | O dado que embasou: `"website: (vazio)"` |

A ficha do lead separa em duas seções — **Pontos positivos** e **Pontos de atenção** — ordenadas por peso absoluto decrescente.

O campo `evidence` é o que permite ao usuário discordar de forma produtiva: ele vê exatamente qual dado gerou a pontuação, e pode corrigir o lead se o dado estiver errado.

---

## 6. Momento do cálculo

O score é calculado no estado `SCORING` do job, depois de normalização, deduplicação e detecção de presença digital.

```
RUNNING → NORMALIZING → SCORING → COMPLETED
```

**Nenhum lead fica visível ao usuário antes de `SCORING` concluir.** Lead sem score na interface é bug, não estado intermediário aceitável.

### Recálculo

Disparado por: ação manual na ficha do lead, mudança nas preferências de nicho ou região do tenant, alteração de pesos em `AppSetting`, ou reprocessamento de dados do lead.

Cada recálculo grava `algorithmVersion` e `calculatedAt`. Histórico anterior é preservado — dá para explicar por que o score de um lead mudou.

---

## 7. Sinais previstos mas não calculáveis na v0.1.1

Estes pesos aparecem no documento mestre e **não entram no `score-v1`**, porque não há como observá-los sem infraestrutura que a v0.1.1 não tem:

| Sinal | Por que não | Quando |
|---|---|---|
| Site não responsivo | Exige buscar e renderizar o site | v0.2, com `WebsiteAuditAgent` |
| Perfil de Instagram ativo | Exige varredura de redes sociais | v0.2 |
| Perfil de Facebook ativo | Idem | v0.2 |
| WhatsApp confirmado | Exige verificação externa | v0.2 |

Enquanto isso, esses sinais ficam `DESCONHECIDO` e não pontuam. **Nenhum deles é tratado como ausente.**

Quando a v0.2 ligar o enriquecimento, o algoritmo vira `score-v2` e os leads existentes são recalculados em lote — com o histórico do `score-v1` preservado.

---

## 8. Exemplo real

Clínica odontológica em São Paulo, dado real vindo do scraper:

```
website:       vianna-smile-studio.base44.app
phone:         (11) 9xxxx-xxxx
review_count:  69
review_rating: 5.0
category:      Dentist
city:          São Paulo
open_hours:    preenchido
postal_code:   01003-000
instagram:     não verificado
```

Tenant com `Dentistas` entre os nichos prioritários e `São Paulo` entre as regiões atendidas.

| Motivo | Peso |
|---|---:|
| Site em construtor gratuito (`base44.app`) | +22 |
| Telefone disponível | +5 |
| WhatsApp provável (celular) | +5 |
| 50+ avaliações | +2 |
| Nota média ≥ 4,0 | +5 |
| Horário cadastrado | +3 |
| Endereço completo com CEP | +3 |
| Nicho prioritário do tenant | +15 |
| Cidade atendida pelo tenant | +5 |
| **Total** | **65 — Média** |

Instagram e Facebook não aparecem na tabela: são `DESCONHECIDO` e não pontuam em nenhuma direção.

O mesmo lead, na análise do concorrente de referência, recebeu **score 0** — porque o site em construtor gratuito foi contado como "tem site" e as redes não verificadas foram contadas como ausentes. Esse lead vale 65 e merece ser trabalhado.

**Esse caso é o teste de aceitação do motor de score.** Ele entra na suíte de testes unitários com o resultado esperado de 65.
