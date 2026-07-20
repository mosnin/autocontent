// The marketer.sh "suite" model: several distinct products (like the apps in
// a Google Workspace) that share one shell but each own a focused dashboard
// and sidebar. The sidebar renders ONLY the active product's nav — products
// are never mashed together into one long list.
//
// Pure + client-safe: no server-only imports, no React hooks. Plain data
// only — the switcher, product tabs, and /home hub all consume this one
// registry.

export type ProductId = "studio" | "press" | "ads" | "campaigns" | "suite";

export interface NavItem {
  href: string;
  label: string;
  /** Not yet built — rendered disabled with a "Soon" hint. */
  soon?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface Product {
  id: ProductId;
  label: string;
  /** One-line description for the launcher card + switcher. */
  tagline: string;
  /** Landing route when you switch into this product. */
  home: string;
  /** Path prefixes that belong to this product (for active detection). */
  match: string[];
  groups: NavGroup[];
}

// ---------------------------------------------------------------- products

const STUDIO: Product = {
  id: "studio",
  label: "Content",
  tagline: "Short-form video content — TikTok, Reels, Shorts",
  home: "/dashboard",
  match: ["/dashboard", "/niches", "/queue", "/calendar", "/library", "/templates", "/onboarding"],
  groups: [
    {
      label: "Operate",
      items: [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/niches", label: "Niches" },
        { href: "/queue", label: "Queue" },
        { href: "/calendar", label: "Calendar" },
        { href: "/library", label: "Library" },
        { href: "/templates", label: "Templates" },
      ],
    },
  ],
};

const PRESS: Product = {
  id: "press",
  label: "SEO",
  tagline: "Long-form articles, SEO, and search performance",
  home: "/articles",
  match: ["/articles"],
  groups: [
    {
      label: "Content",
      items: [
        { href: "/articles", label: "Articles" },
      ],
    },
  ],
};

const ADS: Product = {
  id: "ads",
  label: "Ads",
  tagline: "Create, manage, and scale paid campaigns with agents",
  home: "/ads",
  match: ["/ads"],
  groups: [
    {
      label: "Campaigns",
      items: [
        { href: "/ads", label: "Overview" },
        { href: "/ads/campaigns", label: "Campaigns" },
        { href: "/ads/approvals", label: "Approvals" },
        { href: "/ads/activity", label: "Activity" },
        { href: "/ads/insights", label: "Insights", soon: true },
        { href: "/ads/creatives", label: "Creatives", soon: true },
      ],
    },
    {
      label: "Setup",
      items: [{ href: "/ads/connect", label: "Ad accounts" }],
    },
  ],
};

const CAMPAIGNS: Product = {
  id: "campaigns",
  label: "Campaigns",
  tagline: "Run content, SEO, and ads together on a budget",
  home: "/campaigns",
  match: ["/campaigns"],
  groups: [
    {
      label: "Orchestrate",
      items: [
        { href: "/campaigns", label: "Campaigns" },
      ],
    },
  ],
};

const SUITE: Product = {
  id: "suite",
  label: "Suite",
  tagline: "Account-wide settings, connections, and admin",
  home: "/settings",
  match: ["/settings", "/connect", "/admin"],
  groups: [
    {
      label: "Account",
      items: [
        { href: "/settings", label: "Settings" },
        { href: "/settings/brand", label: "Brand kit" },
        { href: "/settings/kits", label: "Kits" },
        { href: "/connect", label: "Connect socials" },
        { href: "/settings/tokens", label: "Tokens" },
        { href: "/settings/billing", label: "Billing" },
      ],
    },
    {
      label: "Admin",
      items: [
        { href: "/admin", label: "Admin console" },
        { href: "/admin/media", label: "Media" },
      ],
    },
  ],
};

/** Ordered for the launcher + switcher: Campaigns, Content, SEO, Ads,
 *  then Suite intentionally last. */
export const PRODUCTS: Product[] = [CAMPAIGNS, STUDIO, PRESS, ADS, SUITE];


export function productById(id: ProductId): Product {
  return PRODUCTS.find((p) => p.id === id) ?? STUDIO;
}

/**
 * Which product owns this path. Longest matching prefix wins so a specific
 * product's route can never be swallowed by a broader one. Defaults to Studio
 * (the original home) for unrecognized paths.
 */
export function productForPath(pathname: string): Product {
  let best: Product = STUDIO;
  let bestLen = -1;
  for (const product of PRODUCTS) {
    for (const prefix of product.match) {
      const hit = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (hit && prefix.length > bestLen) {
        best = product;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

