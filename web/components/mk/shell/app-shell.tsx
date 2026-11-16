"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AgentProvider } from "../agent/agent-provider";
import { cx } from "../ui";
import { CommandMenu } from "./command-menu";
import { Sidebar, type SidebarData } from "./sidebar";

const COLLAPSE_KEY = "marketer.sidebar.collapsed";

/**
 * Two floating panels on a canvas, 6px apart (Podium DNA): the quiet sidebar
 * and the page. Edge to edge on phones, where the sidebar becomes a drawer.
 */
export function AppShell({ data, children }: { data: SidebarData; children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !v;
    });
  }, []);

  return (
    <AgentProvider>
      <div className="mk-app flex h-dvh gap-1.5 overflow-hidden md:p-1.5">
        {/* Desktop sidebar panel */}
        <aside className={cx("hidden shrink-0 overflow-hidden rounded-[14px] border border-border bg-background shadow-panel transition-[width] duration-[250ms] ease-[var(--ease-out)] md:block", collapsed ? "w-[60px]" : "w-[256px]")}>
          <Sidebar data={data} collapsed={collapsed} onToggleCollapse={toggle} onSearch={() => setSearch(true)} />
        </aside>

        {/* Mobile drawer */}
        <div className={cx("fixed inset-0 z-40 md:hidden", drawer ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!drawer}>
          <div className={cx("absolute inset-0 bg-black/30 transition-opacity duration-[250ms]", drawer ? "opacity-100" : "opacity-0")} onClick={() => setDrawer(false)} />
          <aside className={cx("absolute inset-y-0 left-0 w-[284px] max-w-[85vw] bg-background shadow-modal transition-transform duration-[350ms] ease-[var(--ease-drawer)]", drawer ? "translate-x-0" : "-translate-x-full")}>
            <Sidebar data={data} collapsed={false} onToggleCollapse={() => setDrawer(false)} onNavigate={() => setDrawer(false)} onSearch={() => (setDrawer(false), setSearch(true))} />
          </aside>
        </div>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background md:rounded-[14px] md:border md:border-border md:shadow-panel">
          {/* Phone top bar */}
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
            <button type="button" onClick={() => setDrawer(true)} className="press flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Open menu" title="Open menu">
              <Menu className="size-[18px]" />
            </button>
            <span className="text-[14px] font-medium">{data.brandName}</span>
          </div>
          {children}
        </main>
      </div>
      <CommandMenu open={search} onClose={() => setSearch(false)} />
    </AgentProvider>
  );
}
