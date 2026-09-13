export type MenuLink = {
  label: string;
  href: string;
  body?: string;
};

export const PRODUCT_LINKS: MenuLink[] = [
  {
    label: "Video creation",
    href: "/features/content",
    body: "Create scripts, scenes, voiceover, and captions from a brief.",
  },
  {
    label: "Articles and SEO",
    href: "/features/seo",
    body: "Research buyer questions, draft articles, and audit existing pages.",
  },
  {
    label: "Ad campaigns",
    href: "/features/ads",
    body: "Prepare campaign drafts and review proposed changes.",
  },
];

export const SOLUTION_LINKS: MenuLink[] = [
  {
    label: "Founders and SaaS teams",
    href: "/use-cases/saas",
    body: "Explain your product and answer buyer questions.",
  },
  {
    label: "Ecommerce brands",
    href: "/use-cases/ecommerce",
    body: "Build content around your products.",
  },
  {
    label: "Agencies",
    href: "/use-cases/agencies",
    body: "Keep recurring production organized.",
  },
  {
    label: "Creators",
    href: "/use-cases/creators",
    body: "Develop a repeatable publishing routine.",
  },
  {
    label: "Local businesses",
    href: "/use-cases/local-business",
    body: "Show people what your business offers.",
  },
  {
    label: "AI agent builders",
    href: "/use-cases/ai-agents",
    body: "Connect production to your own workflow.",
  },
];
export const RESOURCE_LINKS: MenuLink[] = [
  {
    label: "How it works",
    href: "/how-it-works",
    body: "Follow the journey from brief to publication.",
  },
  {
    label: "Guides",
    href: "/resources/guides",
    body: "Practical help for your next piece of content.",
  },
  {
    label: "Help center",
    href: "/resources/help",
    body: "Setup, billing, approvals, and recovery.",
  },
  {
    label: "API and integrations",
    href: "/resources/api",
    body: "Connect your software and agents.",
  },
  {
    label: "All resources",
    href: "/resources",
    body: "Documentation, FAQs, and product updates.",
  },
];
export const COMPANY_LINKS: MenuLink[] = [
  { label: "About", href: "/about", body: "Why we built Marketer." },
  {
    label: "Contact",
    href: "/contact",
    body: "Questions, support, and product fit.",
  },
  {
    label: "Book a demo",
    href: "/demo",
    body: "Request a walkthrough of your use case.",
  },
  { label: "Legal", href: "/legal", body: "Terms, privacy, and refunds." },
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

// No verified company social destinations were supplied.
export const SOCIAL_LINKS: MenuLink[] = [];
