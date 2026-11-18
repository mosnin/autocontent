"use client";

import { AgentGlyph, List, ListRow, PersonAvatar, StatusBadge, LoadMore, usePaged } from "@/design-system";
import type { AdActionEntry } from "@/lib/ads-client";
import { formatRelative, formatUsd } from "@/lib/format";
import { describeAdAction, mediaBuyer, platformLabel } from "./shared";

/** The append-only audit trail for spend: guardrail changes, proposals, approvals and applied actions. */
export function ActionLog({ actions, initial = 6 }: { actions: AdActionEntry[]; initial?: number }) {
  const { shown, total, more } = usePaged(actions, initial);
  return (
    <div className="space-y-2">
      <List>
        {shown.map((a) => {
          const d = describeAdAction(a.action);
          const delta = Number(a.dollar_delta_usd);
          const who = a.actor === "agent" ? mediaBuyer() : a.actor_email || "You";
          return (
            <ListRow key={a.id}>
              {a.actor === "agent" ? <AgentGlyph size={22} tone="b" /> : <PersonAvatar name={who} size={22} />}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-[13px]">
                  <span className="truncate">{d.title}</span>
                  {d.denied && <StatusBadge tone="negative">Denied</StatusBadge>}
                </div>
                <div className="truncate text-[12px] text-fg-muted">
                  {who}
                  {a.platform ? ` · ${platformLabel(a.platform)}` : ""} · {formatRelative(a.created_at)}
                </div>
              </div>
              {delta !== 0 && (
                <span className="shrink-0 text-[13px] text-fg-muted tabular">
                  {delta > 0 ? "+" : ""}
                  {formatUsd(delta)}/day
                </span>
              )}
            </ListRow>
          );
        })}
      </List>
      <LoadMore shown={shown.length} total={total} onMore={more} noun="actions" />
    </div>
  );
}
