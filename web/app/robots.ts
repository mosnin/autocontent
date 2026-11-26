import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://marketer.sh";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Authed surfaces and auth flows carry no SEO value and should not be
      // crawled or indexed.
      disallow: [
        "/dashboard", "/queue", "/articles", "/niches", "/connect", "/settings", "/onboarding", "/admin", "/sign-in", "/sign-up", "/api/",
        // The app itself and its preview pages.
        "/home", "/sessions", "/activity", "/inbox", "/analytics", "/plan", "/library", "/playbooks", "/content", "/seo", "/paid", "/distribution", "/brand", "/integrations", "/memory", "/preview",
      ],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
