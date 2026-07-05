import Link from "next/link";
import { AlertTriangle, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { AyrshareConnectStatus } from "@/lib/types";
import { OnboardingEntry } from "./OnboardingEntry";

async function fetchAyrshareConnected(): Promise<boolean | null> {
  try {
    const s = await api<AyrshareConnectStatus>(
      "/api/v1/connect/ayrshare/status",
    );
    return Boolean(s?.connected);
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export default async function Onboarding() {
  const connected = await fetchAyrshareConnected();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New channel</h1>
        <p className="text-sm text-muted-foreground">
          One sentence is enough — the machine drafts the rest.
        </p>
      </div>

      {connected === false && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <div className="font-medium">Ayrshare not connected</div>
                <div className="text-sm text-muted-foreground">
                  Scheduled posts won&apos;t ship until you link a socials
                  profile.
                </div>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link href="/connect">
                <Link2 className="h-4 w-4" />
                Connect now
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <OnboardingEntry />
    </div>
  );
}
