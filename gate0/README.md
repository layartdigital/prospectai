# GATE 0 — A ponte CNPJ → domínio

**O teste que decide se o ProspectAI Intelligence pode existir.**
Custa uma tarde. Roda antes de qualquer linha de código de produto.

---

## Por que este teste vem antes de tudo

A pesquisa de mercado (`docs/market/`) descartou, uma a uma, as camadas que pareciam diferencial:

- **cadastro de CNPJ** → commodity, base pública, piso R$ 0,00
- **detecção de tecnologia de site** → commodity global (Wappalyzer, BuiltWith vendem isso com filtro de país)
- **sinal de anúncios** → sem fonte legítima no Brasil (Meta Ad Library API não cobre anúncio comercial fora da UE)
- **rastreabilidade** → a CNPJá já faz na camada cadastral, por R$ 39,99/mês

**O que sobrou:** ninguém liga o cadastro brasileiro ao site da empresa. Econodata e Speedio têm o CNPJ e não olham o site. Wappalyzer e BuiltWith olham o site e não sabem o CNPJ.

Essa ponte é o único ativo acumulável identificado — cada mapeamento verificado fica, e não é copiável olhando a tela.

**Mas ela só é um ativo se funcionar.** Este teste mede se funciona.

---

## O que está sendo medido

Duas coisas, e a segunda importa mais:

**1. Cobertura** — de quantos CNPJs se consegue chegar ao domínio.

**2. Erro silencioso** — com que frequência se chega a um domínio **plausível e errado**.

O erro silencioso é o que mata o produto. Um CNPJ sem domínio é um lead a menos. Um CNPJ com o domínio errado gera um diagnóstico confiante sobre a empresa errada — entregue a um cliente que vai ligar para o prospect citando fatos que não são dele.

Para um produto cuja promessa é "e aqui está a prova", isso não é um bug. É o fim da credibilidade.

---

## Critério de aprovação — declare antes de rodar

Escrito antes do teste, não depois de ver o resultado:

| Métrica | Limiar | Se falhar |
|---|---|---|
| **Cobertura** (CONFIRMADO + CANDIDATO correto) | **≥ 60%** | O produto cobre pouco da base para justificar preço |
| **Erro silencioso** (CANDIDATO errado ÷ total resolvido) | **≤ 5%** | **O produto não pode existir nesta forma** |

Reprovar aqui é o melhor resultado possível: custou uma tarde em vez de seis fases de implementação.

---

## Como as estratégias funcionam

### Resolução

**1. `EMAIL_RFB` — o método mais forte e o menos óbvio.**
O cadastro da Receita traz o e-mail da empresa. Se for corporativo (`contato@empresa.com.br` e não `@gmail.com`), **o domínio está ali, de graça, num campo oficial**. O script filtra ~22 provedores gratuitos conhecidos.

**2. `NOME_HEURISTICA` — o método fraco.**
Normaliza razão social e nome fantasia, remove termos societários (LTDA, ME, EIRELI, COMERCIO, SERVICOS), e testa candidatos em `.com.br` e `.com`.

É aqui que mora o erro silencioso: `acai.com.br` existe, responde, e quase certamente não é da "AÇAÍ DO NORTE COMERCIO LTDA" de Belém.

**3. `BUSCA` — não implementada.**
Exigiria API de busca paga. Deixada de fora de propósito: se o teste passar sem ela, o custo do produto cai. Se falhar só por falta dela, isso é informação — significa custo recorrente por lead desde o dia 1.

### Verificação

**`CNPJ_NO_SITE`** — o script baixa a página do candidato e procura os 14 dígitos do CNPJ no HTML, ignorando pontuação.

Muitos sites brasileiros trazem o CNPJ no rodapé. Quando aparece, **o mapeamento está provado sem opinião humana**. É a diferença entre medir e achar.

---

## Como rodar

### 1. Monte a amostra

Você precisa de **200 CNPJs de um segmento-alvo real** — não de empresas conhecidas, não de uma amostra aleatória do Brasil inteiro. O segmento é o que você venderia hoje.

Fontes possíveis:

