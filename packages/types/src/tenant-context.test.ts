import { describe, expect, it } from 'vitest';

import { TENANT_SETTING, TenantIdInvalido, validarTenantId } from './tenant-context';

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
