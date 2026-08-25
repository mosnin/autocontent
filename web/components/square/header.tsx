"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/square/theme-toggle";
import { openCommandPalette } from "@/components/command-palette";
import { productForPath } from "@/lib/products";
import { PRODUCT_ICONS } from "@/components/square/sidebar";

export function SquareHeader() {
  const pathname = usePathname();
  const active = productForPath(pathname);

  const isHome = pathname === "/home";
  const Icon = isHome ? House : PRODUCT_ICONS[active.id];

  const page = active.groups
    .flatMap((g) => g.items)
    .filter((i) => !i.soon)
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const label = isHome ? "Home" : (page?.label ?? active.label);

  return (
    <header className="border-border bg-background sticky top-0 z-10 flex w-full shrink-0 items-center justify-between gap-4 border-b px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="-ml-2 rounded-full" />
        <div className="flex items-center gap-2">
          <Icon className="text-muted-foreground size-4" />
          <span className="text-sm font-medium tracking-tight">{label}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openCommandPalette}
          className="border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-ring hidden items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-colors sm:flex"
        >
          Search
          <kbd className="border-border rounded-full border px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
        <ThemeToggle />
        <Link
          className="bg-foreground text-background focus-ring inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition-opacity hover:opacity-85"
          href="/campaigns"
        >
          New campaign
        </Link>
      </div>
    </header>
  );
}
