"use client";

import { Menu as MenuIcon, Moon, PanelLeft, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cx, IconButton } from "@/design-system";
import { AgentProvider } from "@/components/chat/agent-provider";
import { CommandMenu } from "./command-menu";
import { Sidebar, type SidebarData } from "./sidebar";
import { setThemeCookie, themeClass, type AppTheme } from "./theme";

/**
 * The app window (refs 02, 05): sidebar and main divided by a hairline, dark
 * by default. On phones the sidebar becomes a drawer.
 */
export function AppShell({ data, account, theme: initialTheme = "dark", children }: { data: Omit<SidebarData, "account">; account?: ReactNode; theme?: AppTheme; children: ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<AppTheme>(initialTheme);
  const [hidden, setHidden] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);

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

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeCookie(next);
  };

  const accountRow = (
    <>
      {account}
      <IconButton label={theme === "dark" ? "Switch to light" : "Switch to dark"} onClick={toggleTheme} className="ml-auto">
        {theme === "dark" ? <Sun /> : <Moon />}
      </IconButton>
    </>
  );
  const sidebarData: SidebarData = { ...data, account: accountRow };

  return (
    <AgentProvider>
      <div className={cx(themeClass(theme), "flex h-dvh overflow-hidden")}>
        {!hidden && (
          <aside className="hidden w-[248px] shrink-0 border-r border-hairline bg-ds-sidebar md:block">
            <Sidebar data={sidebarData} onSearch={() => setSearch(true)} onCollapse={() => setHidden(true)} />
          </aside>
        )}

        {/* Phone drawer */}
        <div className={cx("fixed inset-0 z-40 md:hidden", drawer ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!drawer}>
          <div className={cx("absolute inset-0 transition-opacity duration-200", drawer ? "opacity-100" : "opacity-0")} style={{ background: "var(--ds-scrim)" }} onClick={() => setDrawer(false)} />
          <aside className={cx("absolute inset-y-0 left-0 w-[280px] max-w-[86vw] border-r border-hairline bg-ds-sidebar transition-transform duration-300 ease-[var(--ds-ease-drawer)]", drawer ? "translate-x-0" : "-translate-x-full")}>
            <Sidebar data={sidebarData} onNavigate={() => setDrawer(false)} onSearch={() => (setDrawer(false), setSearch(true))} />
          </aside>
        </div>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-ds-bg">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-2 md:hidden">
            <IconButton label="Open menu" onClick={() => setDrawer(true)}>
              <MenuIcon />
            </IconButton>
            <span className="text-[13.5px] font-medium">{data.brandName}</span>
          </div>
          {hidden && (
            <IconButton label="Show sidebar" onClick={() => setHidden(false)} className="absolute left-2 top-2.5 z-30 hidden md:flex">
              <PanelLeft />
            </IconButton>
          )}
          {children}
        </main>
        <CommandMenu open={search} onClose={() => setSearch(false)} theme={theme} />
      </div>
    </AgentProvider>
  );
}
