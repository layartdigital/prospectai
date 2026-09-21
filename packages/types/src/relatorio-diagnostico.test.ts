import { describe, expect, it } from 'vitest';

import {
  recusaDoRelatorio,
  traduzirChecagem,
  type ChecagemMedida,
  type ItemDoRelatorio,
} from './relatorio-diagnostico';
import { AUDIT_STATUSES, CHECK_OUTCOMES, SITE_CHECKS } from './site-audit';

/**
 * O guarda da regra 4 aplicada a um documento que vai para a mão do cliente.
 *
 * > `CLAUDE.md` regra 4: *"Ausência de sinal é `DESCONHECIDO`, nunca
 * > `AUSENTE`."*
 *
 * O risco aqui não é de código: é de **redação**. Alguém editando o texto para
 * deixá-lo mais vendável escreve "seu site não tem certificado" numa linha que
 * significava "não conseguimos olhar", e nada quebra — o relatório continua
 * compilando, bonito e errado. Estes testes existem para que quebre.
 */

const SITE = 'exemplo.com.br';

/** Todos os códigos que o provedor nativo e o transporte sabem emitir. */
const CODIGOS = [
  null,
  'NAO_RESOLVE',
  'DESTINO_BLOQUEADO',
  'SEM_DNS',
  'SEM_RESPOSTA',
  'ERRO_DO_SERVIDOR',
  'RESPOSTA_NAO_CONCLUSIVA',
  'REDIRECT_PARA_DESTINO_QUEBRADO',
  'SONDA_HTTP_NAO_CONCLUSIVA',
  'SEM_HTTPS',
  'TIMEOUT',
  'CONEXAO_RECUSADA',
  'CONEXAO_PERDIDA',
  'REDE_INALCANCAVEL',
  'RESPOSTA_INVALIDA',
  'DESCONHECIDO',
  'TLS_CERTIFICADO_EXPIRADO',
  'TLS_NOME_NAO_CONFERE',
  'TLS_AUTOASSINADO',
  'TLS_INVALIDO',
] as const;

/** O produto cartesiano inteiro: nenhuma combinação fica fora do exame. */
function todasAsCombinacoes(): ChecagemMedida[] {
  const todas: ChecagemMedida[] = [];
  for (const check of SITE_CHECKS) {
    for (const outcome of CHECK_OUTCOMES) {
      for (const errorCode of CODIGOS) {
        todas.push({ check, outcome, errorCode, result: null });
      }
    }
  }
  return todas;
}

function traduzidas(): Array<{ entrada: ChecagemMedida; item: ItemDoRelatorio }> {
  return todasAsCombinacoes()
    .map((entrada) => ({ entrada, item: traduzirChecagem(entrada, SITE) }))
    .filter((par): par is { entrada: ChecagemMedida; item: ItemDoRelatorio } =>
      par.item !== null,
    );
}

describe('regra 4 — o que não foi verificado nunca vira achado', () => {
  it('nenhum SKIPPED produz ACHADO, em nenhuma checagem', () => {
    const violacoes = traduzidas()
      .filter((p) => p.entrada.outcome === 'SKIPPED' && p.item.secao === 'ACHADO')
      .map((p) => `${p.entrada.check}/${p.entrada.errorCode}`);

    // SKIPPED é informação sobre a NOSSA execução — o `CheckOutcome` do schema
    // diz isso com todas as letras. Levá-lo para a seção de achados é entregar
    // ao cliente um defeito nosso como se fosse dele.
    expect(violacoes).toEqual([]);
  });

  it('falha de conexão no HTTPS não vira "não tem certificado"', () => {
    const conexao = ['TIMEOUT', 'CONEXAO_RECUSADA', 'CONEXAO_PERDIDA', 'REDE_INALCANCAVEL'];

    for (const errorCode of conexao) {
      const item = traduzirChecagem(
        { check: 'HTTPS', outcome: 'FAILED', errorCode, result: null },
        SITE,
      );

      // A sonda não chegou a avaliar certificado nenhum. A causa já foi
      // relatada pelo alcance; repeti-la aqui inventaria um segundo achado a
      // partir do primeiro.
      expect(item?.secao, `HTTPS/${errorCode}`).toBe('NAO_VERIFICADO');
    }
  });

  it('nenhuma seção fora de ACHADO afirma ausência', () => {
    // As frases que afirmam que algo não existe. Numa linha que significa "não
    // conseguimos olhar", qualquer uma delas é mentira.
    const AFIRMA_AUSENCIA = [/não tem/i, /não possui/i, /está vencido/i, /sem certificado/i];

    const violacoes = traduzidas()
      .filter((p) => p.item.secao !== 'ACHADO')
      .filter((p) => AFIRMA_AUSENCIA.some((frase) => frase.test(p.item.titulo)))
      .map((p) => `${p.entrada.check}/${p.entrada.outcome}/${p.entrada.errorCode}`);

    expect(violacoes).toEqual([]);
  });
});

