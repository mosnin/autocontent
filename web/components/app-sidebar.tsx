"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Plus } from "lucide-react";

import { AppSwitcher } from "@/components/app-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Badge } from "@/components/ui/badge";
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
import { productForPath, type NavGroup } from "@/lib/products";

function NavGroupView({ group }: { group: NavGroup }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => {
            const Icon = item.icon;
            // A nav item is active on an exact match or on any descendant
            // route, but an index-style link (its own product home) must not
            // light up for a deeper sibling. We treat the shortest routes as
            // index links by requiring exact match when another item in the
            // same group is a prefix of the current path.
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
                    className="cursor-not-allowed opacity-60"
                  >
                    <Icon />
                    <span>{item.label}</span>
                    <Badge
                      variant="secondary"
                      className="ml-auto text-[10px] group-data-[collapsible=icon]:hidden"
                    >
                      Soon
                    </Badge>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            }

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                  <Link
                    aria-current={active ? "page" : undefined}
                    href={item.href}
                    onClick={() => {
                      if (isMobile) setOpenMobile(false);
                    }}
                  >
                    <Icon />
                    <span>{item.label}</span>
                    {active ? (
                      <span
                        aria-hidden
                        className="ml-auto size-1.5 rounded-full bg-brand"
                      />
                    ) : null}
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
  // Studio keeps its "New channel" quick action; other products get their own
  // primary action (or none) as they mature.
  const primaryAction =
    product.id === "studio"
      ? { href: "/onboarding", label: "New channel" }
      : null;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <AppSwitcher active={product} />
      </SidebarHeader>

      {primaryAction && (
        <div className="px-2 pb-1 group-data-[collapsible=icon]:px-0">
          <Button
            asChild
            className="w-full justify-center bg-card shadow-sm group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0"
            size="sm"
            variant="outline"
          >
            <Link href={primaryAction.href}>
              <Plus className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">
                {primaryAction.label}
              </span>
            </Link>
          </Button>
        </div>
      )}

      <SidebarContent>
        {product.groups.map((group) => (
          <NavGroupView key={group.label} group={group} />
        ))}
      </SidebarContent>

      <SidebarFooter>
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
