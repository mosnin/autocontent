"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

import { PRODUCTS, productForPath } from "@/lib/products";
import { cn } from "@/lib/utils";

/**
 * The reference-style center pill nav: one segmented control that jumps
 * between the product dashboards (Campaigns / Content / SEO / Ads / Suite).
 * The active pill glides between items via a shared layout animation.
 * Light-theme rendition of the reference's dark toolbar.
 */
export function DashboardSwitcher({ className }: { className?: string }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const active = pathname === "/home" ? null : productForPath(pathname);

  return (
    <nav
      aria-label="Product dashboards"
      className={cn(
        "flex items-center gap-0.5 rounded-full border border-border/70 bg-muted/60 p-1",
        className,
      )}
    >
      {PRODUCTS.map((p) => {
        const isActive = active?.id === p.id;
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            href={p.home}
            key={p.id}
          >
            {isActive && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full bg-primary shadow-sm"
                layoutId="dashboard-switcher-pill"
                transition={
                  reduced
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 420, damping: 34 }
                }
              />
            )}
            <span className="relative">{p.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
