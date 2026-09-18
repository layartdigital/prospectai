# GATE 1 — o que falta para vender três diagnósticos com pagamento

**Data:** 16/09/2026 · *revisto no mesmo dia, depois da leitura dos três arquivos que a §5 pedia — ver §6* · **§3.1 reescrita e §7 acrescentada em 17/09/2026**
**Origem:** `PROMPT-01-EXECUTION-REPORT.md` §5 — *"O Gate 1 — vender três diagnósticos com pagamento — desapareceu do roadmap. É o mesmo defeito que a pesquisa de mercado deste programa diagnosticou e mandou corrigir."*
**Tipo:** medição. **Não decide prioridade nem preço.**

---

## 1. A conclusão, antes do detalhe

> **A API sabe cobrar. A interface não sabe pedir.**

Três endpoints de pagamento existem e funcionam; **zero telas os chamam**. `medido`:

```powershell
Get-ChildItem -Recurse apps\web\src -Include *.tsx,*.ts |
  Select-String -Pattern "billing/checkout|billing/portal"
# → vazio
```

O que se supunha ser uma lacuna de fundação é uma lacuna de superfície — e ela está encostada numa dependência que vinha sendo tratada como corretamente adiada.

> **Emenda de 17/09/2026, ao fim do dia — e é a mais importante deste documento.**
>
> A frase acima continua exata e continua pequena demais. A interface não saber pedir é o quarto elo de uma corrente de quatro, e os três primeiros não são código. **O produto não tem nenhuma porta pela qual um cliente entre** — nem pagamento, nem contato, nem endereço. A §7 mede a corrente inteira e registra a consequência que ela tem sobre o próprio enunciado do Gate 1.

---

## 2. O que já existe, e é mais do que a documentação sugere

### Modelo de dados — completo

| Modelo | O que já tem |
|---|---|
| `Plan` | `stripePriceId`, `stripeProductId`, `pricesByCurrency`, `limits`, `features` |
| `Subscription` | `stripeSubscriptionId`, `status`, `currentPeriodEnd`, `trialEndsAt`, `cancelAtPeriodEnd` |
| `Invoice` | `hostedInvoiceUrl`, `pdfUrl`, valores, `@@unique([provider, externalId])` |
| `BillingEvent` | `@@unique([provider, externalId])`, `processedAt`, `attempts`, `error` |

O `BillingEvent` com chave única por evento externo é idempotência de webhook resolvida — a parte que costuma dar trabalho e que, malfeita, cobra duas vezes.

### Superfície da API — existe

```
POST /billing/checkout
POST /billing/portal
POST /billing/webhook   @Public — "a autenticação aqui é a assinatura criptográfica"
```

Com `stripe.provider.ts`, `mock-payment.provider.ts` e uma `payment-provider.factory.ts`. O mock permite exercitar o fluxo sem tocar a Stripe, que é o mesmo padrão do `LeadSourceProvider` e do `SiteAuditProvider`.

### Direito de uso — a auditoria já é um recurso cobrável

`EntitlementsService` conhece **`audit.run`** e **`audit.export`** entre suas capacidades, e a cota sai do plano:

```ts
return Math.max(0, included - usage.auditsCount);
```

> Isto também fecha o último item que a `REAVALIACAO-GATE-01.md` §4 deixou como `NÃO VERIFICADO`. `audit.export` existe.

### Preços — decididos

`medido`, em `prisma/seed.ts`:

| Código | Nome | Preço |
|---|---|---|
| `FREE` | Explorar | R$ 0 |
| `START` | Base | R$ 27 |
| `PRO` | Impulso | R$ 47 |
| `AGENCY` | Escala | R$ 97 |

O `stripePriceId` é deixado de fora do `update` do seed **de propósito** — é valor por ambiente, não por código.

### O produto a vender — entregue

A auditoria de presença digital tem verificação nativa, nove categorias, evidência e data por medição, cota, exportação em CSV, prazo de retenção visível, aviso quinze dias antes e expurgo que só apaga o que foi avisado. As quatro peças da D6 fecharam entre 08 e 09/09.

