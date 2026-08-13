/** Item de busca na taxonomia. Enxuto de propósito: são 500. */
export interface SegmentOption {
  id: string;
  externalId: string;
  macroSegment: string;
  name: string;
  specialty: string | null;
}

/** Segmento completo, com o que ele pré-preenche no onboarding. */
export interface SegmentDetail extends SegmentOption {
  services: string[];
  targetSectors: string[];
  opportunitySignals: string[];
  painPoints: string | null;
  contractModel: string | null;
  recurrence: string | null;
  /** Termos de busca no locale pedido, quando existirem. */
  searchTerms: string[];
  searchTermsStatus: 'GERADO' | 'VALIDADO' | 'CURADO' | null;
  /**
   * Id do `SegmentLocale`, não do `Segment`.
   *
   * É o que a busca envia para creditar o resultado ao termo certo — validar
   * pelo id do segmento misturaria o veredito de idiomas diferentes.
   */
  searchTermsLocaleId: string | null;
}

export interface SegmentSearchResult {
  items: SegmentOption[];
  total: number;
  macroSegments: { name: string; count: number }[];
}
