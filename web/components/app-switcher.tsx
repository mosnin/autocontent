"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, LayoutGrid } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  PRODUCTS,
  productAccentClass,
  type Product,
} from "@/lib/products";

/**
 * The suite app-switcher — the Google-Workspace "grid" that jumps between the
 * distinct products (Studio / Press / Ads / Suite). Renders the active
 * product's tile as the trigger; the menu lists every product plus a link to
 * the suite launcher. Collapses to just the glyph when the sidebar is in icon
 * mode.
 */
export function AppSwitcher({ active }: { active: Product }) {
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Current product: ${active.label}. Switch products`}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
            "hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
          )}
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md text-white",
              productAccentClass(active.accent),
            )}
          >
            <ActiveIcon className="size-3.5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-[13px] font-semibold leading-tight tracking-tight">
              {active.label}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              marketer.sh
            </span>
          </span>
          <ChevronsUpDown
            className="size-3.5 shrink-0 text-muted-foreground/60 group-data-[collapsible=icon]:hidden"
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Products
        </DropdownMenuLabel>
        {PRODUCTS.map((product) => {
          const Icon = product.icon;
          const isActive = product.id === active.id;
          return (
            <DropdownMenuItem key={product.id} asChild>
              <Link href={product.home} className="gap-2.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md text-white",
                    productAccentClass(product.accent),
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-tight">
                    {product.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {product.tagline}
                  </span>
                </span>
                {isActive && (
                  <Check className="size-4 shrink-0 text-brand" aria-hidden />
                )}
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/home" className="gap-2.5 text-muted-foreground">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60">
              <LayoutGrid className="size-3.5" aria-hidden />
            </span>
            <span className="text-sm">All products</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
