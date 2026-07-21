"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { motion, useReducedMotion } from "motion/react";

import { DashboardSwitcher } from "@/components/dashboard-switcher";
import { PRODUCTS, productForPath } from "@/lib/products";
import { cn } from "@/lib/utils";

/**
 * Reference-style shell, light aesthetic: sticky top bar (wordmark,
 * search pill, the center dashboard switcher, credits + create + account)
 * with a real left sidebar underneath — the active product's pages as
 * working links, then the rest of the suite. Mirrors the reference's
 * top-nav + catalog-rail anatomy.
 */
export function SiteShell({
  children,
  account,
}: {
  children: React.ReactNode;
  /** Account slot — defaults to Clerk's UserButton; previews pass a stub. */
  account?: React.ReactNode;
}) {
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
            {account ?? <UserButton afterSignOutUrl="/" />}
          </div>
        </div>

        {/* Mobile switcher row (the center pills need lg+ in the bar). */}
        <div className="overflow-x-auto border-t border-border/50 px-4 py-2 lg:hidden">
          <DashboardSwitcher className="w-max" />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1440px]">
        <ProductSidebar />
        <main className="min-w-0 flex-1 px-4 py-8 md:px-6 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The left rail: the active product's pages as real links with active
 * states, then the rest of the suite for one-click jumps. Hidden on
 * small screens (the mobile switcher row covers navigation there).
 */
function ProductSidebar() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const active = productForPath(pathname);
  const isHome = pathname === "/home";

  return (
    <aside
      aria-label="Product navigation"
      className="sticky top-16 hidden h-[calc(100svh-4rem)] w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border/60 px-4 py-6 lg:flex"
    >
      {!isHome && (
        <nav aria-label={`${active.label} pages`}>
          <p className="px-2 pb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {active.label}
          </p>
          <ul className="space-y-0.5">
            {active.groups
              .flatMap((g) => g.items)
              .filter((i) => !i.soon)
              .map((item) => {
                const current =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "relative block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        current
                          ? "text-foreground"
                          : "text-muted-foreground hover:bg-zinc-900/[0.04] hover:text-foreground",
                      )}
                      href={item.href}
                    >
                      {current && (
                        <motion.span
                          aria-hidden
                          className="absolute inset-0 rounded-lg border border-border/70 bg-card shadow-sm"
                          layoutId="sidebar-active"
                          transition={
                            reduced
                              ? { duration: 0 }
                              : { type: "spring", stiffness: 420, damping: 36 }
                          }
                        />
                      )}
                      <span className="relative">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </nav>
      )}

      <nav aria-label="Products" className={cn(!isHome && "border-t border-border/60 pt-5")}>
        <p className="px-2 pb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Products
        </p>
        <ul className="space-y-0.5">
          {PRODUCTS.map((p) => (
            <li key={p.id}>
              <Link
                className={cn(
                  "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  !isHome && p.id === active.id
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-zinc-900/[0.04] hover:text-foreground",
                )}
                href={p.home}
              >
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
