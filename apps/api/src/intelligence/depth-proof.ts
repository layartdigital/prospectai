import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Prova de profundidade do Intelligence Explorer.
 *
 * O limite de profundidade (`GRAPH_LIMITS.maxDepth`) e requisito do **servidor**:
 * quem diz em que profundidade um no esta nao pode ser o navegador. A API e sem
 * estado, entao o servidor nao lembra por onde o usuario passou; em vez disso,
 * assina `(tenant, ref, depth)` em cada no que devolve, e exige a assinatura de
 * volta no `GET /intelligence/expand`.
 *
 * - `parentDepth` adulterado (reduzido para escapar do teto) nao bate com a
 *   assinatura e a requisicao e recusada antes de qualquer consulta ao banco.
 * - A assinatura inclui o tenant: prova de outro workspace nao serve.
 * - Inclui o `ref`: prova de um no nao serve para outro.
 * - Chave derivada do segredo de acesso por HMAC com rotulo proprio, para que
 *   esta assinatura nunca possa ser confundida com um JWT nem reutilizada nele.
 *   Rodar o segredo de acesso invalida as provas em circulacao; o efeito para o
 *   usuario e recarregar o grafo.
 *
 * Nao e autorizacao: quem pode ler o no continua decidido por tenant/RLS. A
 * prova so impede que o cliente minta sobre quao fundo ja foi.
 */
export class ProvaDeProfundidade {
  private readonly chave: Buffer;

  constructor(segredo: string) {
    if (!segredo) throw new Error('segredo vazio para a prova de profundidade');
    this.chave = createHmac('sha256', segredo).update('propectai.intelligence.depth.v1').digest();
  }

  assinar(tenantId: string, ref: string, depth: number): string {
    return createHmac('sha256', this.chave)
      .update(`${tenantId}\n${ref}\n${depth}`)
      .digest('base64url')
      .slice(0, 22);
  }

  verificar(tenantId: string, ref: string, depth: number, prova: string): boolean {
    if (!Number.isInteger(depth) || depth < 0) return false;
    const esperada = Buffer.from(this.assinar(tenantId, ref, depth));
    const recebida = Buffer.from(prova ?? '');
    return esperada.length === recebida.length && timingSafeEqual(esperada, recebida);
  }
}
