"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { productForPath } from "@/lib/products";

/**
 * One continuous system: the sidebar uses the primitive's real `inset`
 * variant, so the content panel's float (rounded, soft shadow, m-2) comes
 * from the same component family as the rail it sits beside — nothing
 * hand-rolled, nothing "glued on".
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider
      className="bg-page"
      style={
        {
          // Dual-rail: 3.5rem icon rail + nav panel when expanded; the
          // floating variant adds 0.5rem padding around the card.
          "--sidebar-width": "19rem",
          "--sidebar-width-icon": "4.5rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="flex min-h-svh flex-1 flex-col overflow-hidden bg-card md:my-2 md:me-2 md:ms-0 md:rounded-2xl md:border md:border-border/50 md:shadow-sm">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/50 px-4">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator className="mr-1 h-4" orientation="vertical" />
          <ProductCrumb />
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * A minimal product breadcrumb: "Home / <Product>". Anchors the user in the
 * suite so switching products always reads as moving between distinct apps.
 */
function ProductCrumb() {
  const pathname = usePathname();
  const isHome = pathname === "/home";
  const product = productForPath(pathname);

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm">
        <li>
          <Link
            href="/home"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Home
          </Link>
        </li>
        {!isHome && (
          <>
            <li aria-hidden className="text-muted-foreground/50">
              /
            </li>
            <li className="truncate font-medium">{product.label}</li>
          </>
        )}
      </ol>
    </nav>
  );
}
