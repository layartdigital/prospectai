/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION ?? '0.1.1',
  },
};

export default nextConfig;
