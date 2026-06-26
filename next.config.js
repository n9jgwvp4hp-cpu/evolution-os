/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Run instrumentation.ts on server start so the mission worker boots.
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