- export de qualquer ferramenta que você já use, filtrado por CNAE + UF
- os dados abertos da Receita, filtrados por CNAE (`arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj`)
- o plano gratuito de Econodata (25/mês), CNPJá (50 créditos) ou Data Stone (25) — ironia útil: use o concorrente para testar se você tem produto

Um CNPJ por linha, em `cnpjs.txt`. Pontuação é ignorada.

> **Importante:** amostra enviesada invalida o teste. Não escolha empresas que você sabe que têm site. O ponto é descobrir a taxa real do segmento, incluindo as que não têm.

### 2. Rode

```bash
pip install requests
python3 resolve_domains.py cnpjs.txt --out resultado.csv
```

A API pública tem rate limit de 5 req/min, então 200 CNPJs levam ~45 min. O script cacheia em `.gate0_cache/`, então reexecuções são instantâneas.

Para um teste rápido antes de comprometer a tarde:

```bash
python3 resolve_domains.py cnpjs.txt --limit 20
```

### 3. Verifique à mão — este é o passo que não dá para pular

O script produz cobertura sozinho. **Ele não produz o número que decide.**

Abra o CSV, filtre `veredito = CANDIDATO` e preencha a coluna `verificacao_humana`:

- **`OK`** — abri o site, é mesmo a empresa
- **`ERRADO`** — abri o site, é outra empresa
- **`NAO_SEI`** — não deu para dizer

Leva ~30 segundos por linha. Se houver mais de 60 candidatos, verifique 60 ao acaso — mas **ao acaso de verdade**, não os que parecem certos.

Os `CONFIRMADO` não precisam de verificação: o CNPJ está no site.

---

## Como interpretar

```
cobertura   = (CONFIRMADO + CANDIDATO_OK) / total
erro_silencioso = CANDIDATO_ERRADO / (CONFIRMADO + CANDIDATO)
```

### Cobertura ≥ 60% e erro ≤ 5%

**Siga para o Gate 1** (`docs/market/POSITIONING.md` §8): venda três diagnósticos manuais, com pagamento. A ponte funciona; falta saber se alguém paga.

### Cobertura < 60%, erro ≤ 5%

O produto é honesto mas cobre pouco. Antes de descartar, teste se a cobertura é melhor em segmentos com mais presença digital — e-commerce, tecnologia, serviços B2B. **Se a cobertura só funcionar em nichos pequenos, o mercado endereçável é o nicho, e o preço tem que refletir isso.**

### Erro silencioso > 5%

**Pare.** O produto não pode existir nesta forma. Opções, em ordem de honestidade:

1. **Entregar só os `CONFIRMADO`.** Cobertura despenca, credibilidade fica intacta. É a opção certa.
2. Adicionar verificação humana na faixa intermediária — mas isso é custo por lead, e você é uma pessoa.
3. Mudar a entrada: o cliente traz os domínios que já tem, e você entrega o diagnóstico. Mata a ponte como diferencial, mas o produto continua existindo — menor.

### Alta taxa de `NAO_RESOLVIDO` com poucos e-mails corporativos

Sinal de que o segmento é cauda longa demais — MEIs e microempresas sem presença digital. Não é falha do método, é falha da amostra em representar um mercado que vale dinheiro. Refaça com um segmento mais acima.

---

## O que este teste não mede

Seja honesto sobre o escopo:

- **não mede se alguém paga** — isso é o Gate 1
- **não mede se o diagnóstico é útil** — só se o alvo está certo
- **não mede custo em escala** — 200 CNPJs não revelam o custo de 200.000
- **não mede o efeito do tempo** — domínios trocam de dono, empresas fecham

E uma ressalva sobre o próprio instrumento: a busca por CNPJ no HTML só pega a **página inicial**. Sites que põem o CNPJ apenas em `/contato` ou `/politica-de-privacidade` vão aparecer como `CANDIDATO` mesmo estando certos. Isso **subestima** os confirmados e infla a fila de verificação manual — erra para o lado conservador, que é o lado certo para um instrumento de decisão.

---

## Depois de rodar

Registre o resultado em `docs/market/GATE-0-RESULTADO.md` com: data, segmento, tamanho da amostra, as duas taxas, e a decisão tomada.

Se reprovar, esse arquivo é o documento mais valioso do programa — ele economizou meses.
