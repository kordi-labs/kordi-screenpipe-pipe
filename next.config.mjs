/** @type {import('next').NextConfig} */
const nextConfig = {
  // Screenpipe runs the pipe as a standalone Next.js app; keep the build lean.
  reactStrictMode: true,
  // No ESLint config ships with the pipe; types are gated separately via tsc.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
