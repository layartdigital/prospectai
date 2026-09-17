import fs from 'node:fs';
import path from 'node:path';

import type {
  CheckoutInput,
  PaymentProvider,
  RemoteSubscription,
  RemoteSubscriptionStatus,
  VerifiedWebhook,
} from '@propectai/types';
import dotenv from 'dotenv';

import { BillingService } from '../src/billing/billing.service';
import { PrismaSistemaService } from '../src/prisma/prisma-sistema.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { conferirLimpeza } from './limpeza';
import { criarPrismaAdmin } from './prisma-admin';

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
 * resultado, pelo papel que **ignora** a política. Ele nunca entra no serviço.
 *
 * O serviço recebe um `PrismaService` de verdade — o mesmo que a aplicação
 * usa, conectado pelo `DATABASE_URL_APP` e portanto **sujeito à política de
 * RLS**. É essa separação que faz o teste exercitar o caminho real em vez de
 * um atalho.
 *
 * **Correção de 04/09.** Este comentário dizia "é a mesma separação de
 * `criarPrismaAdmin` nos outros arquivos" enquanto a linha abaixo ainda era
 * `new PrismaClient()` — o cliente do dono, não o do migrator. Descrevia o
 * desenho certo sobre o código errado, e por isso ninguém releu a linha. Passou
 * a usar `criarPrismaAdmin()` de fato quando a família 6 pôs `subscriptions`
 * sob política.
 *
 * Antes daqui o serviço recebia o cliente cru com um `as never`, e o `never`
 * calava o compilador exatamente na fronteira que teria acusado o problema:
 * o `PrismaClient` não tem `comTenant`, e a suíte só descobriu isso em
 * tempo de execução, no dia em que o `BillingService` passou a chamá-lo.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate`.
 */

const prisma = criarPrismaAdmin();
const suffix = Date.now().toString(36);

const PRICE_ID = `price_teste_${suffix}`;
const CUSTOMER_ID = `cus_teste_${suffix}`;
const SUB_ID = `sub_teste_${suffix}`;
const MOTIVO_INADIMPLENCIA = 'billing:inadimplencia';

let tenantId = '';
let planId = '';
/** O dono do workspace. `criarCheckout` recusa tenant sem ele. */
let donoId = '';
let service: BillingService;
/** O cliente que o serviço usa. Separado do `prisma` das asserções. */
let prismaDoServico: PrismaService;
/** O papel que atravessa tenants — `acharTenant` passa por ele. */
let sistema: PrismaSistemaService;

/** Estado do plano PRO antes do teste, para devolver como estava. */
let planoOriginal: { stripePriceId: string | null; priceCents: number } | null = null;

// ---------------------------------------------------------------------------
// Dublê do provedor
// ---------------------------------------------------------------------------

let assinaturaRemota: RemoteSubscription;
let proximoEvento: VerifiedWebhook;
/** Liga a falha para provar que o erro é gravado e propagado. */
let falharAoLer = false;

/**
 * O que o serviço **pediu** ao provedor, e não o que o provedor devolveu.
 *
 * Até 16/09/2026 estes dois dublês descartavam a entrada e devolviam uma URL
 * fixa. Parecia inofensivo — o que se testa aqui é a nossa reação, e a resposta
 * do Stripe não interessa. Só que as URLs de retorno *são* entrada nossa, e
 * descartá-las deixou passar três endereços apontando para uma rota que não
 * existe. Guardar o pedido custa duas linhas e fecha essa classe inteira.
 */
let ultimoCheckout: CheckoutInput | null = null;
let ultimoPortalReturnUrl: string | null = null;

const dubleProvider: PaymentProvider = {
  name: 'stub',
  configurado: true,
  createCheckout: async (input) => {
    ultimoCheckout = input;
    return { externalId: 'cs_stub', url: 'https://stub/checkout' };
  },
  createPortalSession: async (input) => {
    ultimoPortalReturnUrl = input.returnUrl;
    return { url: 'https://stub/portal' };
  },
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

// ---------------------------------------------------------------------------
// As rotas que o `apps/web` realmente publica
// ---------------------------------------------------------------------------

const RAIZ = path.resolve(__dirname, '../../..');
const ROTEADOR = path.join(RAIZ, 'apps', 'web', 'src', 'app');

/**
 * Lê o roteador do Next e devolve os caminhos que ele serve.
 *
 * Lê o disco, e é de propósito. A alternativa seria uma lista de rotas escrita
 * à mão aqui — que é mais uma cópia da verdade, pelo mesmo mecanismo que
 * produziu o defeito que este teste existe para impedir.
 */
function rotasPublicadas(dir: string = ROTEADOR, prefixo = ''): string[] {
  const rotas: string[] = [];

  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      // `(app)`, `(auth)` e `(admin)` sao grupos de layout: organizam arquivos
      // e nao entram na URL. Somar o nome do grupo inventaria rotas que
      // ninguem consegue abrir, e o teste passaria acreditando nelas.
      const segmento = /^\(.+\)$/.test(entrada.name) ? '' : `/${entrada.name}`;
      rotas.push(...rotasPublicadas(path.join(dir, entrada.name), prefixo + segmento));
      continue;
    }

    if (entrada.name === 'page.tsx') rotas.push(prefixo || '/');
  }

  return rotas;
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

  /**
   * O dono existe porque `criarCheckout` recusa workspace sem ele — é o e-mail
   * que vai para o provedor abrir a conta do cliente.
   *
   * Apagado à mão no `afterAll`: `User` **não** cai junto com o tenant, porque
   * uma pessoa pertence a vários workspaces. Foi exatamente esse o resíduo que
   * o `conferirLimpeza` encontrou no `team-rules` em 09/09, e o sufixo no
   * e-mail é o que faz a conferência acusar se alguém esquecer de novo.
   */
  const dono = await prisma.user.create({
    data: {
      email: `cobranca-${suffix}@teste.propectai.local`,
      name: 'Dono Cobranca',
      // Hash literal: este arquivo nunca autentica.
      passwordHash: 'nao-usado-neste-arquivo',
    },
  });
  donoId = dono.id;

  await prisma.membership.create({
    data: { userId: donoId, tenantId, role: 'OWNER', isDefault: true },
  });

  await prisma.subscription.create({
    data: { tenantId, planId, status: 'TRIALING', stripeSubscriptionId: SUB_ID },
  });

  // Sem `as never` nos dois primeiros parâmetros: são serviços de verdade, e o
  // tipo confere sozinho. Os outros dois continuam dublês — é o ponto do
  // arquivo.
  prismaDoServico = new PrismaService();

  /**
   * O papel que atravessa tenants, com o ciclo de vida de verdade.
   *
   * `acharTenant` passa por ele: descobrir o tenant a partir do webhook é a
   * consulta que não tem tenant a declarar. Chamar `onModuleInit` e
   * `onModuleDestroy` à mão é o que o Nest faria — e sem o segundo o Jest
   * termina reclamando de conexão aberta.
   */
  sistema = new PrismaSistemaService();
  await sistema.onModuleInit();

  service = new BillingService(
    prismaDoServico,
    sistema,
    { get: () => dubleProvider } as never,
    { get: () => 'http://localhost:3100' } as never,
  );
});

afterAll(async () => {
  await prisma.billingEvent.deleteMany({ where: { provider: 'stub' } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  // Depois do tenant: a `Membership` cai com ele, e o `User` fica.
  await prisma.user.deleteMany({ where: { id: donoId } });

  if (planoOriginal) {
    await prisma.plan.update({
      where: { id: planId },
      data: {
        stripePriceId: planoOriginal.stripePriceId,
        priceCents: planoOriginal.priceCents,
      },
    });
  }


  // Ver `conferirLimpeza`: devolve o relato, nao lanca — para o fechamento
  // abaixo acontecer antes da falha.
  const sobras = await conferirLimpeza(prisma, suffix);
  await sistema.onModuleDestroy();
  await prismaDoServico.$disconnect();
  await prisma.$disconnect();

  if (sobras !== null) throw new Error(sobras);
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

/**
 * O retorno do pagamento.
 *
 * Este bloco nasceu de um defeito real, encontrado em 16/09/2026 por leitura e
 * não por falha: o serviço mandava o cliente de volta para
 * `/settings/subscription` — sucesso, cancelamento e portal — e a rota que o
 * Next publica é `/subscription`. Quem pagasse cairia num 404.
 *
 * O defeito sobreviveu porque nada o exercita. Nenhuma tela chama o checkout,
 * e o e2e `fluxo-4-planos-e-gates` cobre o que cada plano libera e bloqueia
 * trocando de plano por `pnpm db:plan` — cobertura boa, que termina antes do
 * ponto onde este defeito mora.
 *
 * **Por que o teste lê o disco.** A asserção óbvia seria comparar a URL com a
 * string `/subscription`. Isso provaria que o serviço diz o que o teste espera,
 * e não que o destino existe — que é precisamente o erro que se cometeu. Ler o
 * roteador do `apps/web` transforma a afirmação em "o endereço anunciado é
 * servido por alguém", e ela quebra nas duas direções: se a URL mudar aqui, ou
 * se a tela mudar de lugar lá.
 *
 * Isso acopla a suíte da API à árvore de arquivos do front. O acoplamento já
 * existia — três URLs hard-coded apontando para uma rota do Next —, só que
 * calado. Declará-lo num teste é o que faz alguém ser avisado quando ele se
 * rompe.
 */
describe('o retorno do pagamento', () => {
  it('aponta para rotas que o front realmente publica', async () => {
    // O `stripeCustomerId` é o que o portal exige. Posto aqui e não herdado dos
    // blocos acima: teste que depende da ordem de execução dos vizinhos falha
    // no dia em que alguém rodar um `-t` sozinho.
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeCustomerId: CUSTOMER_ID },
    });

    await service.criarCheckout(tenantId, 'PRO');
    await service.abrirPortal(tenantId);

    expect(ultimoCheckout).not.toBeNull();
    expect(ultimoPortalReturnUrl).not.toBeNull();

    const rotas = rotasPublicadas();

    // Guarda do próprio guarda: se a leitura do roteador devolver vazio — pasta
    // movida, teste rodando de outro diretório — todas as asserções abaixo
    // falhariam por um motivo que não é o que este teste investiga.
    expect(rotas).toContain('/dashboard');

    const anunciadas = [
      ultimoCheckout!.successUrl,
      ultimoCheckout!.cancelUrl,
      ultimoPortalReturnUrl!,
    ];

    for (const url of anunciadas) {
      // Só o caminho: `?checkout=ok` é parâmetro, não rota.
      expect(rotas).toContain(new URL(url).pathname);
    }
  });

  it('registra no log de auditoria que o checkout foi aberto', async () => {
    const registros = await prisma.auditLog.findMany({
      where: { tenantId, action: 'billing.checkout.created' },
    });

    // O par do teste acima. Sem ele, um `criarCheckout` que devolvesse a URL
    // certa e não gravasse nada passaria — e a primeira pergunta depois de uma
    // cobrança contestada é quem abriu o checkout, e quando.
    expect(registros.length).toBeGreaterThan(0);
    expect(registros[0]?.after).toMatchObject({ planCode: 'PRO', currency: 'BRL' });
  });
});
