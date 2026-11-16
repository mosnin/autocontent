"use client";

import Link from "next/link";
import { formatRelative } from "@/lib/format";
import { useAgent } from "../agent/agent-provider";

export function RecentSessions() {
  const { threads, state } = useAgent();
  const list = threads?.threads.slice(0, 4) ?? [];
  if (state.status === "offline") return <p className="text-[13px] text-muted-foreground">Sessions appear here once the agent harness is connected.</p>;
  if (state.status === "loading" || threads?.loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-muted/60" />)}</div>;
  if (list.length === 0) return <p className="text-[13px] text-muted-foreground">No sessions yet. Ask Marketer something above.</p>;
  return (
    <ul className="-mx-2">
      {list.map((t) => (
        <li key={t.conversationId}>
          <Link href={`/sessions/${encodeURIComponent(t.conversationId)}`} className="press flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/60">
            <span className="mt-[7px] size-[5px] shrink-0 rounded-full bg-faint" />
            <span className="min-w-0">
              <span className="block truncate text-[14px]">{t.title || "Untitled session"}</span>
              <span className="block text-[12px] text-faint">{formatRelative(new Date(t.updatedAt).toISOString())}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
