# GATE 1 — o que falta para vender três diagnósticos com pagamento

**Data:** 16/09/2026 · *revisto no mesmo dia, depois da leitura dos três arquivos que a §5 pedia — ver §6*
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

### 3.1 O deploy — e ele deixou de estar corretamente adiado

A D5 vem sendo classificada como *"bloqueada por ausência de produção, e isso está correto"*. **Não está mais.**

O checkout da Stripe não termina no navegador: ela confirma o pagamento chamando **de volta** um endereço público. Sem um ambiente publicado, o `POST /billing/webhook` não tem endereço, e sem ele nenhuma assinatura muda de estado — o cliente paga e o sistema não fica sabendo.

**A D5 não é mais uma dependência adiada. É o gargalo do Gate 1.**

O caminho está escrito e ensaiado: `PRIMEIRO-DEPLOY-CREDENCIAIS.md` tem seis passos em ordem obrigatória, e o CI executa a mesma sequência a cada push — criar banco e dono, migrations, senha aos três papéis, quatro variáveis, semear, verificar.

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

### 3.4 O retorno do pagamento cai em 404 — e isso é defeito, não lacuna

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
