"use client";

import { ArrowRight, CornerDownLeft, MessageSquarePlus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEPARTMENTS } from "@/lib/departments";
import { useAgent } from "../agent/agent-provider";
import { cx, Kbd, Modal } from "../ui";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const PLACES: { label: string; href: string }[] = [
  { label: "Home", href: "/home" },
  { label: "Activity", href: "/activity" },
  { label: "Inbox", href: "/inbox" },
  { label: "Analytics", href: "/analytics" },
  { label: "Plan", href: "/plan" },
  { label: "Library", href: "/library" },
  { label: "Playbooks", href: "/playbooks" },
  { label: "Content", href: "/content" },
  { label: "SEO", href: "/seo" },
  { label: "Paid media", href: "/paid" },
  { label: "Distribution", href: "/distribution" },
  { label: "Brand", href: "/brand" },
  { label: "Integrations", href: "/integrations" },
  { label: "Settings", href: "/settings" },
];

/** ⌘K: ask Marketer anything, jump anywhere, open a recent session. Arrow keys + Enter. */
export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { threads } = useAgent();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setI(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const commands = useMemo<Command[]>(() => {
    const needle = q.trim().toLowerCase();
    const list: Command[] = [];
    if (needle) list.push({ id: "ask", label: `Ask Marketer: “${q.trim()}”`, hint: "New session", run: () => go(`/sessions/new?q=${encodeURIComponent(q.trim())}`) });
    for (const d of DEPARTMENTS) {
      const label = `Ask the ${d.agentName}`;
      if (!needle || label.toLowerCase().includes(needle)) list.push({ id: `dept-${d.id}`, label, hint: d.label, run: () => go(`/sessions/new?dept=${d.id}${needle ? `&q=${encodeURIComponent(q.trim())}` : ""}`) });
    }
    for (const p of PLACES) if (!needle || p.label.toLowerCase().includes(needle)) list.push({ id: `go-${p.href}`, label: p.label, hint: "Go to", run: () => go(p.href) });
    for (const t of threads?.threads.slice(0, 20) ?? []) {
      const label = t.title || "Untitled session";
      if (!needle || label.toLowerCase().includes(needle)) list.push({ id: `t-${t.conversationId}`, label, hint: "Session", run: () => go(`/sessions/${encodeURIComponent(t.conversationId)}`) });
    }
    return list.slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, threads?.threads]);

  const active = Math.min(i, Math.max(0, commands.length - 1));

  return (
    <Modal open={open} onClose={onClose} title="Search" bare>
      <div
        role="combobox"
        aria-expanded
        aria-controls="cmd-list"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setI((v) => Math.min(v + 1, commands.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setI((v) => Math.max(v - 1, 0)));
          if (e.key === "Enter") (e.preventDefault(), commands[active]?.run());
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setI(0))}
            placeholder="Ask Marketer or search…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            aria-label="Ask Marketer or search"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul id="cmd-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {commands.map((c, idx) => (
            <li key={c.id} role="option" aria-selected={idx === active}>
              <button
                type="button"
                onMouseEnter={() => setI(idx)}
                onClick={c.run}
                className={cx("flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[14px]", idx === active ? "bg-muted text-foreground" : "text-muted-foreground")}
              >
                {c.id === "ask" ? <MessageSquarePlus className="size-4" /> : <ArrowRight className="size-4 text-faint" />}
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="text-[12px] text-faint">{c.hint}</span>}
                {idx === active && <CornerDownLeft className="size-3.5 text-faint" />}
              </button>
            </li>
          ))}
          {commands.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing matches. Press Enter to ask Marketer.</li>}
        </ul>
      </div>
    </Modal>
  );
}
