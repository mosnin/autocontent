"use client";

import { Check } from "lucide-react";
import { Button, EmptyLine, IconTile, List, ListRow } from "@/design-system";
import { connectAyrshareAction } from "@/lib/actions";
import type { AyrshareConnectStatus } from "@/lib/types";

export const SOCIALS = [
  { key: "tiktok", label: "TikTok", initial: "T" },
  { key: "reels", label: "Instagram Reels", initial: "I" },
  { key: "shorts", label: "YouTube Shorts", initial: "Y" },
] as const;

export function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `${"•".repeat(Math.min(8, Math.max(4, key.length - 4)))}${key.slice(-4)}`;
}

/**
 * Channel status. The backend knows whether an Ayrshare posting profile
 * exists, not which socials are linked inside it (that lives in Ayrshare's
 * hosted chooser), so this speaks about the profile, never per-platform "ready":
 * one row that names the platforms the profile posts to.
 */
export function Channels({ status }: { status: AyrshareConnectStatus | null }) {
  if (status === null) return <EmptyLine>The distribution service is out of reach. Refresh in a moment.</EmptyLine>;
  const ready = status.connected;
  return (
    <List>
      <ListRow className="flex-wrap">
        <IconTile>{ready ? <Check /> : <span className="text-[12px] font-medium text-fg">A</span>}</IconTile>
        <div className="min-w-0 flex-1 basis-[160px]">
          <div className="text-[13px]">{ready ? "Posting profile ready" : "Connect your socials"}</div>
          <div className="truncate text-[12px] text-fg-muted">
            {ready && status.profile_key ? (
              <>
                {SOCIALS.map((p) => p.label).join(", ")} · Ayrshare <span className="font-mono">{maskKey(status.profile_key)}</span>
              </>
            ) : (
              `Opens Ayrshare to authorize ${SOCIALS.map((p) => p.label).join(", ")}`
            )}
          </div>
        </div>
        <form action={connectAyrshareAction} className="shrink-0">
          <Button type="submit" size="sm" variant={ready ? "secondary" : "primary"}>
            {ready ? "Manage accounts" : "Connect socials"}
          </Button>
        </form>
      </ListRow>
    </List>
  );
}
