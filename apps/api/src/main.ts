import 'reflect-metadata';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const port = Number(config.get('API_PORT') ?? 3101);
  const webOrigin = config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3100';

  // Prefixo obrigatorio em toda a API.
  app.setGlobalPrefix('api/v1');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());

  // CORS restrito: apenas a origem do front, com credenciais para o
  // refresh token em cookie HttpOnly.
  app.enableCors({
    origin: [webOrigin],
    credentials: true,
  });

  // Validacao global. whitelist + forbidNonWhitelisted protegem contra
  // mass assignment: campo nao declarado no DTO e rejeitado, nao ignorado.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PropectAI API')
    .setDescription(
      'API da plataforma de prospeccao de clientes locais. ' +
        'Todos os endpoints de negocio exigem tenant ativo resolvido por sessao. ' +
        'O tenantId enviado no corpo da requisicao e sempre ignorado.',
    )
    .setVersion('0.1.1')
    .addBearerAuth()
    // Um addTag por modulo, na ordem em que a pessoa encontra o produto:
    // entra, busca, trabalha o lead, move o funil, aborda, acompanha, cobra.
    // Sem isto o Swagger agrupa tudo em "default" e a ordem vira a de
    // registro dos controllers, que nao significa nada para quem le.
    .addTag('system', 'Saude e versao da aplicacao')
    .addTag('auth', 'Cadastro, sessao e refresh de token')
    .addTag('account', 'Assinatura, preferencias e onboarding do tenant')
    .addTag('dashboard', 'Indicadores da visao geral, calculados por query')
    .addTag('prospecting', 'Buscas no motor de coleta, cota e acompanhamento')
    .addTag('leads', 'Leads, score, contatos, follow-ups e atividades')
    .addTag('pipeline', 'Etapas do funil e movimentacao de cards')
    .addTag('ai', 'Geracao de abordagem. Nada e enviado automaticamente')
    .addTag('notifications', 'Avisos do tenant e marcacao de leitura')
    .addTag('proposals', 'Propostas, itens e contratos')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // Sem host explicito de proposito.
  //
  // Fixar '0.0.0.0' liga o socket so em IPv4. O fetch do Node 18+ resolve
  // "localhost" preferindo ::1 (IPv6) no Windows, o que resulta em
  // ECONNREFUSED mesmo com a API no ar - e o Server Component do rodape
  // reporta "API inacessivel". Sem o segundo argumento, o Express escuta
  // em dual-stack e os dois caminhos funcionam.
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '  PropectAI API v0.1.1',
      `  Rodando   http://localhost:${port}/api/v1`,
      `  Swagger   http://localhost:${port}/api/docs`,
      '',
    ].join('\n'),
  );
}

void bootstrap();