describe('um problema, uma linha', () => {
  it('as consequências do DNS morto não viram três linhas', () => {
    // Quando o nome não resolve, alcance, HTTPS e cadeia saem SKIPPED·SEM_DNS.
    // Se cada uma virasse item, um domínio vencido apareceria como quatro
    // problemas — e o relatório perde credibilidade quando infla.
    for (const check of ['HTTP_REACHABLE', 'HTTPS', 'REDIRECT_CHAIN'] as const) {
      const item = traduzirChecagem(
        { check, outcome: 'SKIPPED', errorCode: 'SEM_DNS', result: null },
        SITE,
      );
      expect(item, check).toBeNull();
    }
  });

  it('o DNS morto, esse sim, vira achado e nomeia o endereço', () => {
    const item = traduzirChecagem(
      { check: 'DNS', outcome: 'FAILED', errorCode: 'NAO_RESOLVE', result: null },
      SITE,
    );

    expect(item?.secao).toBe('ACHADO');
    expect(item?.titulo).toContain(SITE);
  });
});

describe('recusa nossa não é defeito do cliente', () => {
  it('DESTINO_BLOQUEADO vai para não verificado, mesmo com outcome OK', () => {
    // O domínio resolve, mas para rede interna: nós recusamos conectar. É
    // informação sobre a nossa política de egress, não sobre o site dele.
    const item = traduzirChecagem(
      { check: 'DNS', outcome: 'OK', errorCode: 'DESTINO_BLOQUEADO', result: null },
      SITE,
    );

    expect(item?.secao).toBe('NAO_VERIFICADO');
  });
});

describe('a cadeia de redirect distingue os três estados', () => {
  const cadeia = (result: Record<string, unknown> | null): ItemDoRelatorio | null =>
    traduzirChecagem(
      {
        check: 'REDIRECT_CHAIN',
        outcome: 'OK',
        errorCode: null,
        result: result as ChecagemMedida['result'],
      },
      SITE,
    );

  it('encaminha para https é o comportamento correto', () => {
    expect(cadeia({ saltos: 1, forcaHttps: true })?.secao).toBe('CERTO');
  });

  it('não encaminha é achado', () => {
    expect(cadeia({ saltos: 0, forcaHttps: false })?.secao).toBe('ACHADO');
  });

  it('**campo ausente não é `false`** — é falta de conclusão', () => {
    // O provedor omite `forcaHttps` quando a sonda não foi conclusiva,
    // exatamente para não afirmar que o site aceita tráfego em claro sem ter
    // observado. Ler ausência como `false` desfaria esse cuidado aqui.
    expect(cadeia({ saltos: 0 })?.secao).toBe('NAO_VERIFICADO');
    expect(cadeia(null)?.secao).toBe('NAO_VERIFICADO');
  });
});

describe('as três checagens que nenhum provedor emite', () => {
  it('não produzem texto — nem de achado, nem de ausência', () => {
    // `VIEWPORT_META` e `TITLE_META` exigiriam parsear HTML de terceiro dentro
    // do módulo cujo propósito é conter terceiros; `TTFB` mediria o primeiro
    // salto, ou seja o redirect e não a página. Ver `SITE_CHECKS_V1`.
    for (const check of ['VIEWPORT_META', 'TTFB', 'TITLE_META'] as const) {
      for (const outcome of CHECK_OUTCOMES) {
        expect(
          traduzirChecagem({ check, outcome, errorCode: null, result: null }, SITE),
          `${check}/${outcome}`,
        ).toBeNull();
      }
    }
  });
});

describe('quando uma auditoria pode virar documento', () => {
  // `null` = ainda não rodou; `mock` = o provedor de simulação que a fábrica
  // escolhe quando nada é dito; o terceiro nome é um provedor que ainda não
  // existe — e que por isso mesmo precisa entrar recusado.
  const PROVEDORES = [null, 'mock', 'native', 'provedor-futuro'] as const;

  it('só COMPLETED ou PARTIAL medidos pelo provedor real são emitidos', () => {
    const emitidos: string[] = [];

    for (const status of AUDIT_STATUSES) {
      for (const providerName of PROVEDORES) {
        if (recusaDoRelatorio({ status, providerName }) === null) {
          emitidos.push(`${status}/${providerName}`);
        }
      }
    }

    // O produto cartesiano inteiro, afirmado como lista exata: qualquer
    // combinação a mais é documento emitido que não deveria existir.
    expect(emitidos.sort()).toEqual(['COMPLETED/native', 'PARTIAL/native']);
  });

  it('medição simulada concluída é recusada como SIMULADA', () => {
    // O caso que o ambiente de desenvolvimento produz sempre: a fábrica cai no
    // mock quando `SITE_AUDIT_PROVIDER` não é `native`.
    expect(recusaDoRelatorio({ status: 'COMPLETED', providerName: 'mock' })).toBe('SIMULADA');
    expect(recusaDoRelatorio({ status: 'PARTIAL', providerName: 'mock' })).toBe('SIMULADA');
  });

  it('auditoria cancelada não recebe a promessa de "ainda vai terminar"', () => {
    // A primeira versão da página dizia a uma auditoria cancelada que o
    // relatório apareceria quando a medição concluísse. Não conclui nunca.
    for (const providerName of PROVEDORES) {
      expect(recusaDoRelatorio({ status: 'CANCELLED', providerName })).toBe('CANCELADA');
    }
  });

  it('falha nossa é FALHOU, qualquer que seja o provedor', () => {
    for (const providerName of PROVEDORES) {
      expect(recusaDoRelatorio({ status: 'FAILED', providerName })).toBe('FALHOU');
    }
  });
});
