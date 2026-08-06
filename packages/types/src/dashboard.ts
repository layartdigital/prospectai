export interface DashboardKpis {
  leadsFound: number;
  leadsThisMonth: number;
  highOpportunities: number;
  pipelineActive: number;
  averageScore: number;
  /**
   * SEM_SITE + SITE_PRECARIO.
   *
   * Contar só quem não tem site nenhum esconde metade da oportunidade:
   * um negócio com página em construtor gratuito é prospect tão bom quanto.
   */
  withoutOwnWebsite: number;
  withoutWebsite: number;
  poorWebsite: number;
  likelyWhatsapp: number;
  pendingFollowUps: number;
  overdueFollowUps: number;
}

export interface DashboardSearch {
  id: string;
  niche: string;
  city: string;
  stateUf: string;
  leadsFound: number;
  status: string;
  createdAt: string;
}

export interface DashboardFunnelStage {
  slug: string;
  name: string;
  color: string;
  count: number;
}

export interface DashboardResponse {
  kpis: DashboardKpis;
  recentSearches: DashboardSearch[];
  funnel: DashboardFunnelStage[];
}
