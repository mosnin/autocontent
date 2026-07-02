"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  Settings,
} from "lucide-react";

import { ThemeSwitcher } from "@/components/theme-switcher";
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

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const OPERATE: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/queue", label: "Queue", icon: ListChecks },
];

const CONFIGURE: NavItem[] = [
  { href: "/connect", label: "Connect", icon: Link2 },
  { href: "/settings/tokens", label: "Tokens", icon: KeyRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            // Exact match or any descendant of the same segment — but let a
            // more specific sibling (e.g. /settings/tokens) win over
            // /settings.
            const active =
              pathname === item.href ||
              (item.href !== "/settings" &&
                pathname.startsWith(`${item.href}/`)) ||
              (item.href === "/settings" &&
                pathname.startsWith("/settings/") &&
                !pathname.startsWith("/settings/tokens"));

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={item.label}
                >
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
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          className="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          href="/dashboard"
        >
          {/* The closed-loop mark, same as the marketing site. */}
          <svg
            aria-hidden
            className="size-5 shrink-0 text-brand"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          <span className="truncate font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            autocontent
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <NavGroup items={OPERATE} label="Operate" />
        <NavGroup items={CONFIGURE} label="Configure" />
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
