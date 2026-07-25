import { Card, CardContent } from "@/components/square/ui/card";
import { connectSocialAction } from "@/lib/actions";
import { api } from "@/lib/api";
import type { SocialConnectStatus, SocialPlatform } from "@/lib/types";
import { ConnectCard } from "./ConnectCard";

export const dynamic = "force-dynamic";

const PLATFORMS: { key: SocialPlatform; label: string }[] = [
  { key: "tiktok", label: "TikTok" },
  { key: "reels", label: "Instagram Reels" },
  { key: "shorts", label: "YouTube Shorts" },
];

export default async function ConnectPage() {
  // Best-effort: a backend 5xx must not throw the whole route to the error
  // boundary — render an in-page fallback instead. This is the page people
  // land on when something is already wrong with their connection.
  let status: SocialConnectStatus | null = null;
  try {
    status = await api<SocialConnectStatus>("/api/v1/connect/zernio/status");
  } catch {
    // fall through to the fallback below
  }

  const byPlatform = new Map(
    (status?.accounts ?? []).map((a) => [a.platform, a]),
  );

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect your socials
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Each platform authorizes separately. Anything not connected here
          can&apos;t be scheduled to.
        </p>
      </div>

      {status === null ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="font-medium">
              Couldn&apos;t load your connections right now
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              We hit a problem reaching the distribution service. Refresh in a
              moment to try again.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {PLATFORMS.map((platform) => (
            <ConnectCard
              account={byPlatform.get(platform.key) ?? null}
              action={connectSocialAction}
              key={platform.key}
              label={platform.label}
              platform={platform.key}
            />
          ))}
        </div>
      )}
    </div>
  );
}
