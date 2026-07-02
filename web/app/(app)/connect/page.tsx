import { CheckCircle2 } from "lucide-react";

import { connectAyrshareAction } from "@/lib/actions";
import { api } from "@/lib/api";
import type { AyrshareConnectStatus } from "@/lib/types";
import { ConnectCard } from "./ConnectCard";

export const dynamic = "force-dynamic";

const PLATFORMS = [
  { key: "tiktok", label: "TikTok" },
  { key: "reels", label: "Instagram Reels" },
  { key: "shorts", label: "YouTube Shorts" },
] as const;

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, key.length - 4))}${key.slice(-4)}`;
}

export default async function ConnectPage() {
  const status = await api<AyrshareConnectStatus>(
    "/api/v1/connect/ayrshare/status",
  );

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Distribution
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Connect your socials
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Scheduling posts requires an Ayrshare User Profile linked to the
          platforms you want the pipeline to publish to.
        </p>
      </div>

      <ConnectCard
        action={connectAyrshareAction}
        connected={status.connected}
        maskedKey={
          status.connected && status.profile_key
            ? maskKey(status.profile_key)
            : null
        }
      />

      <ul className="grid grid-cols-3 gap-3">
        {PLATFORMS.map((p) => (
          <li
            className="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-4 text-center"
            key={p.key}
          >
            <span
              className={
                status.connected
                  ? "flex size-8 items-center justify-center rounded-full bg-brand/10 text-brand"
                  : "flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
              }
            >
              <CheckCircle2 className="size-4" />
            </span>
            <span className="text-xs font-medium">{p.label}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {status.connected ? "ready" : "pending"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
