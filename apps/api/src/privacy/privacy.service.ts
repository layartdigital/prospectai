import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaSistemaService } from '../prisma/prisma-sistema.service';

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
 * **A família 7 pôs política em `audit_logs` em 04/09, e esta previsão se
 * cumpriu.** Com o papel da aplicação, este método enxergaria zero linhas — sem
 * erro nenhum, devolvendo `linhas: 0`, que é indistinguível de "essa pessoa não
 * fez nada". Ele já usa o papel que atravessa tenants desde a fatia 8b, então a
 * migration não mudou uma linha de código aqui.
 *
 * Duas correções ao texto que estava neste lugar:
 *
 * - O papel se chama **`propectai_sistema`**, não `propectai_admin`. O nome
 *   `propectai_admin` nunca existiu no banco; era um rascunho do plano.
 * - `audit_logs.tenantId` é **anulável**, e a `SetNull` do tenant faz linhas
 *   órfãs quando um workspace é apagado. Sob a política, `NULL = <qualquer
 *   coisa>` é `NULL`, que não é `TRUE`: essas linhas ficam invisíveis ao papel
 *   da aplicação em qualquer contexto. Aqui isso não muda nada — este método
 *   varre pelo `actorId` e pelo papel que ignora a política —, e é justamente
 *   por isso que precisa estar escrito: a varredura continua completa, e quem
 *   ler o código pelo lado da aplicação não teria como saber disso.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(private readonly sistema: PrismaSistemaService) {}

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

    const { count } = await this.sistema.atravessandoTenants(
      'eliminar o ator: a pessoa pode ser membro de varios workspaces, e o pedido e dela',
      (db) =>
        db.auditLog.updateMany({
          where: { actorId: userId },
          data: { actorId: null, actorPseudonym: pseudonimo },
        }),
    );

    // O log registra o pseudônimo e a contagem, nunca o `userId` — registrar o
    // id aqui seria recriar, no arquivo de log, exatamente o vínculo que a
    // operação existe para desfazer.
    this.logger.log(`Ator anonimizado em ${count} registro(s) como ${pseudonimo}`);

    return { pseudonimo, linhas: count };
  }
}
