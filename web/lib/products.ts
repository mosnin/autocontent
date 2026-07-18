// The marketer.sh "suite" model: several distinct products (like the apps in
// a Google Workspace) that share one shell but each own a focused dashboard
// and sidebar. The sidebar renders ONLY the active product's nav — products
// are never mashed together into one long list.
//
// Pure + client-safe: no server-only imports, no React hooks. Holds lucide
// icon component references (plain values) so both the sidebar and the /home
// launcher can consume one registry.

import {
  Clapperboard,
  BarChart3,
  CalendarDays,
  CheckSquare,
  FileText,
  Film,
  KeyRound,
  Layers,
  LayoutDashboard,
  Link2,
  ListChecks,
  Megaphone,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type ProductId = "studio" | "press" | "ads" | "suite";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
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
  match: ["/dashboard", "/niches", "/queue", "/calendar", "/library", "/onboarding"],
  groups: [
    {
      label: "Operate",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/niches", label: "Niches", icon: Layers },
        { href: "/queue", label: "Queue", icon: ListChecks },
        { href: "/calendar", label: "Calendar", icon: CalendarDays },
        { href: "/library", label: "Library", icon: Clapperboard },
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
  home: "/articles",
  match: ["/articles"],
  groups: [
    {
      label: "Content",
      items: [
        { href: "/articles", label: "Articles", icon: FileText },
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
        { href: "/ads", label: "Overview", icon: BarChart3 },
        { href: "/ads/campaigns", label: "Campaigns", icon: Megaphone },
        { href: "/ads/approvals", label: "Approvals", icon: CheckSquare },
        { href: "/ads/activity", label: "Activity", icon: ScrollText },
        { href: "/ads/insights", label: "Insights", icon: Sparkles, soon: true },
        { href: "/ads/creatives", label: "Creatives", icon: Palette, soon: true },
      ],
    },
    {
      label: "Setup",
      items: [{ href: "/ads/connect", label: "Ad accounts", icon: Link2 }],
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
        { href: "/settings", label: "Settings", icon: Settings },
        { href: "/settings/brand", label: "Brand kit", icon: Palette },
        { href: "/connect", label: "Connect socials", icon: Link2 },
        { href: "/settings/tokens", label: "Tokens", icon: KeyRound },
        { href: "/settings/billing", label: "Billing", icon: Wallet },
      ],
    },
    {
      label: "Admin",
      items: [{ href: "/admin", label: "Admin console", icon: ShieldCheck }],
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
