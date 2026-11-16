"use client";

import {
  BarChart3,
  CalendarDays,
  ChevronsDown,
  ChevronsUpDown,
  Clapperboard,
  Compass,
  Inbox as InboxIcon,
  Library,
  Megaphone,
  Moon,
  PanelLeft,
  Plug,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  FileText,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useMemo, useState, type ReactNode } from "react";
import { DEPARTMENTS, type DepartmentId } from "@/lib/departments";
import type { Inbox } from "@/lib/workspace";
import { useAgent } from "../agent/agent-provider";
import { cx, Dot, Ring, Segmented } from "../ui";
import { GettingStarted, type SetupStep } from "./getting-started";

export interface SidebarData {
  brandName: string;
  inbox: Inbox | null;
  steps: SetupStep[];
  isAdmin: boolean;
  /** The account control (Clerk UserButton in the app, a stub in previews). */
  account?: ReactNode;
}

const DEPT_ICONS: Record<DepartmentId, ReactNode> = {
  strategy: <Compass />,
  content: <Clapperboard />,
  seo: <FileText />,
  paid: <Megaphone />,
  distribution: <Send />,
  analytics: <BarChart3 />,
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavRow({ href, icon, label, active, trailing, collapsed, onNavigate }: { href: string; icon?: ReactNode; label: string; active: boolean; trailing?: ReactNode; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cx(
        "press group flex h-[30px] items-center gap-[9px] rounded-lg px-2 text-[14px] transition-colors duration-150 [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      {icon}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && trailing}
    </Link>
  );
}

function SectionLabel({ children, collapsed }: { children: ReactNode; collapsed?: boolean }) {
  if (collapsed) return <div className="mx-auto my-2 h-px w-6 bg-border" />;
  return <div className="px-2 pb-1 pt-4 text-[13px] text-faint">{children}</div>;
}

export function Sidebar({ data, collapsed, onToggleCollapse, onNavigate, onSearch }: { data: SidebarData; collapsed: boolean; onToggleCollapse: () => void; onNavigate?: () => void; onSearch: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { threads, state } = useAgent();
  const [showAllAwaiting, setShowAllAwaiting] = useState(false);

  const segment = pathname.startsWith("/activity") ? "activity" : "home";
  const awaiting = data.inbox?.items ?? [];
  const awaitingShown = showAllAwaiting ? awaiting.slice(0, 8) : awaiting.slice(0, 3);
  const recents = useMemo(() => (threads?.threads ?? []).slice(0, 6), [threads?.threads]);
  const doneSteps = data.steps.filter((s) => s.done).length;

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      {/* Workspace switcher */}
      <div className={cx("flex h-[50px] shrink-0 items-center gap-1 px-3", collapsed && "justify-center px-0")}>
        {!collapsed && (
          <Link href="/home" onClick={onNavigate} className="press flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted/60">
            <span aria-hidden className="flex size-[22px] shrink-0 items-center justify-center rounded-[6px] bg-primary text-primary-foreground">
              <Sparkles className="size-3.5" strokeWidth={2} />
            </span>
            <span className="min-w-0 truncate text-[14px] font-medium">{data.brandName}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
          </Link>
        )}
        {!collapsed && (
          <button type="button" onClick={onSearch} className="press flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Search (⌘K)" title="Search (⌘K)">
            <Search className="size-[15px]" />
          </button>
        )}
        <button type="button" onClick={onToggleCollapse} className="press hidden size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground md:flex" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <PanelLeft className="size-[15px]" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!collapsed && (
          <Segmented
            label="Home or activity"
            value={segment}
            onChange={(v) => {
              router.push(v === "home" ? "/home" : "/activity");
              onNavigate?.();
            }}
            options={[
              { value: "home", label: "Home" },
              { value: "activity", label: "Activity" },
            ]}
            className="mb-2"
          />
        )}

        <div className="space-y-[2px]">
          <NavRow href="/sessions/new" icon={<Plus />} label="New session" active={pathname === "/sessions/new"} collapsed={collapsed} onNavigate={onNavigate} />
          <NavRow
            href="/inbox"
            icon={<InboxIcon />}
            label="Inbox"
            active={isActive(pathname, "/inbox")}
            collapsed={collapsed}
            onNavigate={onNavigate}
            trailing={data.inbox && data.inbox.counts.total > 0 ? <span className="flex items-center gap-1.5 text-[12px] text-faint tabular"><Dot tone="warn" label="Needs you" />{data.inbox.counts.total}</span> : undefined}
          />
          <NavRow href="/analytics" icon={<BarChart3 />} label="Analytics" active={isActive(pathname, "/analytics")} collapsed={collapsed} onNavigate={onNavigate} />
          <NavRow href="/plan" icon={<CalendarDays />} label="Plan" active={isActive(pathname, "/plan")} collapsed={collapsed} onNavigate={onNavigate} />
          <NavRow href="/library" icon={<Library />} label="Library" active={isActive(pathname, "/library")} collapsed={collapsed} onNavigate={onNavigate} />
        </div>

        <SectionLabel collapsed={collapsed}>Departments</SectionLabel>
        <div className="space-y-[2px]">
          {DEPARTMENTS.filter((d) => d.id !== "analytics").map((d) => (
            <NavRow key={d.id} href={d.href} icon={DEPT_ICONS[d.id]} label={d.id === "strategy" ? "Playbooks" : d.label} active={isActive(pathname, d.href)} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>

        {!collapsed && awaiting.length > 0 && (
          <div className="mt-4 rounded-[14px] bg-subtle p-1 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
            <div className="px-2 pb-0.5 pt-1.5 text-[12px] text-faint">Awaiting you</div>
            {awaitingShown.map((it) => (
              <Link key={it.id} href={`/inbox?focus=${encodeURIComponent(it.id)}`} onClick={onNavigate} className="press flex h-[30px] items-center gap-2 rounded-lg px-2 text-[13px] text-foreground hover:bg-muted">
                <Dot tone="warn" />
                <span className="min-w-0 truncate">{it.title}</span>
              </Link>
            ))}
            {awaiting.length > 3 && (
              <button type="button" onClick={() => setShowAllAwaiting((v) => !v)} className="press flex h-[28px] w-full items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-muted">
                <ChevronsDown className={cx("size-3.5 transition-transform duration-200", showAllAwaiting && "rotate-180")} />
                {showAllAwaiting ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        {!collapsed && (
          <>
            <SectionLabel>Recents</SectionLabel>
            {state.status === "ready" && recents.length > 0 ? (
              <div className="space-y-[2px]">
                {recents.map((t) => {
                  const href = `/sessions/${encodeURIComponent(t.conversationId)}`;
                  return (
                    <Link
                      key={t.conversationId}
                      href={href}
                      onClick={onNavigate}
                      className={cx("press flex h-[30px] items-center rounded-lg px-2 text-[14px] transition-colors", pathname === href ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
                    >
                      <span className="truncate">{t.title || "Untitled session"}</span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="px-2 text-[13px] text-faint">{state.status === "loading" ? "…" : "No sessions yet"}</p>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border px-3 py-2">
        <div className="space-y-[2px]">
          <NavRow href="/brand" icon={<Sparkles />} label="Brand" active={isActive(pathname, "/brand")} collapsed={collapsed} onNavigate={onNavigate} />
          <NavRow href="/integrations" icon={<Plug />} label="Integrations" active={isActive(pathname, "/integrations")} collapsed={collapsed} onNavigate={onNavigate} />
          <NavRow href="/settings" icon={<Settings />} label="Settings" active={isActive(pathname, "/settings")} collapsed={collapsed} onNavigate={onNavigate} />
          {data.isAdmin && <NavRow href="/admin" icon={<Shield />} label="Admin" active={isActive(pathname, "/admin")} collapsed={collapsed} onNavigate={onNavigate} />}
        </div>
        {!collapsed && doneSteps < data.steps.length && (
          <GettingStarted steps={data.steps} onNavigate={onNavigate}>
            <span className="flex w-full items-center gap-2.5 rounded-[14px] border border-border bg-card px-3 py-2 text-[13px] shadow-pill">
              <Ring value={doneSteps / Math.max(1, data.steps.length)} />
              <span className="flex-1 text-left font-medium">Getting started</span>
              <span className="text-faint tabular">
                {doneSteps} of {data.steps.length}
              </span>
            </span>
          </GettingStarted>
        )}
        <div className={cx("mt-2 flex items-center gap-1", collapsed ? "flex-col" : "justify-between px-1")}>
          {data.account}
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="press flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Toggle light and dark"
            title="Toggle light and dark"
          >
            <Moon className="size-[15px] dark:hidden" />
            <Sun className="hidden size-[15px] dark:block" />
          </button>
        </div>
      </div>
    </nav>
  );
}