---

## 3. O que falta, em ordem de dependência

### 3.1 ~~O deploy~~ **O nome de domínio**

> **Reescrita em 17/09/2026, depois de medir o servidor.** Esta seção dizia que a D5 *"deixou de estar corretamente adiada"* e que era *"o gargalo do Gate 1"*, por **ausência de produção**. Errado em três camadas, e cada uma só apareceu quando eu parei de ler documento e fui olhar a máquina. O texto original está preservado ao final da seção.

O que a medição encontrou em `108.174.144.216`:

| | |
|---|---|
| Máquina | existe — Ubuntu 24.04.4 |
| Deploy do PropectAI | **existe** — sete containers no ar desde 05–11/08/2026 |
| Aplicação | **viva** — `/api/v1/health` responde `database ok, redis ok, scraper ok` |
| nginx com TLS no host | existe, escutando em `0.0.0.0:443` |
| vhost `app.prospectai.com.br` | existe, com `proxy_pass` para o gateway |
| **DNS para esse nome** | **não existe** |

Não faltava produção. Faltava — e falta — **um nome**.

A cadeia toda está montada e termina no vazio: o vhost aponta para o gateway, o gateway para a aplicação, a aplicação responde. Mas `app.prospectai.com.br` não resolve para lugar nenhum, o certificado em `ssl-certificates/` é o autoassinado que o CloudPanel gera ao criar o site, e o acesso real acontece por `http://108.174.144.216:3102` — que entra pelo gateway publicado e passa **por fora** do nginx do host.

**Por que isso trava o Gate 1, e não é detalhe de infraestrutura:**

A Stripe não entrega webhook em endereço IP e não aceita certificado autoassinado, então o `POST /billing/webhook` continua sem endereço alcançável. Mas o problema maior é anterior ao webhook: **ninguém paga numa página em `http://108.174.144.216:3102`**. Sem nome e sem cadeado, o cliente desiste antes do checkout. O Gate 1 é vender, e a venda morre na barra de endereço.

**O tamanho disso:** um registro no registro.br, um apontamento A para o IP, e a emissão do certificado pelo CloudPanel. O vhost já está escrito esperando o nome.

O segundo item, separado do primeiro: o que está no ar é de agosto, e **não tem nada** do que foi feito desde então — RLS, os três papéis, a D6, o `SignalState`, a correção do retorno do checkout, o FREE com uma auditoria. A sequência de atualização está medida e escrita em `ATUALIZAR-AMBIENTE-ONLINE.md`, com um risco em destaque: aplicar as migrations sem acrescentar `DATABASE_URL_APP` instala 34 políticas e deixa a aplicação contornando todas elas, em silêncio.

<details>
<summary>O texto original desta seção, de 16/09/2026</summary>

> A D5 vem sendo classificada como *"bloqueada por ausência de produção, e isso está correto"*. **Não está mais.**
>
> O checkout da Stripe não termina no navegador: ela confirma o pagamento chamando **de volta** um endereço público. Sem um ambiente publicado, o `POST /billing/webhook` não tem endereço, e sem ele nenhuma assinatura muda de estado — o cliente paga e o sistema não fica sabendo.
>
> **A D5 não é mais uma dependência adiada. É o gargalo do Gate 1.**
>
> O caminho está escrito e ensaiado: `PRIMEIRO-DEPLOY-CREDENCIAIS.md` tem seis passos em ordem obrigatória, e o CI executa a mesma sequência a cada push — criar banco e dono, migrations, senha aos três papéis, quatro variáveis, semear, verificar.

A última frase é a que mais enganou, e é minha: o `PRIMEIRO-DEPLOY-CREDENCIAIS.md` abre declarando **"Escopo: só o banco (…) não é um checklist de deploy completo — não fala de DNS, TLS, orquestração"**. Eu li o sumário dos seis passos e relatei como se fosse o caminho inteiro, contra o aviso escrito na primeira linha do documento.

</details>

### 3.2 A conta na Stripe e os `stripePriceId`

