/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Don't bundle the Postgres driver — load it as a native Node module at
    // runtime (it uses fs/path/net and can't be webpacked).
    serverComponentsExternalPackages: ["pg"],
  },
};

module.exports = nextConfig;
