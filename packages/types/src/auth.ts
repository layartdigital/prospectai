import type { Role } from './common';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  role: Role;
  planCode: string;
}

export interface SessionResponse {
  user: AuthUser;
  tenant: AuthTenant | null;
  tenants: AuthTenant[];
  onboardingCompleted: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  tenantName: string;
}

/** Nomes dos cookies. Ambos HttpOnly - nunca legíveis por JavaScript. */
export const AUTH_COOKIES = {
  access: 'pa_at',
  refresh: 'pa_rt',
} as const;

/**
 * Limites por plano. Lidos exclusivamente pelo EntitlementService -
 * nenhum componente ou controller consulta limite diretamente.
 */
export interface PlanLimits {
  leadsIncluded: number;
  searchesPerMonth: number;
  aiGenerationsPerMonth: number;
  /** Auditorias de presenca digital por mes. `scope-v0.2.md` §6. */
  auditsPerMonth: number;
  maxUsers: number;
  exportFormats: string[];
  retentionDays: number;
  /** Telefone parcialmente oculto na interface. */
  maskPhones: boolean;
  pipelineEnabled: boolean;
}

/**
 * Limites iniciais de cada plano.
 *
 * **Semente, não verdade.** Desde 13/08/2026 quem responde "qual é o limite
 * deste plano" é `Plan.limits` no banco, lido pelo `EntitlementsService` — ver
 * `docs/strategic/lacunas-estruturais.md` §11.1, passo 3.
 *
 * Esta constante existe para que `prisma/seed.ts` tenha o que gravar. **Nenhum
 * código de produto pode lê-la.** Um gate que consultasse aqui ignoraria a
 * edição feita na tela do Master, e o operador veria o valor novo na interface
 * enquanto o produto aplicasse o antigo — tela que mente é pior que tela
 * ausente.
 *
 * ---
 *
 * **Correção de 17/09/2026.** Este bloco terminava assim:
 *
 * > Os números aqui envelhecem sem consequência: depois do primeiro seed, quem
 * > manda é o banco.
 *
 * As duas metades da frase eram falsas, e uma escondia a outra.
 *
 * O `upsert` do `prisma/seed.ts` grava `limits` **nos dois ramos**, `create` e
 * `update`. Não é só banco vazio: a constante é reimposta a cada
 * `pnpm db:seed`, e o CI semeia a cada push, e o `PRIMEIRO-DEPLOY-CREDENCIAIS`
 * tem "semear" entre os passos obrigatórios. Os números aqui têm consequência
 * sempre.
 *
 * E a edição que o parágrafo acima protege **não existe ainda**: o painel de
 * admin tem quatro rotas — listar, trocar o plano de um tenant, suspender,
 * reativar — e nenhuma escreve em `Plan.limits`. O `admin.service.ts` diz no
 * futuro: "depois da tela do Master". Enquanto ela não chega, o caminho para
 * mudar um limite é **esta constante mais um `pnpm db:seed`**, e é por isso
 * que o `update` do seed continua gravando `limits`.
 *
 * **O dia em que a tela do Master existir, `limits` tem de sair do `update`**,
 * como o `stripePriceId` já saiu e pelo mesmo motivo: senão o primeiro deploy
 * depois de um ajuste operacional reverte o ajuste em silêncio. A nota está
 * também em `prisma/seed.ts`, ao lado da linha.
 *
 * Em tempo de execução nada disto muda: quem responde ao produto é
 * `Plan.limits` no banco, pelo `EntitlementsService`. O que muda é quem
 * escreve lá.
 */
export const PLAN_LIMITS: Record<string, PlanLimits> = {
  FREE: {
    leadsIncluded: 5,
    searchesPerMonth: 3,
    aiGenerationsPerMonth: 0,
    /**
     * De 3 para 1 em 17/09/2026.
     *
     * O Gate 1 do programa e "vender tres diagnosticos com pagamento", e o
     * plano gratuito entregava exatamente tres por mes. O numero do alvo era o
     * numero do que se dava de graca: **ninguem precisava pagar para obter
     * tres diagnosticos**, e nem o deploy nem a tela de checkout mudariam
     * isso. O obstaculo ao Gate 1 nao estava na cobranca; estava nesta linha.
     *
     * **Uma, e nao zero.** Zero desligaria a capacidade inteira — o
     * `EntitlementsService` decide `audit.run` por `auditsPerMonth > 0` —, e o
     * FREE perderia a porta de entrada do produto. Uma deixa a pessoa ver o
     * diagnostico funcionando antes de decidir, e poe o alvo do Gate 1 do
     * outro lado do pagamento.
     */
    auditsPerMonth: 1,
    maxUsers: 1,
    exportFormats: [],
    retentionDays: 30,
    maskPhones: true,
    pipelineEnabled: false,
  },
  START: {
    leadsIncluded: 250,
    searchesPerMonth: 50,
    aiGenerationsPerMonth: 150,
    auditsPerMonth: 30,
    maxUsers: 1,
    exportFormats: ['csv'],
    retentionDays: 180,
    maskPhones: false,
    pipelineEnabled: true,
  },
  // Limites interpolados entre START e AGENCY em 13/08/2026. Os dois extremos
  // vieram de decisão comercial; este meio não — se o PRO for reprecificado,
  // é aqui que se mexe.
  PRO: {
    leadsIncluded: 600,
    searchesPerMonth: 120,
    aiGenerationsPerMonth: 400,
    auditsPerMonth: 150,
    maxUsers: 5,
    exportFormats: ['csv', 'xlsx'],
    retentionDays: 365,
    maskPhones: false,
    pipelineEnabled: true,
  },
  AGENCY: {
    leadsIncluded: 1500,
    searchesPerMonth: 250,
    aiGenerationsPerMonth: 1000,
    auditsPerMonth: 600,
    maxUsers: 25,
    exportFormats: ['csv', 'xlsx'],
    retentionDays: 730,
    maskPhones: false,
    pipelineEnabled: true,
  },
};

/** Hierarquia de papéis: índice menor significa mais privilégio. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 0,
  ADMIN: 1,
  MANAGER: 2,
  SDR: 3,
  VIEWER: 4,
};

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] <= ROLE_RANK[required];
}
