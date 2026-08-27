import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Eliminação de dado pessoal — decisão D4.
 *
 * ---
 *
 * **Este serviço não é escopado por tenant, e é o único assim.**
 *
 * Uma pessoa pode ser membro de vários workspaces, e o pedido de eliminação é
 * dela, não de um deles. Por isso o método abaixo varre `audit_logs` inteiro
 * pelo `actorId`, sem `tenantId` em lugar nenhum — e por isso ele mora num
 * módulo próprio, e não no `AccountService`, onde todo método recebe um tenant.
 *
 * **Consequência para o passo 6 do RLS:** quando a família 7 puser política em
 * `audit_logs`, esta operação passa a enxergar zero linhas com o papel da
 * aplicação. Ela precisará do papel que atravessa tenants — o mesmo
 * `propectai_admin` que o painel administrativo vai exigir. Está anotado no
 * `PLANO-RLS-PASSO6-v1.md`; o que não pode acontecer é descobrir isso quando o
 * método devolver `linhas: 0` sem erro.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Substitui o ator por uma lápide em todo o log de auditoria.
   *
   * O evento, a data e o efeito permanecem; o identificador some. É o que
   * permite ao `AuditLog` continuar respondendo "quem trocou o plano" e "quem
   * suspendeu" — em suporte, em disputa de cobrança e nos eventos de segurança
   * — sem guardar a identidade de quem pediu para ser esquecido.
   *
   * **Não apaga o `User`.** Quem dispara a eliminação, como o pedido se
   * confirma, e se ele remove a conta ou só a desliga são decisões de produto
   * ainda em aberto. Este método é a peça que elas vão usar, e existir antes
   * delas é barato; o contrário não é.
   *
   * **Idempotente por construção.** O `actorId` é anulado no mesmo comando que
   * grava o pseudônimo, então uma segunda chamada não encontra linha nenhuma e
   * não reescreve o rótulo já atribuído. Chamar duas vezes devolve
   * `linhas: 0` na segunda, o que é a resposta certa.
   */
  async anonimizarAtor(userId: string): Promise<{ pseudonimo: string; linhas: number }> {
    // Aleatório, e não derivado do `userId`. Um hash seria reversível por força
    // bruta contra a tabela de usuários — o espaço de busca é o número de
    // contas, não 2^256.
    const pseudonimo = `usuario-removido-${randomBytes(4).toString('hex')}`;

    const { count } = await this.prisma.auditLog.updateMany({
      where: { actorId: userId },
      data: { actorId: null, actorPseudonym: pseudonimo },
    });

    // O log registra o pseudônimo e a contagem, nunca o `userId` — registrar o
    // id aqui seria recriar, no arquivo de log, exatamente o vínculo que a
    // operação existe para desfazer.
    this.logger.log(`Ator anonimizado em ${count} registro(s) como ${pseudonimo}`);

    return { pseudonimo, linhas: count };
  }
}
