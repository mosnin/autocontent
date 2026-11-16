"use client";

import { useState } from "react";
import { formatRelative, formatUsd } from "@/lib/format";
import type { AdActionEntry } from "@/lib/ads-client";
import { Badge, Button } from "../ui";
import { ActorAvatar, actorLabel, describeAdAction, platformLabel } from "./shared";

/**
 * The append-only audit trail for spend: every governance change, proposal,
 * approval and applied action, by the Media buyer agent or by a person.
 */
export function ActionLog({ actions, initial = 6 }: { actions: AdActionEntry[]; initial?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? actions : actions.slice(0, initial);
  return (
    <div>
      <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
        {shown.map((a) => {
          const d = describeAdAction(a.action);
          const delta = Number(a.dollar_delta_usd);
          return (
            <li key={a.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
              <ActorAvatar actor={a.actor} email={a.actor_email} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{d.title}</span>
                  {d.tone === "danger" && <Badge tone="danger">Denied</Badge>}
                </div>
                <div className="truncate text-[13px] text-muted-foreground">
                  {actorLabel(a.actor, a.actor_email)}
                  {a.platform ? ` · ${platformLabel(a.platform)}` : ""}
                  <span className="text-faint"> · {formatRelative(a.created_at)}</span>
                  <span className="hidden font-mono text-[11.5px] text-faint sm:inline"> · {a.action}</span>
                </div>
              </div>
              <span className="shrink-0 text-[13px] tabular text-muted-foreground">{delta !== 0 ? `${delta > 0 ? "+" : ""}${formatUsd(delta)}/day` : ""}</span>
            </li>
          );
        })}
      </ul>
      {actions.length > initial && (
        <div className="mt-2 flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${actions.length}`}
          </Button>
        </div>
      )}
    </div>
  );
}
