import type {
  AuditStatusName,
  CheckOutcomeName,
  MedicaoValor,
  SiteCheckName,
} from './site-audit';

/**
 * A traducao do relatorio de diagnostico — de vocabulario de maquina para o que
 * o dono do negocio auditado le.
 *
 * O texto integral, com a razao de cada frase, esta em
 * `docs/technical/RELATORIO-DIAGNOSTICO-v1.md`. Este arquivo e aquele documento
 * executavel; se os dois divergirem, **o documento manda**, porque foi ele que
 * o dono do projeto revisou.
 *
 * ---
 *
 * **Por que isto vive em `@propectai/types` e nao no `apps/web`.**
 *
 * Duas razoes, e a segunda pesa mais. A primeira e que ja ha precedente:
 * `SCORE_LEVEL_LABELS` mora aqui. A segunda e que **aqui existe runner de
 * teste** — a web so tem Playwright, e a regra 4 aplicada a um documento de
 * venda precisa de guarda rapido e deterministico, nao de navegador.
 *
 * ---
 *
 * **A regra que este modulo existe para tornar impossivel de violar.**
 *
 * `CLAUDE.md` regra 4: *"Ausencia de sinal e DESCONHECIDO, nunca AUSENTE."*
 *
 * Num documento de venda a tentacao e converter tudo em achado, porque achado
 * vende. Mas `SKIPPED` nao e reprovacao do site do cliente — e informacao sobre
 * a nossa execucao, e o proprio schema diz isso no `CheckOutcome`. Dizer "seu
 * site nao tem certificado" quando a sonda nem chegou a olhar e afirmar o
 * contrario do que se observou.
 *
 * Por isso a classificacao em tres secoes nao e enfeite de layout: **e a
 * regra**. O que nao foi possivel verificar tem secao propria, com o mesmo peso
 * visual — e e ela que torna o resto crivel. Um relatorio que so traz problemas
 * parece peca de venda; um que diz o que nao conseguiu medir parece medicao.
 */

export type SecaoDoRelatorio =
  /** O site reprovou, e a causa e atribuivel a ele. */
  | 'ACHADO'
  /** Medimos e esta correto. */
  | 'CERTO'
  /** Nao foi possivel concluir — informacao sobre a nossa execucao. */
  | 'NAO_VERIFICADO';

export interface ItemDoRelatorio {
  readonly secao: SecaoDoRelatorio;
  /** O que o cliente le. Frase inteira, ja com o site interpolado. */
  readonly titulo: string;
  /** A consequencia para o negocio. Nulo quando nao ha nada a dizer. */
  readonly porQueImporta: string | null;
  /** A acao. Nulo quando nao ha acao do lado dele. */
  readonly oQueFazer: string | null;
}

/** O minimo de uma checagem medida que a traducao precisa. */
export interface ChecagemMedida {
  readonly check: SiteCheckName;
  readonly outcome: CheckOutcomeName;
  readonly errorCode: string | null;
  readonly result: Readonly<Record<string, MedicaoValor>> | null;
}

/**
 * Codigos de transporte que significam **"nao chegamos a olhar"**.
 *
 * A distincao entre esta lista e o resto e o coracao do modulo, e ela nao e a
 * mesma em todas as checagens:
 *
 * - no `HTTP_REACHABLE`, conexao recusada **e** o achado: o endereco existe e o
 *   servico que entrega o site esta parado;
 * - no `HTTPS`, a mesma recusa significa que a sonda nao avaliou certificado
 *   nenhum. A causa ja foi reportada pelo alcance, e repeti-la aqui como
 *   "nao tem certificado" seria inventar um segundo achado a partir do
 *   primeiro.
 */
const FALHA_DE_CONEXAO = new Set([
  'TIMEOUT',
  'CONEXAO_RECUSADA',
  'CONEXAO_PERDIDA',
  'REDE_INALCANCAVEL',
  'RESPOSTA_INVALIDA',
  'DESCONHECIDO',
]);

