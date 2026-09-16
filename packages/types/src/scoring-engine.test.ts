import { describe, expect, it } from 'vitest';

import { computeScore, type ScoreInput } from './scoring-engine';

/**
 * O motor de score é a peça mais compartilhada do sistema: API, worker e seed
 * usam a mesma função. Um erro aqui aparece em todo lugar ao mesmo tempo.
 */

const base: ScoreInput = {
  websiteStatus: 'SITE_PROPRIO',
  websiteHasHttps: 'PRESENTE',
  hasPhone: false,
  whatsappStatus: 'UNKNOWN',
  email: null,
  reviewCount: null,
  reviewRating: null,
  hasOpenHours: false,
  hasCompleteAddress: false,
  isPriorityNiche: false,
  isServedRegion: false,
  lastContactedAt: null,
  lastEnrichedAt: null,
  isSuppressed: false,
  isPermanentlyClosed: false,
};

const build = (overrides: Partial<ScoreInput>): ScoreInput => ({
  ...base,
  ...overrides,
});

describe('computeScore', () => {
  it('reproduz o exemplo documentado da clínica odontológica', () => {
    // Caso real que motivou a regra de site precário. O concorrente
    // pontuava este lead como 0; ele vale 65.
    // Referência: docs/technical/scoring.md §8
    const result = computeScore(
      build({
        websiteStatus: 'SITE_PRECARIO',
        hasPhone: true,
        whatsappStatus: 'LIKELY',
        reviewCount: 69,
        reviewRating: 5,
        hasOpenHours: true,
        hasCompleteAddress: true,
        isPriorityNiche: true,
        isServedRegion: true,
      }),
    );

    expect(result.value).toBe(65);
    expect(result.level).toBe('MEDIA');
    expect(result.disqualified).toBe(false);
  });

  it('trata site em construtor gratuito como oportunidade, não como resolvido', () => {
    const semSite = computeScore(build({ websiteStatus: 'SEM_SITE' }));
    const precario = computeScore(build({ websiteStatus: 'SITE_PRECARIO' }));
    const proprio = computeScore(build({ websiteStatus: 'SITE_PROPRIO' }));

    expect(semSite.value).toBe(30);
    expect(precario.value).toBe(22);
    expect(proprio.value).toBe(0);

    // O ponto da regra: precário fica muito mais perto de "sem site"
    // do que de "site próprio".
    expect(precario.value - proprio.value).toBeGreaterThan(
      semSite.value - precario.value,
    );
  });

  it('não pontua sinal desconhecido em nenhuma direção', () => {
    const comWhatsapp = computeScore(build({ whatsappStatus: 'LIKELY' }));
    const desconhecido = computeScore(build({ whatsappStatus: 'UNKNOWN' }));

    expect(comWhatsapp.value).toBe(5);
    expect(desconhecido.value).toBe(0);

    // Desconhecido não gera motivo — nem positivo, nem de atenção.
    expect(desconhecido.reasons).toHaveLength(0);
  });

  it('inverte a faixa de avaliações: poucas valem mais que muitas', () => {
    const poucas = computeScore(build({ reviewCount: 5 }));
    const medias = computeScore(build({ reviewCount: 30 }));
    const muitas = computeScore(build({ reviewCount: 300 }));

    expect(poucas.value).toBe(10);
    expect(medias.value).toBe(6);
    expect(muitas.value).toBe(2);

    // Presença digital imatura é quem precisa do serviço. Quem tem 300
    // avaliações provavelmente já tem agência.
    expect(poucas.value).toBeGreaterThan(muitas.value);
  });

  it('desqualifica lead suprimido sem passar pela soma', () => {
    const result = computeScore(
      build({
        websiteStatus: 'SEM_SITE',
        hasPhone: true,
        isPriorityNiche: true,
        isSuppressed: true,
      }),
    );

    expect(result.value).toBe(0);
    expect(result.disqualified).toBe(true);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]?.polarity).toBe('DISQUALIFYING');
  });

  it('desqualifica empresa permanentemente fechada', () => {
    const result = computeScore(
      build({ websiteStatus: 'SEM_SITE', isPermanentlyClosed: true }),
    );

    expect(result.value).toBe(0);
    expect(result.disqualified).toBe(true);
  });

  it('limita o resultado a 100', () => {
    const result = computeScore(
      build({
        websiteStatus: 'SEM_SITE',
        hasPhone: true,
        whatsappStatus: 'LIKELY',
        email: 'contato@empresa.com.br',
        reviewCount: 5,
        reviewRating: 5,
        hasOpenHours: true,
        hasCompleteAddress: true,
        isPriorityNiche: true,
        isServedRegion: true,
      }),
    );

    expect(result.value).toBeLessThanOrEqual(100);
    expect(result.level).toBe('MUITO_ALTA');
  });

  it('não deixa penalidade produzir score negativo', () => {
    const result = computeScore(
      build({
        reviewCount: 40,
        reviewRating: 1.5,
        lastContactedAt: new Date(),
      }),
    );

    expect(result.value).toBe(0);
  });

  it('distingue e-mail em domínio próprio de e-mail gratuito', () => {
    const gratuito = computeScore(build({ email: 'empresa@gmail.com' }));
    const proprio = computeScore(build({ email: 'contato@empresa.com.br' }));

    expect(gratuito.value).toBe(8);
    expect(proprio.value).toBe(10);
  });

  it('grava evidência em todo motivo de site', () => {
    const result = computeScore(build({ websiteStatus: 'SEM_SITE' }));
    const reason = result.reasons.find((item) => item.code === 'NO_WEBSITE');

    // A evidência é o que permite ao usuário discordar de forma produtiva.
    expect(reason?.evidence).toBeTruthy();
  });

  it('respeita as fronteiras das faixas', () => {
    const cases: [number, string][] = [
      [39, 'BAIXA'],
      [40, 'MEDIA'],
      [69, 'MEDIA'],
      [70, 'ALTA'],
      [84, 'ALTA'],
      [85, 'MUITO_ALTA'],
    ];

    for (const [value, level] of cases) {
      const result = computeScore(build({}), {
        weights: { NO_WEBSITE: value },
      });
      const withWebsite = computeScore(
        build({ websiteStatus: 'SEM_SITE' }),
        { weights: { NO_WEBSITE: value } },
      );

      expect(result.value).toBe(0);
      expect(withWebsite.level).toBe(level);
    }
  });

  /**
   * A regra 4 no motor de score — e ela nao tinha teste.
   *
   * O `WEBSITE_NO_HTTPS` pontua quando o site declarado usa `http://`. Antes
   * de 16/09/2026 o campo era `boolean | null` e a regra comparava
   * `=== false`, o que estava correto — **mas nenhum teste cobria o ramo**, e
   * um `if (input.websiteHasHttps)` teria passado despercebido, pontuando o
   * lead que ninguem mediu.
   *
   * Os tres casos vem juntos de proposito. Provar que `AUSENTE` pontua, sem
   * provar que `DESCONHECIDO` nao pontua, deixaria passar exatamente o defeito
   * que a regra 4 existe para impedir: tratar "nao verificado" como "nao tem".
   */
  describe('regra 4 — HTTPS do site', () => {
    const motivos = (entrada: Partial<ScoreInput>): string[] =>
      computeScore(build({ websiteStatus: 'SITE_PROPRIO', ...entrada })).reasons.map(
        (r) => r.code,
      );

    it('AUSENTE pontua: o site declarado usa http://', () => {
      expect(motivos({ websiteHasHttps: 'AUSENTE' })).toContain('WEBSITE_NO_HTTPS');
    });

    it('PRESENTE nao pontua: o site declarado usa https://', () => {
      expect(motivos({ websiteHasHttps: 'PRESENTE' })).not.toContain('WEBSITE_NO_HTTPS');
    });

    it('DESCONHECIDO nao pontua — nao verificado nao e o mesmo que nao tem', () => {
      // Se esta linha reprovar, o motor voltou a tratar ausencia de medicao
      // como medicao negativa, e o lead recebe pontos que ninguem apurou.
      expect(motivos({ websiteHasHttps: 'DESCONHECIDO' })).not.toContain('WEBSITE_NO_HTTPS');
    });
  });
});
