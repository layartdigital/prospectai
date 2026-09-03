import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import type {
  PaymentProvider,
  RemoteSubscription,
  RemoteSubscriptionStatus,
  VerifiedWebhook,
} from '@propectai/types';
import dotenv from 'dotenv';

import { BillingService } from '../src/billing/billing.service';
import { PrismaService } from '../src/prisma/prisma.service';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Regras de cobrança.
 *
 * Todas decididas em `docs/strategic/lacunas-estruturais.md` §10, e todas com
 * a mesma característica: o erro não aparece onde foi cometido. Suspensão
 * indevida vira reclamação de cliente dias depois; webhook processado duas
 * vezes vira número errado que ninguém consegue explicar.
 *
 * O provedor é substituído por um dublê — o que se testa aqui é **a nossa
 * reação**, não o Stripe. Chamar o Stripe de verdade tornaria a suíte
 * dependente de rede, de chave e do humor de um serviço externo, e não
 * provaria nada a mais sobre o nosso código.
 *
 * ---
 *
 * **Dois clientes de banco, de propósito.**
 *
 * O `prisma` daqui é o cliente do *teste*: monta o cenário e confere o
 * resultado, conectado como dono das tabelas. Ele nunca entra no serviço.
 *
 * O serviço recebe um `PrismaService` de verdade — o mesmo que a aplicação
 * usa, conectado pelo `DATABASE_URL_APP` e portanto **sujeito à política de
 * RLS**. É a mesma separação de `criarPrismaAdmin` nos outros arquivos, e é o
 * que faz este teste exercitar o caminho real em vez de um atalho.
 *
 * Antes daqui o serviço recebia o cliente cru com um `as never`, e o `never`
 * calava o compilador exatamente na fronteira que teria acusado o problema:
 * o `PrismaClient` não tem `comTenant`, e a suíte só descobriu isso em
 * tempo de execução, no dia em que o `BillingService` passou a chamá-lo.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate`.
 */

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

const PRICE_ID = `price_teste_${suffix}`;
const CUSTOMER_ID = `cus_teste_${suffix}`;
const SUB_ID = `sub_teste_${suffix}`;
const MOTIVO_INADIMPLENCIA = 'billing:inadimplencia';

let tenantId = '';
let planId = '';
let service: BillingService;
/** O cliente que o serviço usa. Separado do `prisma` das asserções. */
let prismaDoServico: PrismaService;

/** Estado do plano PRO antes do teste, para devolver como estava. */
let planoOriginal: { stripePriceId: string | null; priceCents: number } | null = null;

// ---------------------------------------------------------------------------
// Dublê do provedor
// ---------------------------------------------------------------------------

let assinaturaRemota: RemoteSubscription;
let proximoEvento: VerifiedWebhook;
/** Liga a falha para provar que o erro é gravado e propagado. */
let falharAoLer = false;

const dubleProvider: PaymentProvider = {
  name: 'stub',
  configurado: true,
  createCheckout: async () => ({ externalId: 'cs_stub', url: 'https://stub/checkout' }),
  createPortalSession: async () => ({ url: 'https://stub/portal' }),
  getSubscription: async () => {
    if (falharAoLer) throw new Error('provedor indisponível');
    return assinaturaRemota;
  },
  setCancelAtPeriodEnd: async () => assinaturaRemota,
  listPrices: async () => [],
  verifyWebhook: () => proximoEvento,
};

function assinatura(
  status: RemoteSubscriptionStatus,
  extras: Partial<RemoteSubscription> = {},
): RemoteSubscription {
  return {
    externalId: SUB_ID,
    customerId: CUSTOMER_ID,
    priceId: PRICE_ID,
    status,
    currency: 'BRL',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    metadata: { tenantId },
    ...extras,
  };
}

/** Dispara um webhook de mudança de assinatura com o status pedido. */
async function receber(
  status: RemoteSubscriptionStatus,
  eventoId = `evt_${suffix}_${Math.random().toString(36).slice(2, 8)}`,
): Promise<void> {
  assinaturaRemota = assinatura(status);
  proximoEvento = {
    externalId: eventoId,
    type: 'customer.subscription.updated',
    payload: { stub: true },
    event: { kind: 'SUBSCRIPTION_CHANGED', subscription: assinaturaRemota },
  };

  await service.receberWebhook(Buffer.from('{}'), 'assinatura-falsa');
}

async function tenant() {
  return prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
}

beforeAll(async () => {
  await prisma.$connect();

  // `Plan.code` é enum com quatro valores e é único — não dá para criar um
  // plano descartável. O PRO é emprestado e devolvido como estava no afterAll.
  //
  // O estado anterior é lido ANTES do upsert. Fixar `null` aqui funcionaria
  // hoje, que nenhum plano tem preço no Stripe, e apagaria a configuração de
  // produção no primeiro dia em que tiver.
  const anterior = await prisma.plan.findUnique({
    where: { code: 'PRO' },
    select: { stripePriceId: true, priceCents: true },
  });

  const pro = await prisma.plan.upsert({
    where: { code: 'PRO' },
    create: {
      code: 'PRO',
      name: 'Impulso',
      priceCents: 14900,
      currency: 'BRL',
      limits: {},
      stripePriceId: PRICE_ID,
      pricesByCurrency: { BRL: 14900 },
    },
    update: { stripePriceId: PRICE_ID },
    select: { id: true, stripePriceId: true, priceCents: true },
  });

  planId = pro.id;
  planoOriginal = {
    stripePriceId: anterior?.stripePriceId ?? null,
    priceCents: anterior?.priceCents ?? pro.priceCents,
  };

  const criado = await prisma.tenant.create({
    data: {
      name: `Tenant Cobranca ${suffix}`,
      slug: `cobranca-${suffix}`,
      isDemo: true,
      currency: 'BRL',
    },
  });
  tenantId = criado.id;

  await prisma.subscription.create({
    data: { tenantId, planId, status: 'TRIALING', stripeSubscriptionId: SUB_ID },
  });

  // Sem `as never` no primeiro parâmetro: é um `PrismaService` de verdade, e
  // o tipo confere sozinho. Os outros dois continuam dublês — é o ponto do
  // arquivo.
  prismaDoServico = new PrismaService();

  service = new BillingService(
    prismaDoServico,
    { get: () => dubleProvider } as never,
    { get: () => 'http://localhost:3100' } as never,
  );
});

afterAll(async () => {
  await prisma.billingEvent.deleteMany({ where: { provider: 'stub' } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });

  if (planoOriginal) {
    await prisma.plan.update({
      where: { id: planId },
      data: {
        stripePriceId: planoOriginal.stripePriceId,
        priceCents: planoOriginal.priceCents,
      },
    });
  }

  await prismaDoServico.$disconnect();
  await prisma.$disconnect();
});

describe('§10.3 — suspensão segue o estado da assinatura', () => {
  it('PAST_DUE não suspende', async () => {
    await receber('PAST_DUE');

    const atual = await tenant();

    // A causa mais comum de PAST_DUE é cartão vencido, e o provedor ainda vai
    // tentar de novo. Suspender aqui perderia cliente por um problema que se
    // resolve sozinho na segunda tentativa.
    expect(atual.suspendedAt).toBeNull();

    const assinaturaSalva = await prisma.subscription.findUniqueOrThrow({
      where: { tenantId },
    });
    expect(assinaturaSalva.status).toBe('PAST_DUE');
  });

  it('UNPAID suspende com o marcador de inadimplência', async () => {
    await receber('UNPAID');

    const atual = await tenant();
    expect(atual.suspendedAt).not.toBeNull();
    expect(atual.suspendedReason).toBe(MOTIVO_INADIMPLENCIA);
  });

  it('pagamento reativa quem foi suspenso por inadimplência', async () => {
    await receber('ACTIVE');

    const atual = await tenant();
    expect(atual.suspendedAt).toBeNull();
    expect(atual.suspendedReason).toBeNull();
  });

  it('pagamento NÃO reativa suspensão manual', async () => {
    // O guarda mais importante do arquivo. Sem o marcador em suspendedReason,
    // um tenant suspenso por abuso voltaria sozinho no dia em que a fatura
    // fosse paga — e o operador que o suspendeu não saberia.
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { suspendedAt: new Date(), suspendedReason: 'abuso: raspagem em massa' },
    });

    await receber('ACTIVE');

    const atual = await tenant();
    expect(atual.suspendedAt).not.toBeNull();
    expect(atual.suspendedReason).toBe('abuso: raspagem em massa');

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { suspendedAt: null, suspendedReason: null },
    });
  });
});

describe('idempotência do webhook', () => {
  it('o mesmo evento entregue duas vezes só age uma', async () => {
    const eventoId = `evt_repetido_${suffix}`;

    await receber('UNPAID', eventoId);
    const primeiraSuspensao = (await tenant()).suspendedAt;

    // Reentrega: o provedor reenvia quando a resposta demora. O tenant é
    // reativado no meio para que uma segunda execução deixe rastro visível.
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { suspendedAt: null, suspendedReason: null },
    });

    await receber('UNPAID', eventoId);

    const atual = await tenant();
    expect(atual.suspendedAt).toBeNull();

    const registro = await prisma.billingEvent.findUniqueOrThrow({
      where: { provider_externalId: { provider: 'stub', externalId: eventoId } },
    });

    // Duas entregas contadas, um processamento só.
    expect(registro.attempts).toBe(2);
    expect(registro.processedAt).not.toBeNull();
    expect(primeiraSuspensao).not.toBeNull();
  });
});

describe('falha de processamento', () => {
  it('grava o erro, mantém o evento por processar e propaga', async () => {
    const eventoId = `evt_falho_${suffix}`;
    falharAoLer = true;

    await expect(receber('ACTIVE', eventoId)).rejects.toThrow();

    falharAoLer = false;

    const registro = await prisma.billingEvent.findUniqueOrThrow({
      where: { provider_externalId: { provider: 'stub', externalId: eventoId } },
    });

    // As três afirmações são uma só: o evento não se perdeu, sabe-se por quê,
    // e ele continua elegível para reprocessamento quando o provedor
    // reentregar. Engolir o erro apagaria as três.
    expect(registro.error).toContain('provedor indisponível');
    expect(registro.processedAt).toBeNull();
    expect(registro.attempts).toBe(1);
  });
});
