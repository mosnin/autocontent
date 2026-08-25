export type MenuLink = {
  label: string;
  href: string;
  body?: string;
};

export const PRODUCT_LINKS: MenuLink[] = [
  {
    label: "Content",
    href: "/features/content",
    body: "Short videos for TikTok, Reels, and Shorts. Your agent writes, makes, and posts them.",
  },
  {
    label: "SEO",
    href: "/features/seo",
    body: "Blog posts that can rank, plus a check-up for pages you already have live.",
  },
  {
    label: "Ads",
    href: "/features/ads",
    body: "Google and Meta ads. Your agent drafts them. You set the budget.",
  },
];

export const RESOURCE_LINKS: MenuLink[] = [
  {
    label: "Resources",
    href: "/resources",
    body: "Guides, changelog, and answers in one place.",
  },
  {
    label: "Use cases",
    href: "/use-cases",
    body: "How creators, shops, and teams use marketer.sh.",
  },
  {
    label: "Documentation",
    href: "/docs",
    body: "How to get started, set a budget, and ship work.",
  },
  {
    label: "API",
    href: "/resources/api",
    body: "Call the same platform from code or an agent.",
  },
];

export const COMPANY_LINKS: MenuLink[] = [
  { label: "About", href: "/about", body: "Who we are and what we build." },
  { label: "Contact", href: "/contact", body: "Write us. A person reads it." },
  { label: "Legal", href: "/legal", body: "Terms, privacy, refunds, and more." },
];

export const LEGAL_LINKS: MenuLink[] = [
  { label: "Legal", href: "/legal" },
  { label: "Privacy Policy", href: "/legal/privacy" },
  { label: "Terms of Service", href: "/legal/terms" },
  { label: "Cookie Policy", href: "/legal/cookies" },
  { label: "Acceptable Use", href: "/legal/acceptable-use" },
  { label: "Refunds", href: "/legal/refund" },
  { label: "DPA", href: "/legal/dpa" },
  { label: "Subprocessors", href: "/legal/subprocessors" },
];

export const SOCIAL_LINKS: MenuLink[] = [
  { label: "X", href: "https://x.com" },
  { label: "LinkedIn", href: "https://www.linkedin.com" },
];
