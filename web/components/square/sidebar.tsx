"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
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

export const PRODUCT_ICONS: Record<ProductId, LucideIcon> = {
  campaigns: Megaphone,
  studio: Clapperboard,
  press: Newspaper,
  ads: Target,
  suite: LayoutGrid,
};

const bottomNavItems = [
  { title: "Help", icon: HelpCircle, href: "/resources/faq" },
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
  const activePages = active.groups
    .flatMap((g) => g.items)
    .filter((i) => !i.soon);

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
                const isActive = product.id === active.id;
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
                <Link href={item.href}>
                  <item.icon className="text-muted-foreground size-4 shrink-0" />
                  <span className="text-sm">{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>

        <div className="border-border mt-2 flex w-full items-center justify-between gap-2 rounded-3xl border p-3 text-sm group-data-[collapsible=icon]:hidden">
          {account ?? <UserButton afterSignOutUrl="/" />}
          <Link
            className="text-sm font-medium underline-offset-4 hover:underline"
            href="/settings/billing"
          >
            Get more credits
          </Link>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
