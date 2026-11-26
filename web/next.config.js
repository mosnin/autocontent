/** @type {import('next').NextConfig} */

// The product used to be a suite of separate dashboards. Every old route now
// lands in its place in the one-department app (see PRODUCT_GOAL.md).
const LEGACY = [
  ["/dashboard", "/home"],
  ["/queue", "/content"],
  ["/queue/:id", "/content/videos/:id"],
  ["/templates", "/content?tab=templates"],
  ["/articles", "/seo"],
  ["/articles/:id", "/seo/:id"],
  ["/niches", "/playbooks"],
  ["/niches/:id", "/playbooks/:id"],
  ["/niches/:id/edit", "/playbooks/:id/edit"],
  ["/calendar", "/plan"],
  ["/ads", "/paid"],
  ["/ads/campaigns", "/paid"],
  ["/ads/campaigns/new", "/paid/campaigns/new"],
  ["/ads/campaigns/:id", "/paid/campaigns/:id"],
  ["/ads/approvals", "/inbox"],
  ["/ads/activity", "/paid#activity"],
  ["/ads/connect", "/paid/connect"],
  ["/campaigns", "/distribution"],
  ["/campaigns/:id", "/distribution/campaigns/:id"],
  ["/connect", "/distribution"],
  ["/settings/brand", "/brand"],
  ["/settings/kits", "/brand#kits"],
  ["/settings/tokens", "/integrations#agents"],
  ["/settings/webhooks", "/integrations#webhooks"],
  // Keeps ?purchase= (Next passes the query through); Stripe now returns to /settings directly.
  ["/settings/billing", "/settings"],
  ["/settings/privacy", "/settings"],
];

const path = require("node:path");

const PROD = process.env.NODE_ENV === "production";

// Routes the auth middleware handles (web/middleware.ts; APP_SEGMENTS and
// AUTH_SEGMENTS in lib/auth/route-policy.ts). They get a nonce-based CSP
// there; everything else gets the static policy below.
const AUTH_ROUTES = "home|activity|inbox|sessions|analytics|plan|library|content|seo|paid|distribution|playbooks|brand|memory|integrations|settings|onboarding|plans|admin|sign-in|sign-up|verify-email|forgot-password|reset-password|two-factor|accept-invitation";

// Always enforced, on every response: clickjacking, <base> hijack, plugins.
const CSP_BASELINE = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";

// Static pages (marketing, legal, the fixture preview) are prerendered, so
// their inline bootstrap scripts cannot carry a per-request nonce:
// script-src needs 'unsafe-inline' here. These pages render no user content.
// img/font data: and blob: are required by the page-transition shader
// (web/vendor/distortion-waves). No 'unsafe-eval' outside development.
const CSP_STATIC = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${PROD ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob: https:",
  `connect-src 'self'${PROD ? "" : " ws: wss:"}`,
  "worker-src 'self' blob:",
  "form-action 'self'",
  CSP_BASELINE,
].join("; ");

// Report-only until CSP_MODE=enforce (see docs/security/web-audit.md).
const CSP_ENFORCE = (process.env.CSP_MODE || "").trim() === "enforce";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), payment=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // HTTPS only matters in production; sending it from localhost dev would pin the browser.
  ...(PROD ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The onboarding decisions route imports the vendored framework from ../.intent-onboarding (TypeScript source).
  experimental: { externalDir: true },
  webpack(config) {
    // Files under ../.intent-onboarding resolve this SDK from web/node_modules (server-only: the decisions route).
    config.resolve.alias = { ...config.resolve.alias, "@typesafe-ai/sdk": path.join(__dirname, "node_modules/@typesafe-ai/sdk") };
    return config;
  },
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Middleware-routed pages: the middleware sends the nonce-based policy. While
      // that is report-only, the baseline is still enforced here.
      ...(CSP_ENFORCE ? [] : [{ source: `/:first(${AUTH_ROUTES})/:rest*`, headers: [{ key: "Content-Security-Policy", value: CSP_BASELINE }] }]),
      {
        source: `/((?!(?:${AUTH_ROUTES})(?:/|$)|api/|_next/).*)`,
        headers: CSP_ENFORCE
          ? [{ key: "Content-Security-Policy", value: CSP_STATIC }]
          : [
              { key: "Content-Security-Policy", value: CSP_BASELINE },
              { key: "Content-Security-Policy-Report-Only", value: CSP_STATIC },
            ],
      },
    ];
  },
  async redirects() {
    return LEGACY.map(([source, destination]) => ({ source, destination, permanent: true }));
  },
};

module.exports = nextConfig;
