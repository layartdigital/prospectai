# Escopo da v0.2 — Auditoria de Presença Digital

**Projeto:** PropectAI
**Data:** 06 de agosto de 2026
**Status:** aprovado nas duas decisões estruturais; detalhamento aberto a revisão

---

## 1. A decisão

O `scope-v0.1.1.md` §9 deixou uma pergunta registrada como aberta:

> Removido o Construtor de Sites, os planos passam a se diferenciar **apenas por volume de lead**. Volume de lead é commodity — Apify e Outscraper vendem mais barato. A tabela de preços fica sem um segundo eixo de valor.

A resposta é a **auditoria de presença digital com relatório exportável**.

Por que essa e não créditos de IA: a auditoria transforma um custo técnico que o produto já é obrigado a pagar em produto vendável. A regra 5.2 exige verificação real antes de marcar qualquer sinal como `AUSENTE` — ou seja, o enriquecimento vai ter que existir de qualquer jeito. A escolha é entre pagar esse custo em silêncio ou embrulhá-lo como entrega.

Créditos de IA continuam sendo eixo possível, mas são commodity também: qualquer concorrente liga uma API de modelo. A auditoria depende de um pipeline de verificação que precisa ser construído, e o resultado é defensável — evidência datada, não opinião gerada.

### Duas decisões tomadas em 06/08/2026

| Decisão | Escolha | Consequência |
|---|---|---|
| **Destinatário do relatório** | **Peça de venda.** A agência entrega ao prospect | Exige capricho visual, marca da agência e linguagem para leigo. Não é dashboard interno com termo técnico |
| **Momento da verificação** | **Sob demanda, por lead** | Custo controlado, resultado fresco, consumo vira métrica de plano naturalmente. Nada é verificado em lote na coleta |

---

## 2. O produto, em uma frase

A agência abre um lead, clica em **Auditar presença digital**, o sistema verifica o que é verificável, e devolve um relatório em PDF com a marca da agência — que ela envia ao prospect como abertura de conversa.

O argumento comercial que isso cria: em vez de *"olá, faço sites"*, a agência chega com *"analisei a presença digital da sua empresa, aqui estão sete pontos objetivos com data de verificação"*.

---

## 3. O que a auditoria verifica

**Princípio inegociável, herdado da regra 5.2:** nada é marcado como ausente sem verificação que efetivamente aconteceu. `DESCONHECIDO` é resposta legítima e aparece como tal no relatório. Um relatório que afirma "esta empresa não tem Instagram" sem ter olhado é pior que relatório nenhum — destrói a credibilidade da agência na frente do cliente dela.

### 3.1 Site — medições objetivas

Cada uma é fato verificável, com carimbo de data e hora:

| Verificação | Como | Por que importa ao prospect |
|---|---|---|
| DNS resolve | Consulta ao domínio | Domínio expirado é loja fechada |
| Responde HTTP | GET na home, com timeout | Site fora do ar não vende |
| HTTPS com certificado válido | Cadeia e validade | Navegador exibindo "não seguro" afasta cliente |
| Cadeia de redirecionamento | Contagem e destino final | Redirect para domínio alheio costuma ser domínio vendido |
| Meta viewport presente | Parse do HTML | Sem ela, o site não é utilizável no celular — onde está a maioria do tráfego local |
| Tempo até o primeiro byte | Medição direta | Lentidão é abandono |
| Título e descrição | Parse do HTML | Ausência prejudica busca |
| Página de construtor gratuito | Domínio na lista de `AppSetting` | Já existe na v0.1.1 como `SITE_PRECARIO` |

### 3.2 Redes sociais — sem adivinhação

O scraper não devolve Instagram nem Facebook, e a v0.1.1 marca ambos como `DESCONHECIDO` por isso.

**A auditoria resolve isso pelo caminho honesto: lê os links do próprio site.** Rodapé e cabeçalho de site de negócio local quase sempre apontam para as redes. Encontrou link, é `PRESENTE` com evidência — a URL e a página onde estava. Não encontrou, continua `DESCONHECIDO`, nunca `AUSENTE`, porque não achar link no site não prova que a conta não existe.

Buscar perfil por nome em mecanismo de busca fica **fora de escopo**: produz falso positivo com homônimo, e um relatório que atribui o Instagram errado a uma empresa é constrangimento na frente do cliente.

### 3.3 Google — o que já se tem

Contagem e média de avaliações vêm do scraper e entram no relatório sem verificação adicional. Nenhum dado de avaliador individual é usado, conforme a regra 6.

### 3.4 Classificação derivada

As nove categorias do documento mestre, ancoradas nas medições acima em vez de julgamento:

