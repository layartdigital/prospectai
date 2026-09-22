import { describe, expect, it } from 'vitest';

import { urlSemSenha } from './segredo';

describe('urlSemSenha — o endereco que pode ir para log', () => {
  it('o caso que vazou em producao: Redis com senha e sem usuario', () => {
    expect(urlSemSenha('redis://:0f3a9c11be42@redis:6379')).toBe('redis://:***@redis:6379');
  });

  it.each([
    ['redis://default:s3nh4@redis:6379/0', 'redis://default:***@redis:6379/0'],
    ['rediss://:s3nh4@cache.exemplo:6380', 'rediss://:***@cache.exemplo:6380'],
    [
      'postgresql://propectai_app:abc123@postgres:5432/propectai?schema=public&connection_limit=15',
      'postgresql://propectai_app:***@postgres:5432/propectai?schema=public&connection_limit=15',
    ],
  ])('esconde a senha em %s', (entrada, esperado) => {
    expect(urlSemSenha(entrada)).toBe(esperado);
  });

  it.each([
    'redis://localhost:6381',
    'redis://usuario@redis:6379',
    'redis://redis:6379/0?name=a@b',
  ])('nao altera endereco sem senha: %s', (url) => {
    expect(urlSemSenha(url)).toBe(url);
  });

  it('a senha nao sobra em lugar nenhum do resultado', () => {
    const senha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4';
    expect(urlSemSenha(`redis://:${senha}@redis:6379`)).not.toContain(senha);
  });
});
