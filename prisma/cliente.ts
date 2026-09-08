import { PrismaClient } from '@prisma/client';

/**
 * Client dos scripts de `prisma/` — seed, planos, cotas, segmentos, admin.
 *
 * Criado em 04/09/2026, fechando o item que todas as migrations de RLS vinham
 * anotando como pendente.
 *
 * ---
 *
 * **O problema: os cinco scripts usavam `new PrismaClient()`.**
 *
 * Isso conecta pelo `DATABASE_URL`, que e o **dono** do banco. Eles escrevem em
 * 34 tabelas sob politica sem declarar contexto de tenant nenhum — e funcionam
 * porque o dono, na configuracao atual, e superusuario, e superusuario ignora
 * RLS mesmo com `FORCE`.
 *
 * As migrations das familias 2, 5 e 7 registraram isso com a mesma frase:
 * **"continua sendo sorte estrutural e nao desenho"**. No dia em que o dono
 * deixar de ser superusuario — o que e a configuracao correta para producao —
 * o `pnpm db:seed` passaria a afetar **zero linhas, sem erro**, e o sintoma
 * seria um banco de demonstracao vazio sem nada ter falhado.
 *
 * **A troca aqui converte sorte em desenho.** O `propectai_migrator` tem
 * `BYPASSRLS` concedido de proposito, na `20260826230000_rls_papeis`, com esta
 * justificativa: "com FORCE ligado, ate o dono da tabela fica sujeito a
 * politica — e uma migration de dado passa a afetar zero linhas **sem erro**".
 * E exatamente a garantia que estes scripts precisam.
 *
 * ---
 *
 * **⚠ O nome `propectai_migrator` engana, e vale saber antes de confiar nele.**
 *
 * **Ele nao roda migration nenhuma.** Foi conferido: nao existe
 * `GRANT CREATE ON SCHEMA public` para papel algum nas migrations de papeis.
 * DDL e do dono, e continua sendo — `prisma migrate` conecta pelo
 * `DATABASE_URL`.
 *
 * O que o papel tem e `ALL` nas tabelas e nas sequencias, mais `BYPASSRLS`. Em
 * uma frase: **e o papel de escrita administrativa que atravessa a politica**,
 * nao o de migration. Renomea-lo custaria uma migration mexendo num papel
 * referenciado por tres variaveis de ambiente e pelo CI; o nome fica, e a
 * leitura errada fica registrada aqui.
 *
 * ---
 *
 * **A queda e em voz alta**, mesmo padrao do `criarPrismaAdmin` dos testes:
 * completa com o que da para completar e diz o que faltou. Silenciar seria o
 * pior dos dois mundos — funciona hoje pelo motivo errado, e quebra depois com
 * a causa a tres arquivos de distancia.
 *
 * **A leitura do ambiente e dentro da funcao, e nao no topo do modulo.** Os
 * scripts chamam `dotenv.config()` depois dos imports, e import e avaliado
 * antes: ler `process.env` no escopo do modulo pegaria o ambiente **antes** do
 * `.env` ser carregado, e a variavel apareceria sempre ausente.
 */

let avisou = false;

export function criarPrismaScript(): PrismaClient {
  const url = process.env.DATABASE_URL_MIGRATOR;

  if (url === undefined || url.trim() === '') {
    if (!avisou) {
      console.warn(
        '[scripts] DATABASE_URL_MIGRATOR ausente — usando DATABASE_URL. ' +
          'Funciona enquanto o dono do banco for superusuario, e isso e ' +
          'consequencia da configuracao, nao desenho. Ver prisma/cliente.ts.',
      );
      avisou = true;
    }
    return new PrismaClient();
  }

  return new PrismaClient({ datasourceUrl: url });
}
