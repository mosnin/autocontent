"use client";

// Dual-rail sidebar, recreated from the reference: a narrow icon rail where
// every product is always visible (logo mark up top, soft gray tile on the
// active product, account pinned at the bottom) fused in one card with a
// panel showing the active product's nav — title, a search field, icon+label
// rows, and collapsible groups whose text-only sub-items hang off a left
// tree line. Collapsing the sidebar leaves just the rail.

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, MonitorIcon, MoonIcon, Search, SunIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  PRODUCTS,
  productForPath,
  type NavEntry,
  type NavSection,
  type Product,
} from "@/lib/products";

/* ----------------------------------------------------------------- rail */

function RailIcon({
  product,
  active,
}: {
  product: Product;
  active: boolean;
}) {
  const Icon = product.icon;
  const reduced = useReducedMotion();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={product.home}
          aria-label={product.label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex size-9 items-center justify-center rounded-lg transition-colors",
            active
              ? "text-foreground"
              : "text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {/* A single shared highlight that slides between products as the
              active one changes — the rail's signature bit of life. */}
          {active && (
            <motion.span
              aria-hidden
              layoutId={reduced ? undefined : "rail-active"}
              className="absolute inset-0 rounded-lg bg-muted"
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
            />
          )}
          <Icon className="relative size-[17px]" aria-hidden />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{product.label}</TooltipContent>
    </Tooltip>
  );
}

/** Single-glyph theme cycler for the rail (light → dark → system). */
function RailThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const order = ["light", "dark", "system"] as const;
  const current = mounted ? ((theme as (typeof order)[number]) ?? "system") : "system";
  const next = order[(order.indexOf(current) + 1) % order.length];
  const Icon =
    current === "light" ? SunIcon : current === "dark" ? MoonIcon : MonitorIcon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setTheme(next)}
          aria-label={`Theme: ${current}. Switch to ${next}`}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="capitalize">
        {current} theme
      </TooltipContent>
    </Tooltip>
  );
}

function Rail({ active }: { active: Product }) {
  return (
    <div className="flex w-14 shrink-0 flex-col items-center border-e border-border/40 py-3">
      {/* Logo mark → the suite launcher. */}
      <Link
        href="/home"
        aria-label="marketer.sh: all products"
        className="flex size-9 items-center justify-center rounded-[10px] transition-opacity hover:opacity-80"
        style={{ background: "var(--gradient-warm)" }}
      >
        <span className="text-[15px] font-bold leading-none text-white">m</span>
      </Link>

      <nav aria-label="Products" className="mt-5 flex flex-col gap-1.5">
        {PRODUCTS.map((p) => (
          <RailIcon key={p.id} product={p} active={p.id === active.id} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-2.5 pb-1">
        <RailThemeToggle />
        <UserButton afterSignOutUrl="/" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- panel */

function SearchField() {
  return (
    <button
      type="button"
      onClick={() =>
        // The command palette listens for ⌘K on window — drive it directly.
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true }),
        )
      }
      className="flex h-9 w-full items-center gap-2 rounded-lg bg-muted/70 px-3 text-sm text-muted-foreground/70 transition-colors hover:bg-muted hover:text-muted-foreground"
    >
      <Search className="size-3.5" aria-hidden />
      Search
      <kbd className="ms-auto font-mono text-[10px] text-muted-foreground/50">
        ⌘K
      </kbd>
    </button>
  );
}

function LeafRow({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        className={cn(
          "h-9 rounded-lg px-2.5 text-[13.5px] transition-colors",
          active
            ? "bg-muted font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
        >
          <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function GroupRows({
  group,
  pathname,
  onNavigate,
}: {
  group: NavSection;
  pathname: string;
  onNavigate: () => void;
}) {
  const containsActive = group.items.some(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );
  const [open, setOpen] = React.useState(true);
  const Icon = group.icon;
  const subId = React.useId();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={subId}
        className={cn(
          "h-9 rounded-lg px-2.5 text-[13.5px] transition-colors",
          containsActive && !open
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
        <span>{group.label}</span>
        <ChevronDown
          className={cn(
            "ms-auto size-3.5 opacity-50 transition-transform",
            !open && "-rotate-90",
          )}
          aria-hidden
        />
      </SidebarMenuButton>
      {open && (
        <SidebarMenuSub id={subId} className="ms-4 border-s border-border/60 ps-3">
          {group.items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            if (item.soon) {
              return (
                <SidebarMenuSubItem key={item.href}>
                  <span className="flex h-8 cursor-default items-center rounded-lg px-2.5 text-[13px] text-muted-foreground/45">
                    {item.label}
                    <span className="ms-auto text-[10px] uppercase tracking-wider text-muted-foreground/35">
                      Soon
                    </span>
                  </span>
                </SidebarMenuSubItem>
              );
            }
            return (
              <SidebarMenuSubItem key={item.href}>
                <SidebarMenuSubButton
                  asChild
                  isActive={active}
                  className={cn(
                    "h-8 rounded-lg px-2.5 text-[13px] transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    {item.label}
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

function Panel({ product }: { product: Product }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const { isMobile, setOpenMobile } = useSidebar();
  const onNavigate = React.useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  return (
    <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
      <div className="space-y-4 px-4 pb-2 pt-4">
        <h2 className="text-[17px] font-semibold tracking-tight">
          {product.label}
        </h2>
        <SearchField />
      </div>
      <SidebarContent className="px-2 pb-4">
        {/* Re-key on the product so switching apps softly fades the nav in,
            reinforcing that each product is its own space. */}
        <motion.div
          key={product.id}
          initial={reduced ? false : { opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
        <SidebarMenu className="gap-0.5">
          {product.nav.map((entry: NavEntry) =>
            entry.kind === "item" ? (
              <LeafRow
                key={entry.href}
                href={entry.href}
                label={entry.label}
                icon={entry.icon}
                active={
                  pathname === entry.href ||
                  (pathname.startsWith(`${entry.href}/`) &&
                    // an index-style row must not light up for a sibling's
                    // deeper route that another entry owns exactly
                    !product.nav.some(
                      (o) =>
                        o.kind === "item" &&
                        o !== entry &&
                        o.href.startsWith(`${entry.href}/`),
                    ))
                }
                onNavigate={onNavigate}
              />
            ) : (
              <GroupRows
                key={entry.label}
                group={entry}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ),
          )}
        </SidebarMenu>
        </motion.div>
      </SidebarContent>
    </div>
  );
}

/* ----------------------------------------------------------------- root */

export function AppSidebar() {
  const pathname = usePathname();
  const product = productForPath(pathname);

  return (
    <Sidebar collapsible="icon" variant="floating">
      <div className="flex h-full min-h-0">
        <Rail active={product} />
        <Panel product={product} />
      </div>
      <SidebarRail />
    </Sidebar>
  );
}