/** Le um campo do `result` sem confiar no formato. */
function valor(c: ChecagemMedida, chave: string): MedicaoValor | undefined {
  return c.result?.[chave];
}

/**
 * Traduz uma checagem.
 *
 * Devolve `null` quando o item **nao deve aparecer no relatorio** — e isso e
 * tao importante quanto o texto. Quando o DNS falha, as outras tres saem
 * `SKIPPED · SEM_DNS`; se cada uma virasse linha, um dominio vencido apareceria
 * como quatro problemas. **Um problema, uma linha:** o relatorio perde
 * credibilidade quando infla.
 */
export function traduzirChecagem(
  c: ChecagemMedida,
  site: string,
): ItemDoRelatorio | null {
  // Consequencia de outra checagem, ja relatada la. Nao repetir.
  if (c.errorCode === 'SEM_DNS' || c.errorCode === 'SEM_RESPOSTA') return null;

  const item = despachar(c, site);

  /**
   * **A rede de seguranca da regra 4, e ela existe porque a vigilancia falhou.**
   *
   * Cada funcao abaixo ja sabe que `SKIPPED` nao e achado. Mesmo assim, a
   * primeira execucao do teste que percorre o produto cartesiano encontrou
   * `DNS / SKIPPED / NAO_RESOLVE` produzindo a frase mais grave do relatorio —
   * porque o ramo olhava o codigo antes do desfecho.
   *
   * Nenhum provedor emite essa combinacao hoje. **Isso nao e defesa**: e a
   * descricao de um acidente que ainda nao aconteceu. Confiar em cada ramo
   * lembrar-se da regra e confiar em vigilancia; esta linha a torna verdadeira
   * por construcao.
   *
   * Devolve `null` e nao a secao corrigida de proposito: o texto foi escrito
   * para afirmar um achado, e move-lo para "nao verificado" entregaria a frase
   * errada na secao certa. **Silencio e melhor que frase errada.**
   */
  if (item !== null && c.outcome === 'SKIPPED' && item.secao === 'ACHADO') {
    return null;
  }

  return item;
}

function despachar(c: ChecagemMedida, site: string): ItemDoRelatorio | null {
  switch (c.check) {
    case 'DNS':
      return dns(c, site);
    case 'HTTP_REACHABLE':
      return alcance(c, site);
    case 'HTTPS':
      return https(c);
    case 'REDIRECT_CHAIN':
      return cadeia(c);
    default:
      // `VIEWPORT_META`, `TTFB` e `TITLE_META` estao no enum e nenhum provedor
      // os produz — ver `SITE_CHECKS_V1`. Se um deles comecar a chegar aqui, o
      // relatorio o ignora ate alguem escrever o texto, que e melhor que
      // inventa-lo no lugar.
      return null;
  }
}

function dns(c: ChecagemMedida, site: string): ItemDoRelatorio | null {
  // **O desfecho manda, e o codigo qualifica** — nunca o contrario. Ler o
  // codigo primeiro foi o que produziu "o endereco nao existe" a partir de uma
  // medicao que nao aconteceu.
  if (c.outcome === 'FAILED' && c.errorCode === 'NAO_RESOLVE') {
    return {
      secao: 'ACHADO',
      titulo: `O endereço ${site} não existe na internet hoje. Quem digitar esse endereço não chega a lugar nenhum.`,
      porQueImporta:
        'Este é o achado mais grave da lista, e o mais invisível de dentro: um domínio expira em silêncio, e a empresa só descobre quando alguém avisa. Todo cartão, panfleto, anúncio e assinatura de e-mail que traz esse endereço está mandando o cliente para o vazio.',
      oQueFazer:
        'Verificar com quem registrou o domínio se ele está vencido. Se estiver, renovar costuma resolver em horas. Se não estiver, é configuração de DNS.',
    };
  }

  if (c.errorCode === 'DESTINO_BLOQUEADO') {
    // Recusa nossa, nao defeito dele. Nunca vai para ACHADO.
    return {
      secao: 'NAO_VERIFICADO',
      titulo:
        'Não foi possível verificar este endereço. Ele aponta para uma rede interna, e nossa verificação não acessa endereços desse tipo.',
      porQueImporta: null,
      oQueFazer: null,
    };
  }

  // **Só declara "está ativo" quando a checagem foi OK.** Um `FAILED` com
  // codigo que ninguem previu cairia aqui e afirmaria o contrario do que se
  // mediu — o defeito exato que este modulo existe para impedir.
  if (c.outcome !== 'OK') return null;

  return {
    secao: 'CERTO',
    titulo: 'O endereço do site da sua empresa está ativo e responde na internet.',
    porQueImporta: null,
    oQueFazer: null,
  };
}

