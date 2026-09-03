"use client";

import * as React from "react";
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
} from "@/components/ui/sidebar";
import { Logo } from "@/components/marketing/nav/logo";
import { openCommandPalette } from "@/components/command-palette";
import { visibleProducts, productForPath, type ProductId } from "@/lib/products";
import { useAdsEnabled } from "@/lib/use-ads-enabled";
import { cn } from "@/lib/utils";
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
  account?: React.ReactNode;
}) {
  const pathname = usePathname();
  const adsEnabled = useAdsEnabled();
  const products = visibleProducts(adsEnabled);
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
    <Sidebar
      className="border-border !border-r bg-background"
      collapsible="offcanvas"
      {...props}
    >
      <SidebarHeader className="px-3 py-3">
        <div className="flex w-full items-center justify-between">
          <Logo href="/home" />
          <button
            aria-label="Search"
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-ring inline-flex size-10 items-center justify-center rounded-full border transition-colors"
            onClick={openCommandPalette}
            type="button"
          >
            <Search className="size-3.5" />
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {products.map((product) => {
                const Icon = PRODUCT_ICONS[product.id];
                const isActive = !onHub && product.id === active.id;
                return (
                  <SidebarMenuItem key={product.id}>
                    <SidebarMenuButton
                      asChild
                      className={cn(
                        "h-10 rounded-full px-3",
                        isActive &&
                          "bg-foreground text-background hover:bg-foreground hover:text-background",
                      )}
                      isActive={isActive}
                    >
                      <Link href={product.home}>
                        <Icon className="size-4 shrink-0" />
                        <span className="text-sm font-medium">{product.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4 p-0">
          <SidebarGroupLabel className="text-muted-foreground px-3 text-[11px] font-medium tracking-wider uppercase">
            {active.label}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
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
                      className={cn(
                        "h-9 rounded-full px-3",
                        current && "bg-muted text-foreground",
                      )}
                      isActive={current}
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

      <SidebarFooter className="px-3 pb-4">
        <SidebarMenu>
          {bottomNavItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild className="h-9 rounded-full px-3">
                <Link
                  href={item.href}
                  rel={"newTab" in item && item.newTab ? "noreferrer" : undefined}
                  target={"newTab" in item && item.newTab ? "_blank" : undefined}
                >
                  <item.icon className="text-muted-foreground size-4 shrink-0" />
                  <span className="text-sm">{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>

        <div className="border-border mt-2 flex w-full items-center justify-between gap-2 rounded-3xl border p-3 text-sm group-data-[collapsible=icon]:hidden">
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
