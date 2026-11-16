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

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  },
  async redirects() {
    return LEGACY.map(([source, destination]) => ({ source, destination, permanent: true }));
  },
};

module.exports = nextConfig;