Quatro produtos e quatro preços na Stripe, e o `stripePriceId` de cada um gravado no `Plan` do ambiente. O schema já tem a coluna e o seed já a preserva.

### 3.3 A tela — ~~escrever~~ **ligar**

> **Esta seção foi reescrita pela §6.** A redação original dizia "um caminho que leve o usuário ao `POST /billing/checkout`, e as duas páginas de retorno". Estava errada por excesso: a tela existe.

`/subscription` já mostra os quatro planos, o plano atual destacado, o consumo do período em barras e a lista de recursos por plano. O que falta são **três ligações curtas**:

1. O `onClick` do botão. Ele hoje é um `<button type="button">` sem manipulador nenhum, rotulado *"Falar sobre este plano"*.
2. As duas rotas de retorno, que **não existem** — ver 3.4, que é defeito e não falta.
3. O caminho para o `POST /billing/portal` de quem já assina.

**A regra 7 do projeto proíbe que isso seja mock**, então a ligação nasce no endpoint real ou não nasce.

O rodapé da tela é honesto sobre o estado — *"A contratação ainda não é automática nesta versão"* — mas a frase seguinte envelheceu: *"o provedor de pagamento é uma abstração no código e nenhuma integração financeira foi ativada"*. A primeira metade subestima o que existe: o `stripe.provider.ts` está implementado inteiro. A segunda continua verdadeira, e é sobre chave, não sobre código.

> **Atualização de 17/09/2026 — metade feita, metade recusada de propósito.**
>
> **Feito (`a646470`):** a tela passou a dizer **quantos diagnósticos cada plano inclui**. Nenhum dos quatro cards dizia, e isso era pior que uma omissão: dois dias antes o FREE havia caído de três auditorias para uma, justamente para pôr o alvo do Gate 1 atrás do pagamento, e a mudança existia só no banco. Limite que o produto aplica e a vitrine não conta vira restrição sentida como defeito, em vez de razão para assinar. Tem guarda no `fluxo-4-planos-e-gates.spec.ts`, falsificado antes do commit.
>
> **Recusado: o `onClick`.** A ligação foi projetada — botão que muda de papel conforme o provedor ativo consiga ou não cobrar, com o rodapé saindo do mesmo campo em vez de ser texto fixo — e **não foi construída**. A razão está na §7: o botão precisaria levar a algum lugar, e não existe lugar nenhum. Um `Falar sobre este plano` que abrisse um `mailto:` não lido ou um WhatsApp inexistente seria pior que o botão inerte de hoje — o inerte não promete atendimento.
>
> O que a mudança de hoje deixou no lugar do código foi um comentário, no `page.tsx`, exatamente onde quem for ligar o Stripe vai ler: **o rodapé está certo por configuração, não por ausência de código.** `PAYMENT_PROVIDER` tem padrão `mock`; no minuto em que alguém escrever `stripe` ali, a tela passa a mentir e nada avisa.

### 3.4 O retorno do pagamento cai em 404 — e isso é defeito, não lacuna

> **Corrigido em 16/09/2026**, no mesmo dia em que foi encontrado. As três URLs viraram a constante `TELA_DA_ASSINATURA` no `billing.service.ts`, e o teste `o retorno do pagamento › aponta para rotas que o front realmente publica` passou a ler o roteador do `apps/web` e conferir. O relato abaixo fica como estava: é o registro de um defeito que existiu, e de como ele conseguiu existir.

`medido`. O `billing.service.ts` manda o cliente de volta para:

```ts
successUrl: this.url('/settings/subscription?checkout=ok'),
cancelUrl:  this.url('/settings/subscription?checkout=cancelado'),
returnUrl:  this.url('/settings/subscription'),        // portal
```

A rota do Next é `apps/web/src/app/(app)/subscription/page.tsx` → **`/subscription`**. Não há `settings/subscription` na árvore de rotas, e o `next.config.mjs` não tem `redirects` nem `rewrites` — são doze linhas, sem nenhum dos dois.

