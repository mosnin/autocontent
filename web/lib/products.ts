// The marketer.sh "suite" model: several distinct products (like the apps in
// a Google Workspace) that share one shell but each own a focused dashboard
// and sidebar. The sidebar renders ONLY the active product's nav — products
// are never mashed together into one long list.
//
// Nav is text-first (no per-item icons — type and space carry the hierarchy);
// each product keeps one glyph for the app switcher and the /home launcher.
//
// Pure + client-safe: no server-only imports, no React hooks.

import {
  FileText,
  Film,
  Megaphone,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type ProductId = "studio" | "press" | "ads" | "suite";

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
  icon: LucideIcon;
  /** A category tint token (bg-cat-*) so each product reads as its own tile. */
  accent: "navy" | "blue" | "orange" | "green" | "purple";
  /** Landing route when you switch into this product. */
  home: string;
  /** Path prefixes that belong to this product (for active detection). */
  match: string[];
  groups: NavGroup[];
}

// ---------------------------------------------------------------- products

const STUDIO: Product = {
  id: "studio",
  label: "Studio",
  tagline: "Short-form video — TikTok, Reels, Shorts",
  icon: Film,
  accent: "navy",
  home: "/dashboard",
  match: ["/dashboard", "/niches", "/queue", "/calendar", "/onboarding"],
  groups: [
    {
      label: "Operate",
      items: [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/niches", label: "Niches" },
        { href: "/queue", label: "Queue" },
        { href: "/calendar", label: "Calendar" },
      ],
    },
  ],
};

const PRESS: Product = {
  id: "press",
  label: "Press",
  tagline: "Long-form articles, SEO, and search performance",
  icon: FileText,
  accent: "blue",
  home: "/press",
  match: ["/press", "/articles"],
  groups: [
    {
      label: "Content",
      items: [
        { href: "/press", label: "Overview" },
        { href: "/articles", label: "Articles" },
        { href: "/calendar", label: "Calendar" },
      ],
    },
    {
      label: "Craft",
      items: [
        { href: "/settings/brand", label: "Brand voice" },
        { href: "/press/seo", label: "SEO toolkit", soon: true },
      ],
    },
    {
      label: "Performance",
      items: [
        { href: "/press/search", label: "Search Console", soon: true },
        { href: "/press/keywords", label: "Keyword tracking", soon: true },
      ],
    },
  ],
};

const ADS: Product = {
  id: "ads",
  label: "Ads",
  tagline: "Create, manage, and scale paid campaigns with agents",
  icon: Megaphone,
  accent: "orange",
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

const SUITE: Product = {
  id: "suite",
  label: "Suite",
  tagline: "Account-wide settings, connections, and admin",
  icon: Settings,
  accent: "purple",
  home: "/settings",
  match: ["/settings", "/connect", "/admin"],
  groups: [
    {
      label: "Account",
      items: [
        { href: "/settings", label: "Settings" },
        { href: "/settings/brand", label: "Brand kit" },
        { href: "/connect", label: "Connect socials" },
        { href: "/settings/tokens", label: "Tokens" },
        { href: "/settings/billing", label: "Billing" },
      ],
    },
    {
      label: "Admin",
      items: [{ href: "/admin", label: "Admin console" }],
    },
  ],
};

/** Ordered for the launcher + switcher. Suite is intentionally last. */
export const PRODUCTS: Product[] = [STUDIO, PRESS, ADS, SUITE];

/** The three "content" products shown as primary tiles on the launcher. */
export const PRIMARY_PRODUCTS: Product[] = [STUDIO, PRESS, ADS];

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

/** Accent tile background class for a product's app-switcher/launcher glyph. */
export function productAccentClass(accent: Product["accent"]): string {
  return {
    navy: "bg-cat-navy",
    blue: "bg-cat-blue",
    orange: "bg-cat-orange",
    green: "bg-cat-green",
    purple: "bg-cat-purple",
  }[accent];
}
