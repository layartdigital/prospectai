import { NativeSiteAuditProvider } from '../src/providers/site-audit/native.provider';

/**
 * Smoke test da auditoria contra alvo publico.
 *
 * `pnpm audit:fumaca site1.com.br site2.com.br`
 *
 * **E o unico jeito de exercitar o que teste nenhum alcanca:** DNS de verdade,
 * a tabela de faixas contra IP publico de verdade, socket, handshake TLS,
 * redirect real e servidor que responde o que quiser. A suite prova a logica
 * contra dublê e contra servidor local; isto prova que a logica sobrevive a
 * internet.
 *
 * A primeira execucao dele achou um defeito em dez minutos — as checagens
 * ignoravam a classe do codigo de status, e site com 500 em toda pagina passava
 * nas quatro. Vale rodar antes de cada deploy que toque o modulo.
 *
 * **Escolha os alvos com cuidado.** Sao requisicoes de verdade contra sites de
 * verdade, entao: poucos, publicos, e de preferencia do mesmo tipo de negocio
 * que o produto audita — clinica, advogado, MEI. Site grande atras de CDN
 * responde diferente de site de dentista em WordPress, e e o segundo que
 * interessa medir.
 *
 * **Tudo dentro de `main()`, e nao no topo.** O worker compila para CJS, onde
 * `await` de nivel superior nao existe — a primeira versao deste arquivo o
 * usava e o `tsx` recusou. Foi escrita e testada num harness ESM: o codigo
 * estava certo para o ambiente errado, que e a mesma classe de erro que este
 * script existe para pegar.
 */

async function main(): Promise<void> {
  const alvos = process.argv.slice(2);

  if (alvos.length === 0) {
    console.error('uso: pnpm audit:fumaca <site> [site...]');
    console.error('ex.:  pnpm audit:fumaca layart.com.br');
    process.exitCode = 1;
    return;
  }

  const provider = new NativeSiteAuditProvider();

  for (const alvo of alvos) {
    const inicio = Date.now();
    const r = await provider.auditar({ website: alvo });

    console.log(`\n=== ${alvo} === ${r.status} em ${Date.now() - inicio}ms`);
    if (r.errorCode !== null) console.log(`  erro: ${r.errorCode}`);

    for (const c of r.checks) {
      console.log(
        [
          ' ',
          c.check.padEnd(15),
          c.outcome.padEnd(8),
          (c.errorCode ?? '').padEnd(26),
          JSON.stringify(c.result ?? {}),
          c.observedUrl ?? '',
        ].join(' '),
      );
    }
  }
}

/**
 * O que olhar no resultado, e nao e o "verde".
 *
 * - `REDIRECT_CHAIN` com `forcaHttps` **ausente** significa que a sonda http
 *   nao foi conclusiva. Se isso acontecer com todos os alvos, provavelmente ha
 *   um intermediario na sua rede respondendo pelos sites — foi o que aconteceu
 *   na primeira execucao, e por isso o numero de la nao servia para nada.
 * - `HTTPS OK` com `HTTP_REACHABLE SKIPPED` e coerente: certificado e
 *   transporte, o status e aplicacao. Sao camadas diferentes de proposito.
 * - Duracao acima de uns 2s por alvo merece olhar: o orcamento e de 30s, e
 *   chegar perto disso em site pequeno indica problema de rota, nao do site.
 */
main().catch((erro: unknown) => {
  console.error('smoke test falhou:', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