**O cliente pagaria e cairia num 404.** Três linhas erradas, e nenhuma delas pode falhar hoje: nada chama o checkout, então nada exercita o retorno. É o tipo de defeito que só aparece no dia em que o dinheiro entra.

Corrigir é trocar `/settings/subscription` por `/subscription` nas três — ou criar a rota no endereço que o serviço já anuncia. A segunda opção tem a vantagem de agrupar assinatura com o resto de `settings`, mas move uma tela que o e2e e o menu já alcançam; a primeira é uma linha de diff e nenhuma mudança de navegação.

> **Como isso passou despercebido até aqui:** `apps/web/e2e/fluxo-4-planos-e-gates.spec.ts` cobre planos e *gates* — o que o plano libera e o que ele bloqueia, em quatro planos. Não cobre **compra**, porque não há compra. O plano é trocado por `pnpm db:plan <plano> --reset`, linha de comando. A cobertura ponta a ponta existe e é boa; ela simplesmente termina antes do ponto onde este defeito mora.

---

## 4. O que é decisão, e não é minha

- **Se o Gate 1 é a próxima prioridade.** O relatório de 22/08 diz que ele sumiu do roadmap e trata isso como defeito. Este documento confirma que o custo de trazê-lo de volta é baixo. Priorizar continua sendo decisão de produto.
- **Se vende por assinatura ou por diagnóstico avulso.** Os quatro planos existem; "três diagnósticos com pagamento" pode ser assinatura do plano Base ou venda unitária, e o modelo hoje suporta a primeira.
- **Onde hospedar.** O `PRIMEIRO-DEPLOY-CREDENCIAIS.md` §1 abre com *"uma exigência que elimina opções"* — e é ali que essa conversa começa.
- **Acrescentado em 17/09/2026 — e passou a ser a primeira da lista: o nome do projeto.** Ele pode mudar, e enquanto não mudar ou for confirmado, o domínio não se registra e a conta de pagamento não se abre. Ver §7.
- **Acrescentado em 17/09/2026: se o Gate 1 será fechado por checkout ou à mão.** As duas satisfazem o enunciado; provam coisas diferentes e custam ordens de grandeza diferentes. Ver §7.2.

---

## 5. Limite da primeira medição — e por que ele foi fechado no mesmo dia

A primeira versão deste documento mediu a **superfície**: existência de modelos, rotas, capacidades, planos e chamadas do front-end. Declarou o próprio limite — *"não foi lido o corpo do `billing.service.ts`, do `stripe.provider.ts` nem do e2e de planos"* — e disse que lê-los era o passo barato que podia encurtar a lista.

Foram lidos. A §6 é o resultado, e ele justifica o passo: **o limite declarado escondia um defeito e uma seção errada.**

---

## 6. O que a leitura dos três acrescentou

### 6.1 O corpo está completo — nenhum `TODO`, nenhum atalho

`billing.service.ts` (21.699 bytes) e `stripe.provider.ts` (13.508 bytes) não têm lacuna de implementação. O que têm é decisão difícil já tomada e documentada:

| Decisão | Onde | Por quê importa |
|---|---|---|
| Grava o evento **antes** de processar | `receberWebhook` | processar primeiro perderia exatamente os eventos que falharam |
| Relê a assinatura no provedor em vez de confiar no payload | `processar` | o Stripe não garante ordem; um `updated` atrasado reativaria quem cancelou |
| `PAST_DUE` **não** suspende | `ajustarAcesso` | é o provedor ainda tentando cobrar; suspender aí perde cliente por cartão vencido |
| Só desfaz a suspensão que a própria cobrança criou | `MOTIVO_INADIMPLENCIA` | um pagamento não revoga suspensão por abuso |
| Preço desconhecido **não** rebaixa o plano | `aplicarAssinatura` | o cliente não perde o recurso que acabou de comprar |
| `incomplete_expired` → `CANCELED` | `traduzirStatus` | senão fica uma assinatura fantasma "em processamento" para sempre |
| Lê período no item **e** na assinatura | `periodo()` | o Stripe moveu o campo na versão Basil; ler só o antigo daria `currentPeriodEnd` nulo em silêncio |
| `amount_due` e não `total` | `traduzirFatura` | registrar o total mostraria dívida já quitada por crédito |

