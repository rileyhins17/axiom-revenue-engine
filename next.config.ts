import type { NextConfig } from "next";

// Only initialize OpenNext Cloudflare bindings when explicitly running in a
// Cloudflare-style dev context. This avoids local Node/Windows weirdness.
if (
  process.env.CLOUDFLARE === "1" ||
  process.env.WORKERS_RS === "1" ||
  process.env.NEXT_RUNTIME === "edge"
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");
    initOpenNextCloudflareForDev();
  } catch {
    // Ignore when not actually running in Cloudflare/OpenNext dev mode.
  }
}

const nextConfig: NextConfig = {
  typedRoutes: true,

  // The old website campaign's screens are gone. Old bookmarks and home-screen links land on Today.
  async redirects() {
    return ["/archive", "/ask", "/automation", "/call", "/clients", "/email", "/leads", "/prospects", "/vault", "/walk-ins", "/unsubscribe"]
      .flatMap((source) => [{ source, destination: "/dashboard", permanent: false }, { source: `${source}/:path*`, destination: "/dashboard", permanent: false }]);
  },

  // Next's file tracer can otherwise copy ignored local research and SQLite
  // checkpoints into the deployable server bundle when routes use fs.
  outputFileTracingExcludes: {
    "/*": [
      "./data/**/*",
      "./backups/**/*",
      "./output/**/*",
      "./.superpowers/**/*",
      "./.claude/**/*",
      "./.wrangler/**/*",
      "./.vercel/**/*",
      "./.git/**/*",
    ],
  },

  // Keep the native SQLite driver (local development and tests only) out of the server bundle.
  serverExternalPackages: ["better-sqlite3"],

  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push("better-sqlite3");
    }

    return config;
  },
};

export default nextConfig;
