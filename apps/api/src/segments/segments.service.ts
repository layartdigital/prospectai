import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  SegmentDetail,
  SegmentSearchResult,
} from '@propectai/types';

import { GeminiAIProvider } from '../outreach/providers/gemini-ai.provider';
import { PrismaService } from '../prisma/prisma.service';

/** Teto da listagem. 500 itens de uma vez não cabem em nenhuma interface útil. */
const MAX_RESULTADOS = 40;

@Injectable()
export class SegmentsService {
  private readonly logger = new Logger(SegmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiAIProvider,
  ) {}

  /**
   * Busca na taxonomia.
   *
   * Por texto, por macro-segmento, ou os dois. Sem filtro devolve os primeiros
   * 40 em ordem alfabética — porque uma lista suspensa com 500 itens é uma
   * lista que ninguém usa.
   */
  async search(params: {
    q?: string;
    macroSegment?: string;
  }): Promise<SegmentSearchResult> {
    const where = {
      isActive: true,
      ...(params.macroSegment ? { macroSegment: params.macroSegment } : {}),
      ...(params.q
        ? {
            OR: [
              { name: { contains: params.q, mode: 'insensitive' as const } },
              { specialty: { contains: params.q, mode: 'insensitive' as const } },
              { macroSegment: { contains: params.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total, macros] = await Promise.all([
      this.prisma.segment.findMany({
        where,
        orderBy: [{ macroSegment: 'asc' }, { name: 'asc' }],
        take: MAX_RESULTADOS,
        select: {
          id: true,
          externalId: true,
          macroSegment: true,
          name: true,
          specialty: true,
        },
      }),
      this.prisma.segment.count({ where }),
      this.prisma.segment.groupBy({
        by: ['macroSegment'],
        where: { isActive: true },
        _count: true,
        orderBy: { macroSegment: 'asc' },
      }),
    ]);

    return {
      items,
      total,
      macroSegments: macros.map((macro) => ({
        name: macro.macroSegment,
        count: macro._count,
      })),
    };
  }

  /**
   * Detalhe de um segmento, com os termos de busca do locale pedido.
   *
   * Locale ausente devolve `searchTerms` vazio, e não os termos em português.
   * Devolver o termo errado seria pior: a busca sairia com "agência de
   * marketing digital em Milano" e voltaria vazia, e o cliente concluiria que
   * o produto não funciona no país dele.
   */
  async detail(
    id: string,
    locale = 'pt-BR',
    country = 'BR',
  ): Promise<SegmentDetail> {
    const segment = await this.prisma.segment.findFirst({
      where: { id, isActive: true },
      include: {
        locales: { where: { locale } },
      },
    });

    if (!segment) throw new NotFoundException('Segmento não encontrado');

    let traducao = segment.locales[0];

    // Geração sob demanda, e não em lote.
    //
    // 500 segmentos vezes o número de idiomas geraria milhares de chamadas,
    // e a maioria nunca seria usada — ninguém prospecta em todos os setores
    // de todos os países. Gerar quando o primeiro tenant de um país abre o
    // segmento custa uma chamada e resolve para todos os seguintes.
    if (!traducao && locale !== 'pt-BR' && this.gemini.configurado) {
      traducao = (await this.gerarLocale(segment, locale, country)) ?? traducao;
    }

    return {
      id: segment.id,
      externalId: segment.externalId,
      macroSegment: segment.macroSegment,
      name: traducao?.label ?? segment.name,
      specialty: segment.specialty,
      services: segment.services,
      targetSectors: segment.targetSectors,
      opportunitySignals: segment.opportunitySignals,
      painPoints: segment.painPoints,
      contractModel: segment.contractModel,
      recurrence: segment.recurrence,
      searchTerms: traducao?.searchTerms ?? [],
      searchTermsStatus: traducao?.status ?? null,
      searchTermsLocaleId: traducao?.id ?? null,
    };
  }

  /**
   * Gera e persiste os termos de um segmento num locale novo.
   *
   * Nasce como `GERADO`, nunca como `CURADO`. A diferença não é burocrática:
   * termo gerado por modelo pode ser plausível e inútil — uma expressão que
   * ninguém usa devolve busca vazia, e o cliente conclui que o produto não
   * funciona no país dele, não que faltou validar um campo.
   *
   * A promoção para `VALIDADO` acontece no worker, ao fim da primeira busca
   * que usar o termo: `registrarVeredito` conta os resultados brutos e decide.
   * Até lá a interface mostra o estado de forma explícita, em vez de tratar o
   * gerado como definitivo.
   *
   * Falha não propaga: sem termos, a busca continua funcionando com o que a
   * pessoa digitar. Derrubar a tela do segmento porque a IA não respondeu
   * seria trocar uma limitação por um defeito.
   */
  private async gerarLocale(
    segment: {
      id: string;
      name: string;
      macroSegment: string;
      specialty: string | null;
      services: string[];
    },
    locale: string,
    country: string,
  ) {
    try {
      const origem = await this.prisma.segmentLocale.findUnique({
        where: { segmentId_locale: { segmentId: segment.id, locale: 'pt-BR' } },
      });

      const gerado = await this.gemini.gerarTermosLocais({
        segmentName: segment.name,
        macroSegment: segment.macroSegment,
        specialty: segment.specialty,
        services: segment.services,
        sourceTerms: origem?.searchTerms ?? [],
        locale,
        country,
      });

      // Lista vazia também é gravada. O modelo foi instruído a devolver vazio
      // quando não souber, e persistir isso evita repetir a chamada a cada
      // abertura do segmento para descobrir a mesma coisa.
      return await this.prisma.segmentLocale.create({
        data: {
          segmentId: segment.id,
          locale,
          country,
          label: gerado.label,
          searchTerms: gerado.searchTerms,
          status: 'GERADO',
        },
      });
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Não foi possível gerar termos de ${segment.name} em ${locale}: ${motivo}`,
      );
      return null;
    }
  }
}
