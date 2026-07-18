// The marketer.sh "suite" model: distinct products sharing one shell. The
// sidebar is a dual-rail: a narrow icon rail where EVERY product is always
// visible (no dropdown switching), and a panel showing only the active
// product's nav — top-level rows carry an icon, collapsible groups hang
// text-only sub-items off a tree line.
//
// Pure + client-safe: no server-only imports, no React hooks.

import {
  BarChart3,
  CalendarDays,
  FileText,
  Film,
  Image as ImageIcon,
  LayoutDashboard,
  Layers,
  Lightbulb,
  Link2,
  ListChecks,
  Megaphone,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type ProductId = "studio" | "press" | "ads" | "suite";

/** A text-only row inside a collapsible group (reference: no icons on subs). */
export interface NavSubItem {
  href: string;
  label: string;
  /** Not yet built — rendered disabled with a "Soon" hint. */
  soon?: boolean;
}

/** A top-level row: icon + label. */
export interface NavLeaf {
  kind: "item";
  href: string;
  label: string;
  icon: LucideIcon;
}

/** A collapsible section: icon + label parent with tree-lined sub-items. */
export interface NavSection {
  kind: "group";
  label: string;
  icon: LucideIcon;
  items: NavSubItem[];
}

export type NavEntry = NavLeaf | NavSection;

export interface Product {
  id: ProductId;
  label: string;
  /** One-line description for the launcher card + rail tooltip. */
  tagline: string;
  icon: LucideIcon;
  /** A category tint token (bg-cat-*) for the /home launcher tile. */
  accent: "navy" | "blue" | "orange" | "green" | "purple";
  /** Landing route when you switch into this product. */
  home: string;
  /** Path prefixes that belong to this product (for active detection). */
  match: string[];
  nav: NavEntry[];
}

// ---------------------------------------------------------------- products

const STUDIO: Product = {
  id: "studio",
  label: "Studio",
  tagline: "Short-form video — TikTok, Reels, Shorts",
  icon: Film,
  accent: "navy",
  home: "/dashboard",
  match: [
    "/dashboard",
    "/niches",
    "/queue",
    "/calendar",
    "/onboarding",
    "/studio",
    "/library",
  ],
  nav: [
    { kind: "item", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { kind: "item", href: "/niches", label: "Channels", icon: Layers },
    { kind: "item", href: "/queue", label: "Queue", icon: ListChecks },
    { kind: "item", href: "/studio", label: "Studio", icon: Sparkles },
    { kind: "item", href: "/library", label: "Library", icon: ImageIcon },
    { kind: "item", href: "/calendar", label: "Calendar", icon: CalendarDays },
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
  nav: [
    { kind: "item", href: "/press", label: "Overview", icon: LayoutDashboard },
    { kind: "item", href: "/articles", label: "Articles", icon: FileText },
    { kind: "item", href: "/press/topics", label: "Topics", icon: Lightbulb },
    {
      kind: "group",
      label: "Research",
      icon: Search,
      items: [
        { href: "/press/research", label: "SERP analysis" },
        { href: "/press/links", label: "Internal links" },
        { href: "/press/keywords", label: "Keywords" },
        { href: "/press/clusters", label: "Clusters" },
        { href: "/press/competitors", label: "Competitors" },
      ],
    },
    {
      kind: "group",
      label: "Analytics",
      icon: BarChart3,
      items: [
        { href: "/press/search", label: "Search Console" },
        { href: "/press/rankings", label: "Rankings" },
        { href: "/press/gaps", label: "Content gaps" },
        { href: "/press/audit", label: "Content audit" },
        { href: "/press/alerts", label: "Alerts" },
      ],
    },
    { kind: "item", href: "/press/repurpose", label: "Repurpose", icon: Send },
    { kind: "item", href: "/press/newsletters", label: "Newsletters", icon: FileText },
    { kind: "item", href: "/press/publishing", label: "Publishing", icon: Link2 },
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
  nav: [
    { kind: "item", href: "/ads", label: "Overview", icon: BarChart3 },
    {
      kind: "group",
      label: "Campaigns",
      icon: Megaphone,
      items: [
        { href: "/ads/campaigns", label: "All campaigns" },
        { href: "/ads/approvals", label: "Approvals" },
        { href: "/ads/activity", label: "Activity" },
        { href: "/ads/insights", label: "Insights" },
        { href: "/ads/creatives", label: "Creatives" },
        { href: "/ads/experiments", label: "Experiments" },
      ],
    },
    { kind: "item", href: "/ads/connect", label: "Ad accounts", icon: Link2 },
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
  nav: [
    { kind: "item", href: "/settings", label: "Settings", icon: Settings },
    { kind: "item", href: "/connect", label: "Connect socials", icon: Link2 },
    {
      kind: "group",
      label: "Account",
      icon: Wallet,
      items: [
        { href: "/settings/brand", label: "Brand kit" },
        { href: "/settings/tokens", label: "Tokens" },
        { href: "/settings/billing", label: "Billing" },
        { href: "/settings/webhooks", label: "Webhooks" },
        { href: "/settings/privacy", label: "Data & privacy" },
      ],
    },
    { kind: "item", href: "/admin", label: "Admin console", icon: ShieldCheck },
  ],
};

/** Ordered for the rail + launcher. Suite is intentionally last. */
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

/** Accent tile background class for a product's /home launcher glyph. */
export function productAccentClass(accent: Product["accent"]): string {
  return {
    navy: "bg-cat-navy",
    blue: "bg-cat-blue",
    orange: "bg-cat-orange",
    green: "bg-cat-green",
    purple: "bg-cat-purple",
  }[accent];
}
