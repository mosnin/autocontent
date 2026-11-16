import { Check } from "lucide-react";
import { connectAyrshareAction } from "@/lib/actions";
import type { AyrshareConnectStatus } from "@/lib/types";
import { Badge, Button, IconTile } from "../ui";

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
 * hosted chooser), so we speak in terms of the profile, never per-platform
 * "ready".
 */
export function Channels({ status }: { status: AyrshareConnectStatus | null }) {
  if (status === null) {
    return <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">We couldn't reach the distribution service. Refresh in a moment to see your channels.</p>;
  }
  const ready = status.connected;
  return (
    <div className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <IconTile tone={ready ? "live" : "muted"}>{ready ? <Check /> : <span className="text-[13px] font-medium">A</span>}</IconTile>
        <div className="min-w-0 flex-1 basis-[180px]">
          <div className="text-[14px] font-medium">{ready ? "Posting profile ready" : "Connect your socials"}</div>
          <div className="truncate text-[13px] text-muted-foreground">
            {ready && status.profile_key ? (
              <>
                Ayrshare · <span className="font-mono text-[12px]">{maskKey(status.profile_key)}</span>
              </>
            ) : (
              "We'll send you to Ayrshare's chooser to create a posting profile and authorize each platform."
            )}
          </div>
        </div>
        <form action={connectAyrshareAction} className="shrink-0">
          <Button type="submit" size="sm" variant={ready ? "secondary" : "primary"}>
            {ready ? "Add or remove accounts" : "Connect socials"}
          </Button>
        </form>
      </div>
      {SOCIALS.map((p) => (
        <div key={p.key} className="flex min-h-[48px] items-center gap-3 px-4 py-2">
          <IconTile size={28}>
            <span className="text-[12px] font-medium">{p.initial}</span>
          </IconTile>
          <span className="min-w-0 flex-1 truncate text-[14px]">{p.label}</span>
          <Badge tone={ready ? "muted" : "warn"}>{ready ? "Managed in Ayrshare" : "Needs a profile"}</Badge>
        </div>
      ))}
    </div>
  );
}
