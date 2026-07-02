"use client";

import Link from "next/link";

import { ThemeSwitcher } from "@/components/theme-switcher";

const COLUMNS: { heading: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Queue", href: "/queue" },
      { label: "Connect socials", href: "/connect" },
      { label: "Settings", href: "/settings" },
    ],
  },
  {
    heading: "Builders",
    links: [
      { label: "Source", href: "https://github.com/mosnin/autocontent", external: true },
      { label: "API tokens", href: "/settings/tokens" },
      { label: "MCP server", href: "https://github.com/mosnin/autocontent#mcp", external: true },
    ],
  },
];

/**
 * Scroll-reveal footer: the page content rides above it (z-10, shadowed),
 * while the footer sits sticky at the bottom and is uncovered as you reach
 * the end — the pixel-perfect footer-reveal pattern, themed for us.
 */
export function SiteFooter() {
  return (
    <footer className="sticky bottom-0 z-0 border-t border-border/60 bg-card/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pb-8 pt-14">
        <div className="flex flex-col justify-between gap-10 sm:flex-row">
          <div className="max-w-xs">
            <p className="text-sm font-semibold">autocontent</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Autonomous short-form video pipelines with a spend cap and a
              feedback loop.
            </p>
            <div className="mt-6">
              <ThemeSwitcher />
            </div>
          </div>
          <nav className="flex gap-16">
            {COLUMNS.map((col) => (
              <div key={col.heading}>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  {col.heading}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a
                          className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                          href={l.href}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                          href={l.href}
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Oversized wordmark, clipped at the baseline — the reveal payoff. */}
        <div aria-hidden className="select-none overflow-hidden">
          <p className="translate-y-[0.28em] bg-gradient-to-b from-foreground/15 to-transparent bg-clip-text text-center text-[18vw] font-bold leading-none tracking-tighter text-transparent sm:text-[13rem]">
            autocontent
          </p>
        </div>
      </div>
    </footer>
  );
}
