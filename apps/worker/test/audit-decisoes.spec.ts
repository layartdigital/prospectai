import type { AuditStatusName } from '@propectai/types';
import { describe, expect, it } from 'vitest';

import {
  decidirDesfecho,
  decidirExecucao,
  RETENCAO_CHECK_DIAS,
  retencaoAte,
  type EstadoAuditoria,
} from '../src/pipeline/audit-decisoes';

/**
 * Defesa contra job forjado e replay — egress policy §4, T6; medicoes S12 e S12b.
 *
 * Estas medicoes vivem aqui e nao no teste com banco porque o que elas provam e
 * a decisao, e decisao se prova sem Postgres. O teste com banco prova a outra
 * metade: que a chave composta impede alcancar a auditoria do vizinho.
 */

const estado = (status: AuditStatusName, queueJobId: string | null): EstadoAuditoria => ({
  status,
  queueJobId,
});

describe('S12 — mensagem forjada nao executa', () => {
  it('id diferente do gravado e recusado', () => {
    const d = decidirExecucao(estado('RUNNING', 'bull:123'), 'forjado:999');
    expect(d.executar).toBe(false);
    expect(d.executar === false && d.motivo).toBe('JOB_ALHEIO');
  });

  it('JOB_ALHEIO vence JA_FINALIZADA quando os dois se aplicam', () => {
    // Auditoria concluida recebendo mensagem alheia e tentativa de injecao, nao
    // replay banal. O motivo escolhido decide se aparece como aviso no log.
    const d = decidirExecucao(estado('COMPLETED', 'bull:123'), 'forjado:999');
    expect(d.executar === false && d.motivo).toBe('JOB_ALHEIO');
  });

  it('JOB_ALHEIO vence CANCELADA quando os dois se aplicam', () => {
    const d = decidirExecucao(estado('CANCELLED', 'bull:123'), 'forjado:999');
    expect(d.executar === false && d.motivo).toBe('JOB_ALHEIO');
  });
});

describe('S12b — replay nao reexecuta', () => {
  for (const terminal of ['COMPLETED', 'PARTIAL', 'FAILED'] as AuditStatusName[]) {
    it(`${terminal} recusa a mesma mensagem de volta`, () => {
      const d = decidirExecucao(estado(terminal, 'bull:123'), 'bull:123');
      expect(d.executar === false && d.motivo).toBe('JA_FINALIZADA');
    });
  }

  it('CANCELLED tem motivo proprio', () => {
    const d = decidirExecucao(estado('CANCELLED', 'bull:123'), 'bull:123');
    expect(d.executar === false && d.motivo).toBe('CANCELADA');
  });
});

describe('o retry do BullMQ sobrevive', () => {
  /**
   * O caso que uma guarda de estado ingenua mata.
   *
   * Com `attempts: 3`, a segunda tentativa chega com a auditoria em `RUNNING`,
   * porque a primeira a colocou la antes de falhar. Tratar `RUNNING` como
   * terminal transformaria a repeticao — que existe porque a rede falha — em
   * recusa silenciosa.
   */
  it('RUNNING com o mesmo id executa de novo', () => {
    const d = decidirExecucao(estado('RUNNING', 'bull:123'), 'bull:123');
    expect(d.executar).toBe(true);
    expect(d.executar === true && d.reivindicar).toBe(false);
  });

  it('primeira execucao reivindica a fila', () => {
    const d = decidirExecucao(estado('REQUESTED', null), 'bull:123');
    expect(d.executar).toBe(true);
    expect(d.executar === true && d.reivindicar).toBe(true);
  });

  it('QUEUED sem id tambem reivindica', () => {
    const d = decidirExecucao(estado('QUEUED', null), 'bull:456');
    expect(d.executar === true && d.reivindicar).toBe(true);
  });

  it('id nulo nao autoriza mensagem alheia depois de reivindicado', () => {
    // Reivindicar e uma via so: uma vez gravado, qualquer outro id e alheio.
    const primeira = decidirExecucao(estado('REQUESTED', null), 'bull:1');
    expect(primeira.executar === true && primeira.reivindicar).toBe(true);
    const segunda = decidirExecucao(estado('RUNNING', 'bull:1'), 'bull:2');
    expect(segunda.executar === false && segunda.motivo).toBe('JOB_ALHEIO');
  });
});

describe('desfecho', () => {
  it('COMPLETED persiste e nao devolve cota', () => {
    const d = decidirDesfecho('COMPLETED', false);
    expect(d.repetir).toBe(false);
    expect(d.repetir === false && d.persistir).toBe('COMPLETED');
    expect(d.repetir === false && d.devolverCota).toBe(false);
  });

  it('PARTIAL tambem e entrega', () => {
    const d = decidirDesfecho('PARTIAL', false);
    expect(d.repetir === false && d.persistir).toBe('PARTIAL');
    expect(d.repetir === false && d.devolverCota).toBe(false);
  });

  it('erro com tentativa sobrando manda repetir, sem estado terminal', () => {
    // Gravar FAILED aqui faria a proxima tentativa bater em JA_FINALIZADA — a
    // guarda de replay mataria o retry que ela nao deveria tocar.
    expect(decidirDesfecho('ERRO', false).repetir).toBe(true);
    expect(decidirDesfecho('FAILED', false).repetir).toBe(true);
  });

  it('erro na ultima tentativa persiste FAILED e devolve a cota', () => {
    const d = decidirDesfecho('ERRO', true);
    expect(d.repetir === false && d.persistir).toBe('FAILED');
    expect(d.repetir === false && d.devolverCota).toBe(true);
  });

  it('site que reprova em tudo nao devolve cota', () => {
    // A medicao aconteceu. O credito foi consumido por trabalho entregue.
    const d = decidirDesfecho('COMPLETED', true);
    expect(d.repetir === false && d.devolverCota).toBe(false);
  });
});

describe('retencao', () => {
  it('marca o prazo a partir de agora', () => {
    const agora = new Date('2026-08-24T12:00:00.000Z');
    const ate = retencaoAte(agora);
    const dias = (ate.getTime() - agora.getTime()) / (24 * 60 * 60 * 1000);
    expect(dias).toBe(RETENCAO_CHECK_DIAS);
  });

  it('nao devolve data no passado', () => {
    const agora = new Date();
    expect(retencaoAte(agora).getTime() > agora.getTime()).toBe(true);
  });
});
