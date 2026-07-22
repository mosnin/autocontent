"use client";

// Square UI "marketing-dashboard" template sidebar, ported faithfully.
// Swaps per the port contract: mock nav -> real products/pages from
// lib/products, workspace dropdown -> marketer.sh wordmark, promo card ->
// Clerk account + credits, template mock-data imports removed.

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
} from "@/components/square/ui/sidebar";
import { Button } from "@/components/square/ui/button";
import { openCommandPalette } from "@/components/command-palette";
import { PRODUCTS, productForPath, type ProductId } from "@/lib/products";

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
  /** Account slot — defaults to Clerk's UserButton; previews pass a stub. */
  account?: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = productForPath(pathname);
  const activePages = active.groups
    .flatMap((g) => g.items)
    .filter((i) => !i.soon);

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
                      isActive={product.id === active.id}
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
                <Link href={item.href}>
                  <item.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>

        <div className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm w-full bg-background group-data-[collapsible=icon]:hidden">
          {account ?? <UserButton afterSignOutUrl="/" />}
          <Link
            href="/settings/billing"
            className="text-sm font-medium hover:underline"
          >
            Get more credits
          </Link>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
