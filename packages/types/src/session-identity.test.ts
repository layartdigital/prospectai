import { describe, expect, it } from 'vitest';

import { chaveDeIdentidade, compararIdentidade } from './session-identity';

describe('identidade de sessao', () => {
  const a = { user: { id: 'u1' }, tenant: { id: 't1' } };

  it('a mesma sessao gera a mesma chave', () => {
    expect(chaveDeIdentidade(a)).toBe(chaveDeIdentidade({ user: { id: 'u1' }, tenant: { id: 't1' } }));
  });
  it('outro workspace com o mesmo usuario muda a chave', () => {
    expect(compararIdentidade(chaveDeIdentidade(a), chaveDeIdentidade({ user: { id: 'u1' }, tenant: { id: 't2' } }))).toBe('MUDOU');
  });
  it('outro usuario no mesmo workspace muda a chave', () => {
    expect(compararIdentidade(chaveDeIdentidade(a), chaveDeIdentidade({ user: { id: 'u2' }, tenant: { id: 't1' } }))).toBe('MUDOU');
  });
  it('logout (sem sessao) muda a chave', () => {
    expect(chaveDeIdentidade(null)).toBe('sem-sessao');
    expect(chaveDeIdentidade({ user: null, tenant: { id: 't1' } })).toBe('sem-sessao');
    expect(compararIdentidade(chaveDeIdentidade(a), chaveDeIdentidade(null))).toBe('MUDOU');
  });
  it('conta sem tenant ativo tem chave propria', () => {
    expect(chaveDeIdentidade({ user: { id: 'u1' }, tenant: null })).toBe('["u1",null]');
    expect(compararIdentidade(chaveDeIdentidade(a), '["u1",null]')).toBe('MUDOU');
  });
  it('a chave nao mistura campos: u1+t1x nao colide com u1x+t1', () => {
    expect(chaveDeIdentidade({ user: { id: 'u1' }, tenant: { id: 'x|t:y' } })).not.toBe(
      chaveDeIdentidade({ user: { id: 'u1|t:x' }, tenant: { id: 'y' } }),
    );
  });
});