Há também a nota no topo da classe sobre **descobrir fora, escrever dentro** — o webhook é o único caminho em que o `tenantId` é o *resultado* da consulta, não a entrada dela — e o registro de que uma política de RLS em `tenants` derrubaria todo webhook do produto. Isso está escrito lá desde antes desta medição.

### 6.2 O que isso muda na lista da §3

A lacuna **encolheu de três itens para dois e meio**, e ganhou um defeito:

| Item | Antes desta leitura | Depois |
|---|---|---|
| Deploy (3.1) | gargalo | **gargalo, sem mudança** |
| `stripePriceId` (3.2) | falta | falta — e é só configuração |
| A tela (3.3) | "escrever a tela e duas páginas de retorno" | **a tela existe; falta o `onClick`** |
| Retorno do checkout (3.4) | *não existia nesta lista* | **defeito: aponta para rota inexistente** |

### 6.3 A frase da §1 sobrevive, com uma emenda

> A API sabe cobrar. A interface não sabe pedir.

Continua exata — e agora com nome próprio: a interface sabe **mostrar** (quatro planos, preço, recursos, plano atual, consumo). O que ela não sabe é **pedir**. A distância entre mostrar e pedir, medida, é um manipulador de clique e três linhas de URL.

---

## 7. A corrente — por que o Gate 1 não anda

Escrita em 17/09/2026, depois de perguntar ao dono do projeto por qual canal um cliente falaria com ele hoje. A resposta foi: **"nenhum existe de verdade hoje... tudo é protótipo/rascunho."**

Essa frase reorganiza o documento inteiro. As seções 3.1 a 3.4 tratam cada ausência como um item de lista, e elas não são uma lista: **são uma corrente, e três dos quatro elos não são código.**

| # | Elo | Estado | Depende de | Custo |
|---|---|---|---|---|
| 1 | **O nome do projeto** | **não decidido** — pode mudar, por causa das funcionalidades novas em estudo | nada. É decisão | uma decisão |
| 2 | **O domínio** | ausente. O vhost `app.prospectai.com.br` existe e o nome não resolve | elo 1 — registrar um domínio que o projeto vai abandonar é jogar fora | registro + apontamento A + certificado |
| 3 | **A conta de pagamento** | ausente. `PAYMENT_PROVIDER=mock`; sem `STRIPE_SECRET_KEY` | elo 2 — a Stripe não entrega webhook em IP nem aceita certificado autoassinado | cadastro + 4 produtos + 4 preços + `stripePriceId` no `Plan` |
| 4 | **Um canal de contato** | **ausente** — nem e-mail monitorado, nem WhatsApp, nem tela de contato | do elo 1 se for `@dominio`; **de nada**, se for um endereço que já exista | minutos |

**A ordem importa mais que os custos.** Cada elo espera o anterior, e o primeiro é uma decisão de produto que ainda não foi tomada. É por isso que o Gate 1 não se move, e a explicação não é de engenharia: **a lacuna que este documento vinha medindo em código estava sempre abaixo do elo que trava tudo.**

### 7.1 O que isso diz sobre construir mais tela

A ligação do botão foi projetada e recusada hoje (§3.3), e a regra que isso estabelece vale para o que vier: **nenhuma tela deste fluxo deve prometer o que o mundo não cumpre.** Um botão que abre um canal inexistente não é um esboço — é uma afirmação falsa, entregue ao cliente, no momento em que ele decidiu confiar.

A proteção que *estaria* certa em outro contexto — um campo no `SubscriptionResponse` dizendo se o ambiente consegue cobrar, para o rodapé e o botão saírem da mesma fonte — **também foi recusada, e por um motivo que é a mesma doença do outro lado**: ela protege contra uma mentira que só pode acontecer quando alguém ligar `PAYMENT_PROVIDER=stripe`, o que exige o elo 3, que exige o 2, que exige o 1. Guarda para cenário que ainda não consegue ocorrer é construção adiantada — precisamente o que o `ADR-004` recusou quando escreveu *"produção não existe — e é por isso que este ADR não bloqueia F0"*.

