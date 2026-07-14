import * as React from "react";
import Link from "next/link";

const COLUMNS: Array<{
  heading: string;
  links: Array<{ label: string; href: string }>;
}> = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Video", href: "/features/video" },
      { label: "Articles & SEO", href: "/features/articles" },
      { label: "Automation & Agents", href: "/features/automation" },
      { label: "Analytics & Spend", href: "/features/analytics" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    heading: "Use cases",
    links: [
      { label: "Overview", href: "/use-cases" },
      { label: "Creators", href: "/use-cases/creators" },
      { label: "Ecommerce", href: "/use-cases/ecommerce" },
      { label: "SaaS", href: "/use-cases/saas" },
      { label: "Agencies", href: "/use-cases/agencies" },
      { label: "Local business", href: "/use-cases/local-business" },
      { label: "AI agents", href: "/use-cases/ai-agents" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Overview", href: "/resources" },
      { label: "Quickstart", href: "/resources/quickstart" },
      { label: "API & MCP", href: "/resources/api" },
      { label: "Guide: first channel", href: "/resources/guides/first-channel" },
      { label: "Guide: SEO articles", href: "/resources/guides/seo-articles" },
      {
        label: "Guide: agent-driven marketing",
        href: "/resources/guides/agent-driven-marketing",
      },
      { label: "Changelog", href: "/resources/changelog" },
      { label: "FAQ", href: "/resources/faq" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/company" },
      { label: "Log in", href: "/sign-in" },
      { label: "Get started", href: "/sign-up" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-900/[0.06] bg-[#f5f6f8]">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <div className="grid gap-12 md:grid-cols-[1.2fr_repeat(4,1fr)] md:gap-8">
          <div>
            <Link className="flex items-center gap-2" href="/">
              <svg
                aria-hidden
                className="size-[18px] text-zinc-900"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2.25"
                viewBox="0 0 24 24"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              <span className="font-display text-[15px] font-semibold tracking-tight text-zinc-900">
                marketer.sh
              </span>
            </Link>
            <p className="mt-4 max-w-[24ch] text-sm leading-relaxed text-zinc-500">
              The autonomous marketing platform. One brief in, video and
              articles out, every dollar under a cap.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav aria-label={col.heading} key={col.heading}>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
                {col.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
                      href={l.href}
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-zinc-900/[0.06] pt-6 text-xs text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} marketer.sh. All rights reserved.</p>
          <p>
            Prepaid credits, hard spend caps, nothing posts without your rules.
          </p>
        </div>
      </div>
    </footer>
  );
}