function alcance(c: ChecagemMedida, site: string): ItemDoRelatorio | null {
  if (c.outcome === 'OK') {
    return {
      secao: 'CERTO',
      titulo: 'O site da sua empresa abre normalmente.',
      porQueImporta: null,
      oQueFazer: null,
    };
  }

  if (c.outcome === 'SKIPPED') {
    // 4xx e companhia: pode ser protecao contra robos, pode ser pagina ausente.
    // Afirmar que o site esta quebrado aqui seria inventar um achado.
    return {
      secao: 'NAO_VERIFICADO',
      titulo:
        'Não foi possível concluir a verificação: o servidor respondeu de uma forma que não permite afirmar se a página abre para um visitante comum. Muitos sites bloqueiam verificações automáticas, e isso por si só não é defeito.',
      porQueImporta: null,
      oQueFazer: 'Abrir o endereço no navegador e ver com os próprios olhos.',
    };
  }

  if (c.errorCode === 'ERRO_DO_SERVIDOR') {
    const status = valor(c, 'status');
    const codigo = typeof status === 'number' ? ` (código ${status})` : '';
    return {
      secao: 'ACHADO',
      titulo: `O site está no ar, mas devolveu um erro ao ser aberto${codigo}. Quem visitar agora vê uma página de erro em vez do conteúdo da sua empresa.`,
      porQueImporta:
        'É pior que estar fora do ar, porque parece descuido em vez de acidente. E como o servidor responde, ferramentas de monitoramento simples não acusam.',
      oQueFazer:
        'Falar com quem hospeda o site. Erro desse tipo é do servidor, não da internet do visitante.',
    };
  }

  if (c.errorCode === 'PAGINA_NAO_ENCONTRADA') {
    // 404 ou 410: o servidor respondeu, e a resposta foi "nao existe". Desde
    // 21/09/2026 o provedor classifica isso como FAILED — ver `classificar()`
    // no `native.provider.ts`, e o caso wixsite que motivou a mudanca.
    return {
      secao: 'ACHADO',
      titulo: `O endereço ${site} responde, mas leva a uma página que não existe. Quem visita vê uma página de erro no lugar do site da empresa.`,
      porQueImporta:
        'Costuma acontecer quando o site foi desativado, nunca chegou a ser publicado ou mudou de endereço. O endereço continua de pé, e o cartão, o anúncio e o perfil no Google seguem mandando gente para uma página de erro.',
      oQueFazer:
        'Verificar com quem cuida do site se ele está publicado. Se o site mudou de endereço, atualizar o endereço divulgado — a começar pelo perfil no Google.',
    };
  }

  if (c.errorCode === 'REDIRECT_PARA_DESTINO_QUEBRADO') {
    return {
      secao: 'ACHADO',
      titulo: `O endereço ${site} redireciona o visitante para outro lugar, e esse outro lugar não abre. O caminho começa certo e termina quebrado.`,
      porQueImporta:
        'É a falha mais difícil de perceber de dentro: quem já tem o site salvo em favoritos pode não passar pelo redirecionamento. Quem chega pela primeira vez, passa.',
      oQueFazer: 'Verificar para onde o endereço está redirecionando.',
    };
  }

  if (c.errorCode === 'TIMEOUT') {
    return {
      secao: 'ACHADO',
      titulo:
        'O site da sua empresa não respondeu no tempo da nossa verificação. Ou está fora do ar, ou está lento a ponto de o visitante desistir antes de ver a primeira tela.',
      porQueImporta:
        'As duas hipóteses custam visita, e o visitante não distingue uma da outra — ele fecha a aba.',
      oQueFazer:
        'Abrir o site pelo celular, com dados móveis, fora da rede da empresa. Se abrir rápido aí, a suspeita é intermitência; se demorar, é o servidor.',
    };
  }

  if (c.errorCode !== null && FALHA_DE_CONEXAO.has(c.errorCode)) {
    // Aqui a recusa de conexao **e** o achado: o endereco existe e o servico
    // que entrega o site nao atende.
    return {
      secao: 'ACHADO',
      titulo:
        'O endereço do site existe, mas não aceitou a conexão. Normalmente significa que o serviço que entrega o site está parado.',
      porQueImporta:
        'O domínio está pago e o site não está no ar. Costuma ser hospedagem vencida ou serviço derrubado.',
      oQueFazer: 'Falar com quem hospeda.',
    };
  }

  // Codigo que ninguem previu. Silencio e melhor que frase inventada.
  return null;
}

