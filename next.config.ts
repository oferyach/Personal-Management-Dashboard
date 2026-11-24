import type { NextConfig } from "next";

/**
 * Security headers are installed from Phase 0 so they can never be forgotten.
 * Content-Security-Policy is NOT set here: a CSP nonce must be generated per
 * request, which only middleware can do (see src/middleware.ts). Next.js then
 * attaches that nonce to its own inline scripts.
 */

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Local development is commonly opened through the loopback address rather
  // than `localhost`; allow that hostname to load dev assets and Server Actions.
  allowedDevOrigins: ["127.0.0.1"],
  // Native addon: must not be bundled by SWC/Turbopack.
  serverExternalPackages: ["better-sqlite3"],
  // Migration SQL must exist inside the standalone image so upgrades can run.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
