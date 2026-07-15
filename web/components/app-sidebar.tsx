"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";

import { AppSwitcher } from "@/components/app-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
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
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { productForPath, type NavGroup } from "@/lib/products";

function NavGroupView({ group }: { group: NavGroup }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
        {group.label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {group.items.map((item) => {
            // A nav item is active on an exact match or any descendant route,
            // but an index-style link must not light up for a deeper sibling.
            const isIndex = group.items.some(
              (other) =>
                other !== item && other.href.startsWith(`${item.href}/`),
            );
            const active =
              pathname === item.href ||
              (!isIndex && pathname.startsWith(`${item.href}/`));

            if (item.soon) {
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    disabled
                    tooltip={`${item.label} — coming soon`}
                    className="h-8 cursor-default px-3 text-[13px] text-muted-foreground/50"
                  >
                    <span>{item.label}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/40 group-data-[collapsible=icon]:hidden">
                      Soon
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            }

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={item.label}
                  className={cn(
                    "h-8 px-3 text-[13px] transition-colors",
                    active
                      ? "bg-sidebar-accent font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Link
                    aria-current={active ? "page" : undefined}
                    href={item.href}
                    onClick={() => {
                      if (isMobile) setOpenMobile(false);
                    }}
                  >
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const product = productForPath(pathname);
  // Each product's single primary action, rendered as one quiet button —
  // not a competing second visual system.
  const primaryAction =
    product.id === "studio"
      ? { href: "/onboarding", label: "New channel" }
      : product.id === "press"
        ? { href: "/articles", label: "New article" }
        : null;

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="px-2 pt-2">
        <AppSwitcher active={product} />
      </SidebarHeader>

      <SidebarContent className="px-1 pt-2">
        {primaryAction && (
          <div className="px-2 pb-1 group-data-[collapsible=icon]:hidden">
            <Button
              asChild
              className="w-full justify-center"
              size="sm"
              variant="outline"
            >
              <Link href={primaryAction.href}>{primaryAction.label}</Link>
            </Button>
          </div>
        )}
        {product.groups.map((group) => (
          <NavGroupView key={group.label} group={group} />
        ))}
      </SidebarContent>

      <SidebarFooter className="px-3 pb-3">
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col">
          <UserButton afterSignOutUrl="/" />
          <div className="group-data-[collapsible=icon]:hidden">
            <ThemeSwitcher />
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