```text
SEM_SITE            campo vazio na origem
DOMINIO_INATIVO     DNS não resolve
SITE_FORA_DO_AR     DNS resolve, HTTP falha ou 5xx
SITE_QUEBRADO       responde, mas 4xx na home
APENAS_REDE_SOCIAL  o "site" é perfil de rede social
APENAS_MARKETPLACE  o "site" é iFood, Mercado Livre e afins
SITE_PRECARIO       construtor gratuito, encurtador ou agregador
SITE_LIMITADO       responde, mas falha em HTTPS, viewport ou desempenho
SITE_PROPRIO        domínio próprio, responde, HTTPS, mobile, sem alerta
DESCONHECIDO        não verificado ainda
```

`SITE_LIMITADO` substitui o `OUTDATED_WEBSITE` do documento mestre de propósito: "desatualizado" é juízo estético e indefensável num relatório entregue ao dono do site. "Sem HTTPS, sem viewport móvel, 4,2s até o primeiro byte" é fato, e o dono pode conferir.

---

## 4. O relatório

Peça de venda, não dump de dados.

- **Marca da agência** — logo e cores, configuráveis em Configurações
- **Linguagem para leigo** — "seu site não abre no celular", não "meta viewport ausente". O dado técnico fica em nota de rodapé
- **Evidência e data em cada afirmação** — o prospect precisa poder conferir
- **Sem número inventado.** Nenhuma projeção de "você está perdendo R$ X por mês". É a tentação óbvia e é onde a credibilidade morre
- **O que está bom também aparece.** Relatório que só lista defeito parece peça de venda; relatório que reconhece acertos parece diagnóstico — e vende mais
- **Formato:** PDF para envio, e link público com validade para quem prefere mandar URL

---

## 5. Modelo de dados

Aproveita o que existe. `DigitalPresence` já está no schema desde a primeira migration.

| Entidade | Papel |
|---|---|
| `DigitalPresenceAudit` | Uma execução: lead, quem pediu, quando, duração, versão do verificador |
| `DigitalPresenceCheck` | Uma medição: tipo, resultado, evidência, confiança |
| `AuditReport` | O artefato: PDF gerado, token do link público, validade |

`auditVersion` em cada execução, pelo mesmo motivo que o score tem `algorithmVersion`: quando o verificador mudar, relatórios antigos continuam explicáveis.

---

## 6. Planos

O segundo eixo. Valores a definir com o comercial; a estrutura é esta:

| Plano | Auditorias/mês |
|---|---:|
| FREE | 3 — o suficiente para ver o valor |
| START | 30 |
| PRO | 150 |
| AGENCY | 600 |

Nova capacidade em `EntitlementsService`: `audit.run` e `audit.export`. Contagem em `PlanUsage`, ao lado de `aiGenerationsCount`.

O gate age na tentativa, nunca no carregamento — como o fluxo 4 do E2E já prova para os demais.

---

## 7. Fora de escopo

| Item | Motivo |
|---|---|
| Verificação em lote na coleta | Decidido em 06/08: multiplica custo e risco de bloqueio |
| Busca de perfil social por nome | Falso positivo com homônimo. Atribuir Instagram errado é pior que não informar |
| Análise de conteúdo do site por IA | Opinião gerada não é evidência. O relatório vive de ser conferível |
| Monitoramento contínuo | v0.3, se houver demanda |
| Estimativa de perda financeira | Número inventado com aparência de dado |

---

## 8. Riscos

**Requisição a site de terceiro.** GET na home pública é prática corrente, mas exige `User-Agent` identificável, timeout curto, no máximo uma tentativa por domínio por período, e respeito a `robots.txt`. Auditoria não é varredura.

**O relatório afirma coisas sobre o negócio de outra pessoa.** Toda afirmação precisa de evidência e data. "Seu site estava fora do ar em 06/08 às 14h32" é defensável; "seu site é ruim" não é.

**Custo de latência.** Verificação sob demanda leva segundos. A interface precisa mostrar progresso por etapa, não uma barra genérica.

---

## 9. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **1** | Verificador de site — DNS, HTTP, HTTPS, redirect, viewport, TTFB, meta | Um lead auditado produz medições persistidas com evidência e data |
| **2** | Classificação nas nove categorias + integração ao score | Categoria substitui os três estados atuais sem quebrar o score existente |
| **3** | Links sociais lidos do próprio site | `PRESENTE` só com URL como evidência; o resto continua `DESCONHECIDO` |
| **4** | Relatório PDF com marca da agência | Uma agência gera e envia; nenhum número inventado |
| **5** | Link público com validade, planos e gate | Consumo contado, gate agindo na tentativa |

A Fase 1 sozinha já melhora o score da v0.1.1 — o que dá valor antes de o relatório existir.

---

## 10. Pergunta que fica aberta

**Quanto custa a auditoria avulsa?** O eixo por plano resolve o cliente recorrente. Mas a agência que quer auditar cinquenta prospects de uma campanha específica não vai trocar de plano por isso.

Pacote avulso é a resposta óbvia, e a decisão de preço precisa vir antes da Fase 5 — não depois, porque muda se a contagem é mensal ou acumulável.
