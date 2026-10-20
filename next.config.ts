import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Parsers that rely on Node internals stay out of the bundle.
  serverExternalPackages: ['mammoth', 'jszip'],
};
export default nextConfig;
