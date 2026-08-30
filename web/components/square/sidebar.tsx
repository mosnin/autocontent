"use client";

// Square UI "marketing-dashboard" template sidebar, ported faithfully.
// Swaps per the port contract: mock nav -> real products/pages from
// lib/products, workspace dropdown -> marketer.sh wordmark, promo card ->
// Clerk account + credits, template mock-data imports removed.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountAvatar } from "@/components/user-avatar";
import {
  Clapperboard,
  HelpCircle,
  LayoutGrid,
  Megaphone,
  Newspaper,
  Search,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/square/ui/sidebar";
import { Button } from "@/components/square/ui/button";
import { openCommandPalette } from "@/components/command-palette";
import { PRODUCTS, productForPath, type ProductId } from "@/lib/products";
import useSWR from "swr";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";

export const PRODUCT_ICONS: Record<ProductId, LucideIcon> = {
  campaigns: Megaphone,
  studio: Clapperboard,
  press: Newspaper,
  ads: Target,
  suite: LayoutGrid,
};

const bottomNavItems = [
  // Opens in a new tab: the FAQ lives on the marketing site, and Help must
  // never eject someone out of the app they were working in.
  { title: "Help", icon: HelpCircle, href: "/resources/faq", newTab: true },
  { title: "Settings", icon: Settings, href: "/settings" },
];

export function SquareSidebar({
  account,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  /** Account slot — defaults to Clerk's UserButton; previews pass a stub. */
  account?: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = productForPath(pathname);
  // The hub is home to every product — highlighting one there is a lie.
  const onHub = pathname === "/home";
  // Admin destinations render only for admins; everyone else never sees a
  // door that opens onto "Not authorized".
  const { data: me } = useSWR<{ role?: string }>("/api/v1/users/me", clientFetch, {
    revalidateOnFocus: false,
  });
  const isAdmin = me?.role === "admin";
  const activePages = active.groups
    .filter((g) => g.label !== "Admin" || isAdmin)
    .flatMap((g) => g.items);

  return (
    <Sidebar collapsible="offcanvas" className="!border-r-0" {...props}>
      <SidebarHeader className="px-3 py-3">
        <div className="flex items-center justify-between w-full">
          <Link
            href="/home"
            className="flex items-center gap-2 outline-none w-full justify-start"
          >
            <svg
              aria-hidden
              className="size-5 shrink-0 text-foreground"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.25"
              viewBox="0 0 24 24"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">
              marketer.sh
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            aria-label="Search"
            onClick={openCommandPalette}
          >
            <Search className="size-3.5" />
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {PRODUCTS.map((product) => {
                const Icon = PRODUCT_ICONS[product.id];
                return (
                  <SidebarMenuItem key={product.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={!onHub && product.id === active.id}
                      className="h-9"
                    >
                      <Link href={product.home}>
                        <Icon className="size-4 shrink-0" />
                        <span className="text-sm">{product.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="p-0 mt-2">
          <div className="flex items-center justify-between px-2 py-1">
            <SidebarGroupLabel className="px-0 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {active.label}
            </SidebarGroupLabel>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {activePages.map((item) => {
                const current =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                if (item.soon) {
                  // Coming-soon pages announce themselves instead of being
                  // silently absent — visible, labeled, not clickable.
                  return (
                    <SidebarMenuItem key={item.href}>
                      <div
                        aria-disabled
                        className="flex h-8 items-center justify-between rounded-md px-2 text-sm text-muted-foreground/60"
                      >
                        {item.label}
                        <span className="rounded-full border px-1.5 text-[10px] uppercase tracking-wide">
                          Soon
                        </span>
                      </div>
                    </SidebarMenuItem>
                  );
                }
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={current}
                      className="h-8"
                    >
                      <Link href={item.href}>
                        <span className="text-sm">{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-2 pb-3">
        <SidebarMenu>
          {bottomNavItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild className="h-9">
                <Link
                  href={item.href}
                  rel={"newTab" in item && item.newTab ? "noreferrer" : undefined}
                  target={"newTab" in item && item.newTab ? "_blank" : undefined}
                >
                  <item.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>

        <div className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm w-full bg-background group-data-[collapsible=icon]:hidden">
          {account ?? <AccountAvatar />}
          <CreditFooterLink />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * The shell's ambient money affordance: the actual balance, always visible,
 * linking to billing. Falls back to a plain "Credits" link until the number
 * loads; renders nothing extra when billing is disabled (self-hosted).
 */
function CreditFooterLink() {
  const { data } = useSWR<{ balance_usd: string; billing_enabled: boolean }>(
    "/api/v1/billing/balance?limit=1",
    clientFetch,
    { refreshInterval: 60_000 },
  );
  if (data && !data.billing_enabled) {
    return (
      <Link href="/settings/billing" className="text-sm font-medium hover:underline">
        Billing
      </Link>
    );
  }
  const balance = data ? Number(data.balance_usd) : null;
  return (
    <Link
      href="/settings/billing"
      className="text-sm font-medium tabular-nums hover:underline"
      title="Your prepaid credit — click to top up"
    >
      {balance === null ? "Credits" : `${formatUsd(balance)} credit`}
    </Link>
  );
}
