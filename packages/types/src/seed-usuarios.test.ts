import { describe, expect, it } from 'vitest';

import { pessoasDoSeed, upsertDeUsuario, SENHA_MINIMA } from './seed-usuarios';

const AMBIENTE = {
  SEED_OWNER_PASSWORD: 'senha-do-owner-para-teste',
  SEED_SDR_PASSWORD: 'senha-do-sdr-para-teste',
};

describe('quem o seed cria, e com qual senha', () => {
  it('OWNER e SDR nascem com senhas diferentes, cada uma da propria variavel', () => {
    const [owner, sdr] = pessoasDoSeed(AMBIENTE);

    expect(owner?.papel).toBe('OWNER');
    expect(owner?.senha).toBe(AMBIENTE.SEED_OWNER_PASSWORD);
    expect(sdr?.papel).toBe('SDR');
    expect(sdr?.senha).toBe(AMBIENTE.SEED_SDR_PASSWORD);
    expect(owner?.senha).not.toBe(sdr?.senha);
  });

  it('SEED_SDR_PASSWORD e realmente consumida — nao e variavel decorativa', () => {
    const [, sdr] = pessoasDoSeed({ ...AMBIENTE, SEED_SDR_PASSWORD: 'outra-senha-distinta' });

    expect(sdr?.senha).toBe('outra-senha-distinta');
  });

  it('falta a senha de um papel: falha nomeando a variavel', () => {
    expect(() => pessoasDoSeed({ SEED_OWNER_PASSWORD: AMBIENTE.SEED_OWNER_PASSWORD })).toThrow(
      /SEED_SDR_PASSWORD/,
    );
  });

  it('nao existe senha padrao no codigo: ambiente vazio nao cria ninguem', () => {
    expect(() => pessoasDoSeed({})).toThrow(/SEED_OWNER_PASSWORD/);
  });

  it(`senha abaixo de ${SENHA_MINIMA} caracteres e recusada`, () => {
    expect(() => pessoasDoSeed({ ...AMBIENTE, SEED_SDR_PASSWORD: 'curta' })).toThrow(/minimo/);
  });

  it('as duas variaveis com o mesmo valor: recusado — foi o defeito de producao', () => {
    const mesma = 'a-mesma-senha-nos-dois';

    expect(() =>
      pessoasDoSeed({ SEED_OWNER_PASSWORD: mesma, SEED_SDR_PASSWORD: mesma }),
    ).toThrow(/iguais/);
  });

  it('e-mail do ambiente chega normalizado, e o padrao vale quando ele falta', () => {
    const [owner, sdr] = pessoasDoSeed({ ...AMBIENTE, SEED_OWNER_EMAIL: '  Dono@Empresa.COM  ' });

    expect(owner?.email).toBe('dono@empresa.com');
    expect(sdr?.email).toBe('sdr@demo.propectai.local');
  });
});

describe('o que o seed escreve num usuario', () => {
  const [owner] = pessoasDoSeed(AMBIENTE);

  it('na criacao, grava o hash', () => {
    const args = upsertDeUsuario(owner!, 'hash-fake');

    expect(args.create.passwordHash).toBe('hash-fake');
    expect(args.where.email).toBe(owner!.email);
  });

  it('em usuario existente, NAO toca em passwordHash', () => {
    const args = upsertDeUsuario(owner!, 'hash-fake');

    expect(args.update).not.toHaveProperty('passwordHash');
    expect(Object.keys(args.update)).toEqual(['name']);
  });

  it('rodar o seed de novo com outra senha nao muda o que seria gravado no existente', () => {
    const primeira = upsertDeUsuario(owner!, 'hash-da-primeira-rodada');
    const [ownerDepois] = pessoasDoSeed({ ...AMBIENTE, SEED_OWNER_PASSWORD: 'senha-trocada-depois' });
    const segunda = upsertDeUsuario(ownerDepois!, 'hash-da-segunda-rodada');

    expect(segunda.update).toEqual(primeira.update);
    expect(JSON.stringify(segunda.update)).not.toContain('hash');
  });
});
