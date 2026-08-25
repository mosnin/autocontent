import type { MetadataRoute } from "next";

import { SERVICES } from "@/lib/marketing/services";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://marketer.sh";

const STATIC_ROUTES = [
  "",
  "/pricing",
  "/company",
  "/features",
  "/use-cases",
  "/use-cases/creators",
  "/use-cases/ecommerce",
  "/use-cases/saas",
  "/use-cases/agencies",
  "/use-cases/local-business",
  "/use-cases/ai-agents",
  "/resources",
  "/resources/quickstart",
  "/resources/api",
  "/resources/guides/first-channel",
  "/resources/guides/seo-articles",
  "/resources/guides/agent-driven-marketing",
  "/resources/changelog",
  "/resources/faq",
  "/legal",
  "/legal/terms",
  "/legal/privacy",
  "/legal/acceptable-use",
  "/legal/cookies",
  "/legal/subprocessors",
  "/legal/dpa",
  "/legal/refund",
];

const ROUTES = [
  ...STATIC_ROUTES,
  ...SERVICES.map((service) => `/features/${service.slug}`),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((path) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path.split("/").length <= 2 ? 0.8 : 0.6,
  }));
}