function https(c: ChecagemMedida): ItemDoRelatorio | null {
  if (c.outcome === 'OK') {
    return {
      secao: 'CERTO',
      titulo:
        'O site da sua empresa tem certificado de segurança válido. O navegador mostra o cadeado.',
      porQueImporta: null,
      oQueFazer: null,
    };
  }

  if (c.outcome === 'SKIPPED') {
    return {
      secao: 'NAO_VERIFICADO',
      titulo: 'Não foi possível verificar o certificado de segurança.',
      porQueImporta: null,
      oQueFazer: null,
    };
  }

  /**
   * **A linha que a regra 4 protege.**
   *
   * Sem esta condicao, um `TIMEOUT` no `HTTPS` viraria "seu site nao tem
   * certificado" — e o provedor tem um comentario inteiro sobre esse erro,
   * cometido e corrigido: *"afirmar o contrario do que se observou e pior que
   * nao afirmar nada."*
   */
  if (c.errorCode !== null && FALHA_DE_CONEXAO.has(c.errorCode)) {
    return {
      secao: 'NAO_VERIFICADO',
      titulo:
        'Não foi possível verificar o certificado de segurança, porque não houve resposta.',
      porQueImporta: null,
      oQueFazer: null,
    };
  }

  if (c.errorCode === 'TLS_CERTIFICADO_EXPIRADO') {
    return {
      secao: 'ACHADO',
      titulo:
        'O certificado de segurança do site está vencido. O navegador exibe um aviso vermelho de "sua conexão não é particular" antes de qualquer conteúdo aparecer — e a maioria das pessoas volta nesse momento.',
      porQueImporta:
        'É concreto, verificável em dez segundos por quem recebe este relatório, e tem consequência imediata na visita. Também tem prazo: certificado vencido não melhora sozinho.',
      oQueFazer:
        'Renovar o certificado com quem hospeda. Hoje a maioria das hospedagens emite gratuitamente e renova sozinha — se venceu, a renovação automática está desligada ou falhou.',
    };
  }

  if (c.errorCode === 'TLS_NOME_NAO_CONFERE') {
    return {
      secao: 'ACHADO',
      titulo:
        'O site tem certificado de segurança, mas ele foi emitido para outro endereço. Para o navegador, isso é o mesmo que não ter: o aviso de risco aparece igual.',
      porQueImporta:
        'É o caso em que a empresa tem certificado e jura que está tudo certo — e está, só que não para o endereço que ela divulga.',
      oQueFazer:
        'Pedir a quem hospeda a emissão do certificado para o endereço correto, com e sem www.',
    };
  }

  if (c.errorCode === 'TLS_AUTOASSINADO' || c.errorCode === 'TLS_INVALIDO') {
    return {
      secao: 'ACHADO',
      titulo:
        'O certificado do site não é reconhecido pelos navegadores, e o visitante vê um aviso de segurança antes do conteúdo.',
      porQueImporta: 'Mesmo efeito prático de um certificado vencido.',
      oQueFazer:
        'Substituir por um certificado emitido por autoridade reconhecida — gratuito na maioria das hospedagens.',
    };
  }

  if (c.errorCode === 'SEM_HTTPS') {
    return {
      secao: 'ACHADO',
      titulo:
        'O site da sua empresa não tem certificado de segurança. Navegadores marcam endereços assim como "Não seguro" na barra de endereço, e buscadores tratam isso como sinal negativo.',
      porQueImporta:
        'É um selo de desatualização visível para qualquer visitante, permanente e gratuito de resolver.',
      oQueFazer: 'Ativar o certificado gratuito na hospedagem.',
    };
  }

  return null;
}

