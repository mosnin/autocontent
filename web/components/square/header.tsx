"use client";

// Square UI "marketing-dashboard" template header, ported faithfully.
// Swaps per the port contract: static "Campaigns" label -> the active
// product page derived from lib/products, theme toggle skipped (app is
// light-only), GitHub promo button -> the real "New campaign" action,
// plus the ⌘K search pill wired to the command palette.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { openCommandPalette } from "@/components/command-palette";
import { productForPath } from "@/lib/products";
import { PRODUCT_ICONS } from "@/components/square/sidebar";

export function SquareHeader() {
  const pathname = usePathname();
  const active = productForPath(pathname);

  const isHome = pathname === "/home";
  const Icon = isHome ? House : PRODUCT_ICONS[active.id];

  // Longest matching page href wins so nested routes label correctly.
  const page = active.groups
    .flatMap((g) => g.items)
    .filter((i) => !i.soon)
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const label = isHome ? "Home" : (page?.label ?? active.label);

  return (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b bg-card sticky top-0 z-10 w-full shrink-0">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="-ml-2" />
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{label}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openCommandPalette}
          className="hidden sm:flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Search
          <kbd className="rounded border bg-card px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
        <Button size="sm" asChild>
          <Link href="/campaigns">New campaign</Link>
        </Button>
      </div>
    </header>
  );
}
