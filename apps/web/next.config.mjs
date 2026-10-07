/**
 * Endereço interno da API, usado só como destino do rewrite de desenvolvimento.
 *
 * Não é `NEXT_PUBLIC_*`: não vai para o navegador e não aceita hostname público.
 */
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3101';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION ?? '0.1.1',
  },

  /**
   * `/api` same-origin em desenvolvimento.
   *
   * Desde 07/10/2026 o navegador chama `/api/v1/...` na própria origem. Em
   * produção quem encaminha é o gateway nginx, que intercepta `/api/` antes do
   * Next. Em desenvolvimento não existe gateway: sem este rewrite a chamada
   * bateria no próprio Next, que não tem rota `/api`, e o login local morreria.
   *
   * Vazio em produção de propósito, por duas razões medidas:
   *
   *   1. o gateway já é a fronteira lá, e o Next não deve virar um segundo
   *      caminho para a API;
   *   2. `next build` grava os rewrites em `.next/routes-manifest.json`, e no
   *      build da imagem `API_INTERNAL_URL` ainda não está definida (ela entra
   *      depois, como ENV de execução). O destino gravado seria
   *      `http://127.0.0.1:3101`, que dentro do container da web não é a API.
   *      Em vez de gravar um destino errado que ninguém usa, não grava nenhum.
   */
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];

    return [
      {
        source: '/api/:path*',
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
