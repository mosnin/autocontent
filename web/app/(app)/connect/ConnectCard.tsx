"use client";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import type { ConnectedAccount, SocialPlatform } from "@/lib/types";

/**
 * One platform's connect row.
 *
 * Connecting is per platform — each one is its own OAuth — so the state
 * shown is that platform's real state, not a proxy for "an account exists
 * somewhere". A dead token reads as "Reconnect", because that is the only
 * action that fixes it.
 */
export function ConnectCard({
  action,
  platform,
  label,
  account,
}: {
  action: (formData: FormData) => Promise<void>;
  platform: SocialPlatform;
  label: string;
  account: ConnectedAccount | null;
}) {
  const live = account?.is_active ?? false;
  const needsReconnect = Boolean(account) && !live;

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            {live ? (
              <Badge variant="secondary">Connected</Badge>
            ) : needsReconnect ? (
              <Badge variant="destructive">Reconnect</Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {live
              ? account?.username || "Linked"
              : needsReconnect
                ? "The connection expired or was revoked — posts to this platform will fail until it is reconnected."
                : "Not connected."}
          </p>
        </div>

        <form action={action}>
          <input name="platform" type="hidden" value={platform} />
          <Button
            size="sm"
            type="submit"
            variant={live ? "outline" : "default"}
          >
            {live ? "Reconnect" : needsReconnect ? "Reconnect" : "Connect"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
