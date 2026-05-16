import { CheckCircle2, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { connectAyrshareAction } from "@/lib/actions";
import { api } from "@/lib/api";
import type { AyrshareConnectStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, key.length - 4))}${key.slice(-4)}`;
}

export default async function ConnectPage() {
  const status = await api<AyrshareConnectStatus>(
    "/api/v1/connect/ayrshare/status",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect your socials
        </h1>
        <p className="text-sm text-muted-foreground">
          Scheduling posts requires an Ayrshare User Profile linked to your
          TikTok, Instagram, and YouTube accounts.
        </p>
      </div>

      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto rounded-full bg-primary/10 p-3 text-primary">
            <Link2 className="h-6 w-6" />
          </div>
          <CardTitle>
            {status.connected ? "Profile connected" : "Connect Ayrshare"}
          </CardTitle>
          <CardDescription>
            {status.connected
              ? "You can re-run the OAuth chooser any time to add or revoke a platform."
              : "We'll bounce you to Ayrshare's hosted chooser to authorize each platform."}
          </CardDescription>
        </CardHeader>
        {status.connected && status.profile_key && (
          <CardContent className="text-center">
            <div className="inline-flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-muted-foreground">profile_key:</span>
              <code className="font-mono text-xs">
                {maskKey(status.profile_key)}
              </code>
            </div>
          </CardContent>
        )}
        <CardFooter className="justify-center">
          <form action={connectAyrshareAction}>
            <Button type="submit">
              {status.connected ? "Reconnect / add accounts" : "Connect socials"}
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}
