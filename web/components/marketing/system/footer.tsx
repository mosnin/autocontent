import * as React from "react";
import Link from "next/link";

const COLUMNS: Array<{
  heading: string;
  links: Array<{ label: string; href: string }>;
}> = [
  {
    heading: "Product",
    links: [
      { label: "All features", href: "/features" },
      { label: "Studio video", href: "/features/video" },
      { label: "Press articles", href: "/features/articles" },
      { label: "Automation & agents", href: "/features/automation" },
      { label: "Analytics & spend", href: "/features/analytics" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    heading: "Solutions",
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
    heading: "Learn",
    links: [
      { label: "Resources", href: "/resources" },
      { label: "Quickstart", href: "/resources/quickstart" },
      { label: "API & MCP", href: "/resources/api" },
      { label: "First channel guide", href: "/resources/guides/first-channel" },
      { label: "SEO articles guide", href: "/resources/guides/seo-articles" },
      {
        label: "Agent-driven marketing",
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
      { label: "Contact sales", href: "/company" },
      { label: "Log in", href: "/sign-in" },
      { label: "Sign up", href: "/sign-up" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms", href: "/legal/terms" },
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Acceptable use", href: "/legal/acceptable-use" },
      { label: "Cookies", href: "/legal/cookies" },
      { label: "DPA", href: "/legal/dpa" },
      { label: "Subprocessors", href: "/legal/subprocessors" },
      { label: "Refunds", href: "/legal/refund" },
    ],
  },
];

const SOCIALS: Array<{ label: string; href: string; path: React.ReactNode }> = [
  {
    label: "X",
    href: "https://x.com",
    path: <path d="M4 4l7.2 9.6L4.4 20h2.6l5.4-5.1L16.8 20H20l-7.5-10L19.4 4h-2.6l-4.9 4.7L8.2 4H4Z" />,
  },
  {
    label: "GitHub",
    href: "https://github.com",
    path: (
      <path d="M12 3a9 9 0 0 0-2.85 17.55c.45.08.62-.2.62-.44v-1.7c-2.5.55-3.03-1.06-3.03-1.06-.41-1.04-1-1.32-1-1.32-.82-.56.06-.55.06-.55.9.07 1.38.93 1.38.93.8 1.38 2.11.98 2.63.75.08-.58.31-.98.57-1.2-2-.23-4.1-1-4.1-4.45 0-.98.35-1.79.93-2.42-.1-.23-.4-1.15.08-2.4 0 0 .76-.24 2.48.92a8.6 8.6 0 0 1 4.5 0c1.72-1.16 2.47-.92 2.47-.92.5 1.25.19 2.17.1 2.4.58.63.92 1.44.92 2.42 0 3.47-2.1 4.22-4.11 4.44.32.28.61.83.61 1.67v2.48c0 .24.16.53.62.44A9 9 0 0 0 12 3Z" />
    ),
  },
  {
    label: "YouTube",
    href: "https://youtube.com",
    path: (
      <>
        <path d="M21.3 8s-.2-1.3-.75-1.9c-.7-.75-1.5-.76-1.86-.8C16.1 5.1 12 5.1 12 5.1s-4.1 0-6.7.2c-.36.04-1.15.05-1.86.8C2.9 6.7 2.7 8 2.7 8S2.5 9.6 2.5 11.1v1.7c0 1.6.2 3.1.2 3.1s.2 1.3.74 1.9c.7.76 1.63.73 2.04.81 1.5.14 6.52.19 6.52.19s4.1 0 6.7-.2c.36-.04 1.15-.05 1.85-.8.55-.6.75-1.9.75-1.9s.2-1.5.2-3.1v-1.7c0-1.5-.2-3.1-.2-3.1ZM10 14.6V9.4l5 2.6-5 2.6Z" />
      </>
    ),
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-900/[0.06] bg-white">
      <div className="mx-auto max-w-7xl px-6 py-16 md:py-20">
        <div className="grid gap-12 md:grid-cols-[1.3fr_repeat(5,1fr)] md:gap-8">
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
            <p className="mt-4 max-w-[26ch] text-sm leading-relaxed text-zinc-500">
              The autonomous marketing platform. One brief in, video and
              articles out, every dollar under a cap.
            </p>
            <div className="mt-6 flex items-center gap-2">
              {SOCIALS.map((s) => (
                <a
                  aria-label={s.label}
                  className="flex size-9 items-center justify-center rounded-full border border-zinc-900/10 text-zinc-500 transition-colors hover:border-zinc-900/25 hover:text-zinc-900"
                  href={s.href}
                  key={s.label}
                  rel="noreferrer"
                  target="_blank"
                >
                  <svg
                    aria-hidden
                    className="size-4 fill-current"
                    viewBox="0 0 24 24"
                  >
                    {s.path}
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav aria-label={col.heading} key={col.heading}>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
                {col.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={`${l.href}-${l.label}`}>
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

        <div className="mt-14 flex flex-col gap-4 border-t border-zinc-900/[0.06] pt-6 text-xs text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} marketer.sh. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            Built for humans and their agents.
          </p>
        </div>
      </div>
    </footer>
  );
}
