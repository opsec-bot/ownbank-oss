import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// CSP: self plus what Next needs (inline scripts/styles for hydration). Dev also needs eval for React refresh.
function buildCsp(formAction: string) {
  return [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action ${formAction}`,
  "object-src 'none'",
  ].join("; ");
}

const csp = buildCsp("'self'");

// The OAuth consent form posts to us and we answer with a redirect to the client. Browsers apply form-action to that
// redirect too, so this one page may submit to the only places a redirect URI can point (see oauth/clients.ts).
const consentCsp = buildCsp("'self' https://claude.ai https://claude.com http://localhost:* http://127.0.0.1:*");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Later entries override earlier ones for the same header key.
      { source: "/oauth/authorize", headers: [{ key: "Content-Security-Policy", value: consentCsp }] },
      // The service worker must never be served stale.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
