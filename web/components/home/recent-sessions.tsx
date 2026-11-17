"use client";

import Link from "next/link";
import { Bullet } from "@/design-system";
import { formatRelative } from "@/lib/format";
import { useAgent } from "../mk/agent/agent-provider";

/** Ref 01 "Recent sessions": bullet, title, relative time; "N more". */
export function RecentSessions() {
  const { threads, state } = useAgent();
  const list = threads?.threads ?? [];
  if (state.status === "offline") return <p className="text-[13px] text-fg-muted">Your conversations with Marketer appear here once its agents are connected.</p>;
  if (state.status === "loading" || threads?.loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded-ds-sm bg-surface-3/60" />)}</div>;
  if (list.length === 0) return <p className="text-[13px] text-fg-muted">No sessions yet. Ask Marketer something above.</p>;
  return (
    <div>
      <ul className="space-y-2.5">
        {list.slice(0, 3).map((t) => (
          <li key={t.conversationId}>
            <Link href={`/sessions/${encodeURIComponent(t.conversationId)}`} className="flex gap-2.5 hover:opacity-90">
              <span className="mt-[7px]">
                <Bullet />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px]">{t.title || "Untitled session"}</span>
                <span className="block text-[12px] text-fg-muted">{formatRelative(new Date(t.updatedAt).toISOString())}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {list.length > 3 && <div className="mt-3 text-[12.5px] text-fg-muted">{list.length - 3} more</div>}
    </div>
  );
}