### 7.2 O enunciado do Gate 1 não pede checkout

E aqui está o achado que muda o problema, em vez de medi-lo melhor.

O Gate 1 está escrito, no `PROMPT-01-EXECUTION-REPORT.md` §5, como:

> **"vender três diagnósticos com pagamento"**

**Não diz por checkout automático.** Um cliente real, uma auditoria rodada à mão, um PIX e a nota satisfazem a frase inteira — e não dependem de nenhum dos quatro elos.

A diferença entre os dois caminhos não é de rigor. É de qual pergunta fica respondida:

| Caminho | O que prova | O que custa |
|---|---|---|
| Checkout automático | **que o software cobra** | os quatro elos, em ordem |
| Três vendas à mão | **que alguém paga por isto** | conversas |

A segunda é a única coisa que ainda não se sabe, e é a que todo o resto está esperando. Se a resposta for *ninguém paga*, o domínio, a conta na Stripe e o botão terão sido construídos para nada. Se for *pagam*, a automação passa a ter um número do outro lado justificando o custo — que é exatamente o tipo de justificativa que o `00-REGRAS-COMUNS.md` §2 exige para qualquer serviço novo.

**Isto não é recomendação de abandonar a automação.** É a observação de que ela está na ordem errada: hoje ela é pré-requisito de uma prova que não precisa dela.

### 7.3 Procedência desta seção

Três dos quatro elos foram medidos contra a máquina e o código, e estão documentados nas seções anteriores e no `ATUALIZAR-AMBIENTE-ONLINE.md`. **O elo 4 — a ausência de canal de contato — não é medição: é declaração do dono do projeto**, em 17/09/2026, e está registrado como tal de propósito.

A distinção é a lição mais cara desta semana, e custou duas correções públicas: [a §3.1](#31-o-deploy-o-nome-de-domínio), que confundiu ler configuração com medir, e o `THIRD_PARTY_FLOWSINT.md` §1, que confundiu ler uma página com medir uma tag. **Quem escreve precisa dizer de onde soube.**

---

## Anexo — comandos

```powershell
# Rotas de pagamento
Select-String -Path apps\api\src\billing\billing.controller.ts -Pattern "@(Get|Post)"
# → checkout, portal, webhook

# Capacidades e cota da auditoria
Select-String -Path apps\api\src\entitlements\entitlements.service.ts -Pattern "audit\.|auditsCount"
# → 'audit.run', 'audit.export', Math.max(0, included - usage.auditsCount)

# Planos e precos
Select-String -Path prisma\seed.ts -Pattern "code: '"
# → FREE 0, START 2700, PRO 4700, AGENCY 9700

# O front chama o checkout?
Get-ChildItem -Recurse apps\web\src -Include *.tsx,*.ts |
  Select-String -Pattern "billing/checkout|billing/portal"
# → vazio
```

### Anexo B — a leitura da §6

```powershell
# As URLs de retorno que o servico anuncia
Select-String -Path apps\api\src\billing\billing.service.ts -Pattern "settings/subscription"
# → 3 ocorrencias: successUrl, cancelUrl, returnUrl

# A rota que o Next realmente publica
Get-ChildItem -Recurse apps\web\src\app -Filter page.tsx |
  Where-Object FullName -match "subscription"
# → apps\web\src\app\(app)\subscription\page.tsx   ...e nada em settings\

# Existe redirect ou rewrite que salve?
Select-String -Path apps\web\next.config.mjs -Pattern "redirects|rewrites"
# → vazio (o arquivo tem 12 linhas)

# O botao da tela de planos tem manipulador?
Select-String -Path "apps\web\src\app\(app)\subscription\page.tsx" -Pattern "onClick|Falar sobre"
# → so o rotulo: 'Falar sobre este plano'
```
