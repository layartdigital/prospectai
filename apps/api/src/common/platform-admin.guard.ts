import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { RequestWithContext } from './request-context';

/**
 * Acesso ao painel do provedor.
 *
 * Guarda separada do `TenantGuard`, e não uma variação dele. As rotas
 * protegidas aqui enxergam **todos os tenants** por definição, então nenhuma
 * delas pode passar pelo caminho que resolve tenant ativo — misturar os dois
 * significaria que um erro numa comparação de escopo vaza dado entre clientes.
 *
 * A separação é física: tabela própria (`PlatformAdmin`), guarda própria,
 * prefixo de rota próprio (`/admin`). Ser dono de um workspace não dá acesso
 * nenhum aqui, e ser operador da plataforma não dá acesso a workspace algum
 * sem membership.
 *
 * A única forma de virar operador é um registro criado por script, fora da
 * aplicação. Não há tela que promova ninguém — a promoção seria o alvo óbvio.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    if (!request.user) {
      throw new UnauthorizedException('Sessão não encontrada');
    }

    const admin = await this.prisma.platformAdmin.findUnique({
      where: { userId: request.user.id },
    });

    // Mensagem genérica: confirmar que a rota existe já orienta quem procura.
    if (!admin) {
      throw new ForbiddenException('Recurso não disponível');
    }

    return true;
  }
}
