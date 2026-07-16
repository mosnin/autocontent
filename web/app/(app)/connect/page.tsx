import { AlertTriangle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
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
  // Best-effort: a backend 5xx must not throw the whole route to the error
  // boundary — render an in-page fallback instead.
  let status: AyrshareConnectStatus | null = null;
  try {
    status = await api<AyrshareConnectStatus>(
      "/api/v1/connect/ayrshare/status",
    );
  } catch {
    // fall through to the graceful fallback below
  }

  // What the backend actually knows is whether a posting profile
  // (profile_key) exists — NOT which individual socials are linked. That
  // lives in Ayrshare's hosted chooser. So we speak in terms of "profile
  // created", never per-platform "ready".
  const profileCreated = status?.connected ?? false;

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
          Scheduling posts requires an Ayrshare posting profile. Once it&apos;s
          created, you link and manage individual platforms inside
          Ayrshare&apos;s hosted chooser.
        </p>
      </div>

      {status === null ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <div className="font-medium">
                Couldn&apos;t load your connection right now
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                We hit a problem reaching the distribution service. Refresh in a
                moment to try again.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <ConnectCard
            action={connectAyrshareAction}
            connected={profileCreated}
            maskedKey={
              profileCreated && status.profile_key
                ? maskKey(status.profile_key)
                : null
            }
          />

          <div className="space-y-3">
            <ul className="grid grid-cols-3 gap-3">
              {PLATFORMS.map((p) => (
                <li
                  className="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-4 text-center"
                  key={p.key}
                >
                  <span
                    className={
                      profileCreated
                        ? "flex size-8 items-center justify-center rounded-full bg-brand/10 text-brand"
                        : "flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
                    }
                  >
                    <span className="text-xs font-semibold">
                      {p.label.charAt(0)}
                    </span>
                  </span>
                  <span className="text-xs font-medium">{p.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {profileCreated ? "in Ayrshare" : "needs profile"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-center text-xs text-muted-foreground">
              {profileCreated
                ? "Your posting profile is ready. Which of these are actually linked is managed in Ayrshare. Open the chooser above to add or revoke a platform."
                : "Create a posting profile above, then link each platform in Ayrshare's chooser."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
