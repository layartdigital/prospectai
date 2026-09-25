/**
 * Quem o seed cria, e de onde vem a senha de cada um.
 *
 * Existe desde 25/09/2026, e nasceu de um defeito medido em producao: o
 * `seedUsers` gerava **um** hash a partir de `SEED_OWNER_PASSWORD` e o aplicava
 * aos dois usuarios, e o `update` do upsert regravava `passwordHash` a cada
 * execucao. Consequencias, as duas confirmadas no ambiente online:
 *
 * 1. OWNER e SDR compartilhavam a mesma credencial — a impressao `md5` dos dois
 *    hashes era identica no banco;
 * 2. rodar `db:seed` para atualizar limite de plano **redefinia a senha** de
 *    quem ja existia, desfazendo qualquer rotacao feita antes.
 *
 * A regra agora mora aqui, fora do script, porque aqui existe runner de teste.
 * O modulo nao importa Prisma nem Node: recebe o ambiente e devolve dados.
 */

export type PapelDoSeed = 'OWNER' | 'SDR';

export interface PessoaDoSeed {
  readonly papel: PapelDoSeed;
  readonly email: string;
  readonly nome: string;
  readonly isDefault: boolean;
  /** Usada **somente na criacao**. Ver `upsertDeUsuario`. */
  readonly senha: string;
}

export interface AmbienteDoSeed {
  readonly SEED_OWNER_EMAIL?: string;
  readonly SEED_OWNER_PASSWORD?: string;
  readonly SEED_SDR_EMAIL?: string;
  readonly SEED_SDR_PASSWORD?: string;
}

interface Padrao {
  readonly papel: PapelDoSeed;
  readonly email: string;
  readonly nome: string;
  readonly isDefault: boolean;
  readonly varEmail: keyof AmbienteDoSeed;
  readonly varSenha: keyof AmbienteDoSeed;
}

/**
 * E-mail tem padrao; **senha nao tem**.
 *
 * Um padrao de senha no codigo e uma credencial publicada: foi exatamente o que
 * o `?? 'Demo@123456'` da versao anterior produziu, num repositorio aberto.
 * Sem a variavel, o seed falha alto em vez de criar conta com senha conhecida.
 */
const PADROES: readonly Padrao[] = [
  {
    papel: 'OWNER',
    email: 'owner@demo.propectai.local',
    nome: 'Uilson Távora',
    isDefault: true,
    varEmail: 'SEED_OWNER_EMAIL',
    varSenha: 'SEED_OWNER_PASSWORD',
  },
  {
    papel: 'SDR',
    email: 'sdr@demo.propectai.local',
    nome: 'Marina Costa',
    isDefault: false,
    varEmail: 'SEED_SDR_EMAIL',
    varSenha: 'SEED_SDR_PASSWORD',
  },
];

/** Comprimento minimo aceito. Nao e politica de senha do produto: e o piso que
 * impede `SEED_SDR_PASSWORD=x` passar despercebido num ambiente exposto. */
export const SENHA_MINIMA = 12;

export function pessoasDoSeed(env: AmbienteDoSeed): PessoaDoSeed[] {
  const pessoas = PADROES.map((padrao) => {
    const senha = (env[padrao.varSenha] ?? '').trim();

    if (senha.length === 0) {
      throw new Error(
        `${padrao.varSenha} nao esta definida. Cada papel usa a propria: ` +
          `SEED_OWNER_PASSWORD para o OWNER, SEED_SDR_PASSWORD para o SDR.`,
      );
    }

    if (senha.length < SENHA_MINIMA) {
      throw new Error(
        `${padrao.varSenha} tem ${senha.length} caracteres; o minimo e ${SENHA_MINIMA}.`,
      );
    }

    return {
      papel: padrao.papel,
      email: (env[padrao.varEmail] ?? padrao.email).trim().toLowerCase(),
      nome: padrao.nome,
      isDefault: padrao.isDefault,
      senha,
    };
  });

  const [owner, sdr] = pessoas;
  if (owner && sdr && owner.senha === sdr.senha) {
    throw new Error(
      'SEED_OWNER_PASSWORD e SEED_SDR_PASSWORD sao iguais. Duas contas com a ' +
        'mesma credencial e o defeito que este modulo existe para impedir.',
    );
  }

  return pessoas;
}

export interface UpsertDeUsuario {
  readonly where: { readonly email: string };
  readonly create: { readonly email: string; readonly name: string; readonly passwordHash: string };
  /** **Sem `passwordHash`, e isto e a regra inteira.** Seed que roda para
   * corrigir limite de plano nao pode desfazer rotacao de senha. */
  readonly update: { readonly name: string };
}

export function upsertDeUsuario(pessoa: PessoaDoSeed, passwordHash: string): UpsertDeUsuario {
  return {
    where: { email: pessoa.email },
    create: { email: pessoa.email, name: pessoa.nome, passwordHash },
    update: { name: pessoa.nome },
  };
}
