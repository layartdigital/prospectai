import { describe, expect, it } from 'vitest';

import {
  CredencialDeBancoAusente,
  TENANT_SETTING,
  TenantIdInvalido,
  exigirUrlDoBanco,
  validarTenantId,
} from './tenant-context';

/**
 * O que este arquivo prova roda sem banco: o contrato que a API, o worker e a
 * politica de RLS compartilham.
 *
 * A prova de que o contexto **chega ao Postgres** esta em
 * `apps/worker/test/com-tenant.spec.ts`, porque so o banco pode mostrar aquilo.
 */

describe('TENANT_SETTING', () => {
  it('tem prefixo com ponto, que e exigencia do Postgres', () => {
    // Sem prefixo, `set_config` responde "unrecognized configuration
    // parameter". O teste existe para que alguem que "simplifique" o nome para
    // `tenant_id` descubra aqui, e nao no passo 4.
    expect(TENANT_SETTING).toMatch(/^[a-z]+\.[a-z_]+$/);
  });
});

describe('validarTenantId', () => {
  it('aceita um id normal e devolve o mesmo valor', () => {
    const id = 'cmtbfthzj007nwz6s4357oj75';
    expect(validarTenantId(id)).toBe(id);
  });

  it('recusa vazio', () => {
    // O defeito que o banco nao denuncia: com RLS ligado, tenant vazio nao
    // e erro, e negacao total silenciosa.
    expect(() => validarTenantId('')).toThrow(TenantIdInvalido);
  });

  it('recusa string so de espaco', () => {
    expect(() => validarTenantId('   ')).toThrow(TenantIdInvalido);
  });

  it('recusa o que nem string e', () => {
    // `undefined` chega aqui quando alguem le `request.tenant?.id` sem o guard
    // ter rodado. Sem esta linha, o `set_config` receberia `undefined` e o
    // Prisma o converteria em NULL.
    expect(() => validarTenantId(undefined)).toThrow(TenantIdInvalido);
    expect(() => validarTenantId(null)).toThrow(TenantIdInvalido);
  });

  it('nao inventa validacao de formato', () => {
    /**
     * Deliberado, e por isso tem teste proprio: um regex de cuid aqui so
     * criaria um jeito novo de recusar id legitimo. Injecao nao e o risco —
     * o valor entra por parametro de statement preparado.
     *
     * Se um dia alguem quiser apertar isto, que seja apertando este teste, e
     * nao descobrindo em producao que um id de outro formato foi recusado.
     */
    expect(validarTenantId('id-com-hifen-e-MAIUSCULA')).toBe('id-com-hifen-e-MAIUSCULA');
  });
});

describe('exigirUrlDoBanco', () => {
  // Valores ficticios: nenhum teste aqui conecta em nada.
  const DONO = 'postgresql://dono:x@db:5432/propectai';
  const APP = 'postgresql://app:x@db:5432/propectai';
  const SISTEMA = 'postgresql://sistema:x@db:5432/propectai';

  it('devolve a URL do papel quando ela existe', () => {
    const ambiente = { DATABASE_URL: DONO, DATABASE_URL_APP: APP, DATABASE_URL_SISTEMA: SISTEMA };
    expect(exigirUrlDoBanco(ambiente, 'DATABASE_URL_APP')).toBe(APP);
    expect(exigirUrlDoBanco(ambiente, 'DATABASE_URL_SISTEMA')).toBe(SISTEMA);
  });

  it('NAO cai no DATABASE_URL quando a variavel do papel falta', () => {
    /**
     * O teste que define o DB-REM-01. Com o `DATABASE_URL` do dono presente
     * — como sempre esta, porque o Prisma CLI precisa dele —, a versao
     * anterior devolvia `undefined` e o Prisma conectava como superusuario.
     * Aqui a presenca do dono nao pode mudar o resultado: recusa.
     */
    const ambiente = { DATABASE_URL: DONO };
    expect(() => exigirUrlDoBanco(ambiente, 'DATABASE_URL_APP')).toThrow(CredencialDeBancoAusente);
    expect(() => exigirUrlDoBanco(ambiente, 'DATABASE_URL_SISTEMA')).toThrow(
      CredencialDeBancoAusente,
    );
  });

  it('trata vazio e so espaco como ausente', () => {
    // `DATABASE_URL_APP=` numa linha de `.env` chega como string vazia, nao
    // como undefined. As duas formas precisam recusar igual.
    expect(() => exigirUrlDoBanco({ DATABASE_URL_APP: '' }, 'DATABASE_URL_APP')).toThrow(
      CredencialDeBancoAusente,
    );
    expect(() => exigirUrlDoBanco({ DATABASE_URL_APP: '   ' }, 'DATABASE_URL_APP')).toThrow(
      CredencialDeBancoAusente,
    );
  });

  it('o erro diz qual variavel falta, e nao carrega URL nenhuma', () => {
    // A mensagem vai para o log de boot. Ela precisa apontar a correcao sem
    // jamais repetir uma connection string — nem a do dono, que esta no
    // mesmo ambiente.
    let erro: unknown;
    try {
      exigirUrlDoBanco({ DATABASE_URL: DONO }, 'DATABASE_URL_SISTEMA');
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(CredencialDeBancoAusente);
    const ausente = erro as CredencialDeBancoAusente;
    expect(ausente.variavel).toBe('DATABASE_URL_SISTEMA');
    expect(ausente.name).toBe('CredencialDeBancoAusente');
    expect(ausente.message).toContain('DATABASE_URL_SISTEMA');
    expect(ausente.message).not.toContain('postgresql://');
  });
});