function cadeia(c: ChecagemMedida): ItemDoRelatorio | null {
  if (c.outcome !== 'OK') {
    return {
      secao: 'NAO_VERIFICADO',
      titulo:
        'Não foi possível concluir se o endereço sem "https" encaminha para a versão segura.',
      porQueImporta: null,
      oQueFazer: null,
    };
  }

  const forca = valor(c, 'forcaHttps');

  if (forca === true) {
    return {
      secao: 'CERTO',
      titulo:
        'Quem digita o endereço da sua empresa sem "https" é levado automaticamente para a versão segura.',
      porQueImporta: null,
      oQueFazer: null,
    };
  }

  if (forca === false) {
    return {
      secao: 'ACHADO',
      titulo:
        'Quem digita o endereço sem "https" continua navegando na versão sem proteção — o site não o leva para a versão segura.',
      porQueImporta:
        'Ter certificado e não encaminhar é ter a porta trancada com a chave na fechadura: existe proteção, e o visitante comum nunca passa por ela.',
      oQueFazer:
        'Pedir à hospedagem o redirecionamento permanente de http para https. É configuração, não desenvolvimento.',
    };
  }

  // `forcaHttps` ausente significa que a sonda nao foi conclusiva. O provedor
  // omite o campo exatamente para nao afirmar `false` sem ter observado.
  return {
    secao: 'NAO_VERIFICADO',
    titulo:
      'Não foi possível concluir se o endereço sem "https" encaminha para a versão segura.',
    porQueImporta: null,
    oQueFazer: null,
  };
}

/**
 * Por que uma auditoria **nao** pode virar relatorio.
 *
 * - `FALHOU` — nos nao conseguimos medir. Defeito nosso, e o credito volta.
 * - `CANCELADA` — nao vai terminar nunca.
 * - `EM_ANDAMENTO` — vai terminar; o relatorio aparece quando terminar.
 * - `SIMULADA` — terminou, mas quem mediu foi o provedor de simulacao.
 */
export type RecusaDoRelatorio = 'FALHOU' | 'CANCELADA' | 'EM_ANDAMENTO' | 'SIMULADA';

/** Um item traduzido, com a checagem de origem preservada. */
export interface LinhaDoRelatorio {
  readonly check: SiteCheckName;
  readonly item: ItemDoRelatorio;
}

/**
 * Checagens cujo "esta correto" so significa alguma coisa se a pagina abriu.
 *
 * Certificado valido e redirecionamento para https sao propriedades do
 * **endereco**, nao do site. Numa plataforma que responde por qualquer nome, o
 * certificado e o da plataforma e o redirect tambem — os dois saem certos para
 * um site que nao existe. O DNS fica de fora da lista: "o endereco esta ativo"
 * e verdade nesses casos e ajuda o leitor a localizar o problema (o dominio
 * esta pago; o que falta e a pagina).
 */
