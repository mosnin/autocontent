"use client";

import { ArrowRight, CornerDownLeft, MessageSquarePlus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx, Kbd } from "@/design-system";
import { DEPARTMENTS } from "@/lib/departments";
import { useAgent } from "@/components/chat/agent-provider";
import { themeClass, type AppTheme } from "./theme";

const PLACES = [
  ["Home", "/home"],
  ["Activity", "/activity"],
  ["Inbox", "/inbox"],
  ["Analytics", "/analytics"],
  ["Plan", "/plan"],
  ["Deliverables", "/library"],
  ["Playbooks", "/playbooks"],
  ["Content", "/content"],
  ["SEO", "/seo"],
  ["Paid media", "/paid"],
  ["Distribution", "/distribution"],
  ["Brand", "/brand"],
  ["Integrations", "/integrations"],
  ["Settings", "/settings"],
] as const;

/** ⌘K (ref 03 "Search ⌘K"): ask Marketer, jump anywhere, reopen a chat. */
export function CommandMenu({ open, onClose, theme }: { open: boolean; onClose: () => void; theme: AppTheme }) {
  const router = useRouter();
  const { threads } = useAgent();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setI(0);
    setTimeout(() => input.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const go = (href: string) => (onClose(), router.push(href));
  const items = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list: { id: string; label: string; hint: string; run: () => void; ask?: boolean }[] = [];
    if (n) list.push({ id: "ask", label: `Ask Marketer: “${q.trim()}”`, hint: "New session", run: () => go(`/sessions/new?q=${encodeURIComponent(q.trim())}`), ask: true });
    for (const d of DEPARTMENTS) {
      const label = `Ask the ${d.agentName}`;
      if (!n || label.toLowerCase().includes(n)) list.push({ id: d.id, label, hint: d.label, run: () => go(`/sessions/new?dept=${d.id}`) });
    }
    for (const [label, href] of PLACES) if (!n || label.toLowerCase().includes(n)) list.push({ id: href, label, hint: "Go to", run: () => go(href) });
    for (const t of threads?.threads.slice(0, 20) ?? []) {
      const label = t.title || "Untitled session";
      if (!n || label.toLowerCase().includes(n)) list.push({ id: t.conversationId, label, hint: "Chat", run: () => go(`/sessions/${encodeURIComponent(t.conversationId)}`) });
    }
    return list.slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, threads?.threads]);

  if (!open) return null;
  const active = Math.min(i, Math.max(0, items.length - 1));
  return (
    <div className={cx(themeClass(theme), "fixed inset-0 z-[60] flex items-start justify-center bg-transparent px-4 pt-[14vh]")} style={{ background: "var(--ds-scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="combobox"
        aria-expanded
        aria-controls="cmdk-list"
        className="ds-pop w-full max-w-[560px] overflow-hidden rounded-ds-xl border border-hairline bg-overlay shadow-ds-modal"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setI((v) => Math.min(v + 1, items.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setI((v) => Math.max(v - 1, 0)));
          if (e.key === "Enter") (e.preventDefault(), items[active]?.run());
        }}
      >
        <div className="flex h-11 items-center gap-2.5 border-b border-hairline px-3.5">
          <Search className="size-4 text-fg-faint" />
          <input ref={input} value={q} onChange={(e) => (setQ(e.target.value), setI(0))} placeholder="Ask Marketer or search…" aria-label="Ask Marketer or search" className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-faint" />
          <Kbd>esc</Kbd>
        </div>
        <ul id="cmdk-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.map((c, idx) => (
            <li key={c.id} role="option" aria-selected={idx === active}>
              <button type="button" onMouseEnter={() => setI(idx)} onClick={c.run} className={cx("flex h-9 w-full items-center gap-2.5 rounded-ds-sm px-2.5 text-left text-[13px]", idx === active ? "bg-surface-2 text-fg" : "text-fg-muted")}>
                {c.ask ? <MessageSquarePlus className="size-4" /> : <ArrowRight className="size-3.5 text-fg-faint" />}
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <span className="text-[12px] text-fg-faint">{c.hint}</span>
                {idx === active && <CornerDownLeft className="size-3.5 text-fg-faint" />}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-fg-muted">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
