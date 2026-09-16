# GATE 1 — o que falta para vender três diagnósticos com pagamento

**Data:** 16/09/2026
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

### 3.3 A tela

Um caminho que leve o usuário ao `POST /billing/checkout`, e as duas páginas de retorno — sucesso e cancelamento. Mais o `POST /billing/portal` para quem já assina gerenciar.

**A regra 7 do projeto proíbe que isso seja mock**, então a tela nasce ligada ao endpoint real ou não nasce.

> Existe um `apps/web/e2e/fluxo-4-planos-e-gates.spec.ts`. Planos e gates já têm cobertura ponta a ponta; **não foi lido nesta medição**, e vale abrir antes de escrever tela nova — pode já haver mais caminho pronto do que este documento afirma.

---

## 4. O que é decisão, e não é minha

- **Se o Gate 1 é a próxima prioridade.** O relatório de 22/08 diz que ele sumiu do roadmap e trata isso como defeito. Este documento confirma que o custo de trazê-lo de volta é baixo. Priorizar continua sendo decisão de produto.
- **Se vende por assinatura ou por diagnóstico avulso.** Os quatro planos existem; "três diagnósticos com pagamento" pode ser assinatura do plano Base ou venda unitária, e o modelo hoje suporta a primeira.
- **Onde hospedar.** O `PRIMEIRO-DEPLOY-CREDENCIAIS.md` §1 abre com *"uma exigência que elimina opções"* — e é ali que essa conversa começa.

---

## 5. Limite desta medição

Foi medida a **superfície**: existência de modelos, rotas, capacidades, planos e chamadas do front-end, cada uma com o comando no anexo.

**Não foi lido o corpo** do `billing.service.ts`, do `stripe.provider.ts` nem do e2e de planos. Que as rotas existam não prova que o fluxo esteja completo — prova que a arquitetura está, e que o que falta é ligação, não fundação.

Antes de escrever tela, ler esses três é o passo barato que pode encurtar ainda mais a lista.

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
