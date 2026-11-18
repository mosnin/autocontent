"use client";

import { BarChart3, Brain, CalendarDays, Clapperboard, Compass, FileText, FolderOpen, Megaphone, PanelLeft, Plug, Plus, Search, Send, Settings, Shield, Sparkles } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { CountBadge, IconButton, Segmented, SidebarAttention, SidebarRow, SidebarSection, SidebarTextRow, ToolIcon, WorkspaceRow, type ToolTone } from "@/design-system";
import { DEPARTMENTS, type DepartmentId } from "@/lib/departments";
import type { Inbox } from "@/lib/workspace";
import { useAgent } from "@/components/chat/agent-provider";
import { GettingStarted, type SetupStep } from "./getting-started";

export interface SidebarData {
  brandName: string;
  inbox: Inbox | null;
  steps: SetupStep[];
  isAdmin: boolean;
  account?: ReactNode;
}

/** Each tool's icon and colour, the same everywhere (ref 02/05 "Tools"). */
export const TOOL_ICON: Record<DepartmentId, { icon: ReactNode; tone: ToolTone }> = {
  strategy: { icon: <Compass />, tone: "d" },
  content: { icon: <Clapperboard />, tone: "a" },
  seo: { icon: <FileText />, tone: "c" },
  paid: { icon: <Megaphone />, tone: "b" },
  distribution: { icon: <Send />, tone: "f" },
  analytics: { icon: <BarChart3 />, tone: "e" },
};

const at = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * The sidebar, built from ref 02 and ref 05: workspace row, Home | Activity,
 * the main rows, Tools, Awaiting action, Chat (recents), and the footer.
 */
export function Sidebar({ data, onNavigate, onSearch, onCollapse }: { data: SidebarData; onNavigate?: () => void; onSearch: () => void; onCollapse?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { threads, state } = useAgent();
  const waiting = data.inbox?.counts.total ?? 0;
  const recents = (threads?.threads ?? []).slice(0, 8);

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <WorkspaceRow
        name={data.brandName}
        actions={
          <>
            <IconButton label="Search (⌘K)" onClick={onSearch}>
              <Search />
            </IconButton>
            {onCollapse && (
              <IconButton label="Hide sidebar" onClick={onCollapse}>
                <PanelLeft />
              </IconButton>
            )}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        <Segmented
          label="Home or activity"
          className="mb-2 flex w-full"
          value={at(pathname, "/activity") || at(pathname, "/inbox") ? "activity" : "home"}
          onChange={(v) => (router.push(v === "home" ? "/home" : "/activity"), onNavigate?.())}
          options={[
            { value: "home", label: "Home" },
            { value: "activity", label: <>Activity <CountBadge count={waiting} /></> },
          ]}
        />

        <SidebarSection>
          <SidebarRow href="/sessions/new" icon={<Plus />} label="New session" current={pathname === "/sessions/new"} onClick={onNavigate} />
          <SidebarRow href="/analytics" icon={<BarChart3 />} label="Analytics" current={at(pathname, "/analytics")} onClick={onNavigate} />
          <SidebarRow href="/plan" icon={<CalendarDays />} label="Plan" current={at(pathname, "/plan")} onClick={onNavigate} />
          <SidebarRow href="/library" icon={<FolderOpen />} label="Deliverables" current={at(pathname, "/library")} onClick={onNavigate} />
        </SidebarSection>

        <SidebarSection title="Tools">
          {DEPARTMENTS.filter((d) => d.id !== "analytics").map((d) => (
            <SidebarRow
              key={d.id}
              href={d.href}
              icon={<ToolIcon tone={TOOL_ICON[d.id].tone}>{TOOL_ICON[d.id].icon}</ToolIcon>}
              label={d.id === "strategy" ? "Playbooks" : d.label}
              current={at(pathname, d.href)}
              onClick={onNavigate}
            />
          ))}
        </SidebarSection>

        <SidebarAttention title="Awaiting action" onNavigate={onNavigate} items={(data.inbox?.items ?? []).map((it) => ({ id: it.id, label: it.title, href: `/inbox?focus=${encodeURIComponent(it.id)}` }))} />

        <SidebarSection title="Chat">
          {state.status === "ready" && recents.length > 0 ? (
            recents.map((t) => {
              const href = `/sessions/${encodeURIComponent(t.conversationId)}`;
              return <SidebarTextRow key={t.conversationId} href={href} label={t.title || "Untitled session"} current={pathname === href} onClick={onNavigate} />;
            })
          ) : (
            <div className="px-2 py-1 text-[13px] text-fg-faint">No chat</div>
          )}
        </SidebarSection>
      </div>

      <div className="shrink-0 space-y-px border-t border-hairline px-2.5 py-2">
        <SidebarRow href="/brand" icon={<Sparkles />} label="Brand" current={at(pathname, "/brand")} onClick={onNavigate} />
        <SidebarRow href="/memory" icon={<Brain />} label="Memory" current={at(pathname, "/memory")} onClick={onNavigate} />
        <SidebarRow href="/integrations" icon={<Plug />} label="Integrations" current={at(pathname, "/integrations")} onClick={onNavigate} />
        <SidebarRow href="/settings" icon={<Settings />} label="Settings" current={at(pathname, "/settings")} onClick={onNavigate} />
        {data.isAdmin && <SidebarRow href="/admin" icon={<Shield />} label="Admin" current={at(pathname, "/admin")} onClick={onNavigate} />}
        <GettingStarted steps={data.steps} onNavigate={onNavigate} />
        {data.account && <div className="flex items-center gap-2 px-1 pt-1.5">{data.account}</div>}
      </div>
    </nav>
  );
}
