import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://marketer.sh";

const ROUTES = [
  "",
  "/pricing",
  "/company",
  "/features",
  "/features/video",
  "/features/articles",
  "/features/automation",
  "/features/analytics",
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

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((path) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path.split("/").length <= 2 ? 0.8 : 0.6,
  }));
}