const SO_VALEM_COM_PAGINA: ReadonlySet<SiteCheckName> = new Set(['HTTPS', 'REDIRECT_CHAIN']);

/**
 * O relatorio inteiro, e nao checagem por checagem.
 *
 * `traduzirChecagem` olha uma checagem de cada vez, e e isso que o torna
 * testavel no produto cartesiano. Mas ha uma regra que so existe no conjunto, e
 * ela apareceu no primeiro relatorio emitido com medicao real: um subdominio
 * `wixsite.com` saiu com **tres itens em "O que esta correto"** — endereco
 * ativo, certificado valido, redirect para https — e a pagina respondia 404.
 * Cada frase era verdadeira; juntas diziam que o site estava bem.
 *
 * A regra: **quando a pagina nao foi vista abrindo, certificado e redirect nao
 * entram como "certo".** Saem, nao mudam de secao — sao medicoes corretas
 * sobre a coisa errada, e move-las para outro lugar seria inventar um texto que
 * ninguem escreveu. Silencio e melhor que frase errada, de novo.
 *
 * So remove itens `CERTO`. Achado e "nao verificado" nunca saem por esta regra:
 * esconder um problema ou um limite da nossa medicao e o defeito oposto, e pior.
 */
export function montarRelatorio(
  checks: readonly ChecagemMedida[],
  site: string,
): LinhaDoRelatorio[] {
  // Estrito: sem a checagem de alcance, tambem nao sabemos se a pagina abre.
  const paginaAbriu = checks.some((c) => c.check === 'HTTP_REACHABLE' && c.outcome === 'OK');

  return checks
    .map((c) => ({ check: c.check, item: traduzirChecagem(c, site) }))
    .filter((l): l is LinhaDoRelatorio => l.item !== null)
    .filter(
      (l) => paginaAbriu || l.item.secao !== 'CERTO' || !SO_VALEM_COM_PAGINA.has(l.check),
    );
}

/**
 * **A decisao de emitir ou nao o documento, num lugar so.**
 *
 * Ela existia em dois: na pagina `/relatorio/:auditId`, que se recusa a
 * renderizar, e no card da ficha, que decide se mostra o link. Duas copias da
 * mesma condicao divergem no primeiro refactor — e a divergencia tem sintoma
 * ruim nas duas direcoes: link que leva a recusa, ou documento sem caminho ate
 * ele.
 *
 * Mora aqui pelo mesmo motivo da traducao: **aqui existe runner de teste**. A
 * web so tem Playwright, e um e2e que pede auditoria consome o unico diagnostico
 * do mes do FREE — passaria na primeira rodada e bateria no limite do plano na
 * segunda.
 *
 * ---
 *
 * **`CANCELADA` e separada de `EM_ANDAMENTO` porque o texto de cada uma promete
 * coisas diferentes.** A primeira versao da pagina tratava tudo que nao era
 * concluido como "ainda nao terminou — o relatorio aparece aqui assim que a
 * medicao concluir". Para uma auditoria cancelada isso e uma promessa que nunca
 * se cumpre. Apareceu ao desenhar o teste que percorre todos os estados, antes
 * de chegar a tela.
 *
 * Devolve `null` quando o relatorio **pode** ser emitido.
 */
export function recusaDoRelatorio(auditoria: {
  readonly status: AuditStatusName;
  readonly providerName: string | null;
}): RecusaDoRelatorio | null {
  switch (auditoria.status) {
    case 'FAILED':
      return 'FALHOU';
    case 'CANCELLED':
      return 'CANCELADA';
    case 'REQUESTED':
    case 'QUEUED':
    case 'RUNNING':
      return 'EM_ANDAMENTO';
    case 'COMPLETED':
    case 'PARTIAL':
      // Igualdade estrita com o nome do provedor real, e nao "diferente de
      // mock": um terceiro provedor que venha a existir entra recusado ate
      // alguem decidir de proposito que a medicao dele vale documento.
      return auditoria.providerName === 'native' ? null : 'SIMULADA';
  }
}
