"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { motion, useReducedMotion } from "motion/react";

import { DashboardSwitcher } from "@/components/dashboard-switcher";
import { productForPath } from "@/lib/products";
import { cn } from "@/lib/utils";

/**
 * Reference-style shell, light aesthetic: a sticky top bar (wordmark,
 * search pill, the center dashboard switcher, credits + create + account
 * on the right) with the active product's pages as a tab row beneath it.
 * No sidebar — navigation lives entirely in the two top rows, like the
 * reference's toolbar-first layout.
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-[#f6f7f9]">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-white/85 backdrop-blur-xl">
        <div className="relative mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 md:px-6">
          <Link
            className="flex shrink-0 items-center gap-2 rounded-full py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/home"
          >
            <svg
              aria-hidden
              className="size-5 text-foreground"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.25"
              viewBox="0 0 24 24"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            <span className="hidden text-[16px] font-bold tracking-tight sm:inline">
              marketer.sh
            </span>
          </Link>

          {/* Search pill — surfaces the ⌘K palette. */}
          <span className="hidden items-center gap-2 rounded-full border border-border/70 bg-muted/60 px-3.5 py-1.5 text-xs text-muted-foreground xl:flex">
            <svg
              aria-hidden
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.5-4.5" />
            </svg>
            Search
            <kbd className="rounded border border-border/70 bg-card px-1.5 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </span>

          {/* Center pill switcher — the suite's five dashboards. */}
          <div className="pointer-events-none absolute inset-x-0 hidden justify-center lg:flex">
            <DashboardSwitcher className="pointer-events-auto bg-white/70 shadow-sm" />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <Link
              className="hidden items-center gap-1.5 rounded-full border border-amber-500/40 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(244,63,94,0.10))] px-4 py-1.5 text-[13px] font-semibold transition-colors hover:border-amber-500/70 md:flex"
              href="/settings/billing"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-[linear-gradient(135deg,#f59e0b,#f43f5e)]"
              />
              Get more credits
            </Link>
            <Link
              className="hidden rounded-full bg-zinc-900 px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-zinc-800 sm:block"
              href="/campaigns"
            >
              New campaign
            </Link>
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>

        {/* Mobile switcher row (the center pills need lg+ in the bar). */}
        <div className="overflow-x-auto border-t border-border/50 px-4 py-2 lg:hidden">
          <DashboardSwitcher className="w-max" />
        </div>

        <ProductTabs />
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-4 py-8 md:px-6 md:py-10">
        {children}
      </main>
    </div>
  );
}

/**
 * The active product's pages as a slim tab row under the top bar — the
 * sidebar's replacement. The underline glides between tabs.
 */
function ProductTabs() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  if (pathname === "/home") return null;
  const product = productForPath(pathname);
  const items = product.groups.flatMap((g) => g.items).filter((i) => !i.soon);
  if (items.length < 2) return null;

  return (
    <nav
      aria-label={`${product.label} pages`}
      className="overflow-x-auto border-t border-border/50 bg-white/60"
    >
      <div className="mx-auto flex h-11 w-max min-w-full max-w-[1440px] items-center gap-1 px-4 md:px-6">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              className={cn(
                "relative flex h-full items-center px-3 text-[13px] font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              href={item.href}
              key={item.href}
            >
              {item.label}
              {active && (
                <motion.span
                  aria-hidden
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground"
                  layoutId="product-tab-underline"
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 420, damping: 36 }
                  }
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
