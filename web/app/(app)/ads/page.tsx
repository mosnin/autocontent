import { Megaphone, ShieldCheck, Sparkles, Workflow } from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Ads product home — placeholder overview until the campaigns data layer,
// Composio connections, and Inngest workflows land. Kept honest: it explains
// what's coming and the safety model rather than faking metrics.
export default function AdsOverviewPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2.5">
          <AppIcon color="orange">
            <Megaphone />
          </AppIcon>
          <h1 className="text-2xl font-semibold tracking-tight">Ads</h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Create, manage, and scale paid campaigns across Google and Meta —
          driven by agents, governed by hard budget guardrails. Connect an ad
          account to begin.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Feature
          icon={<Megaphone />}
          title="Agent-run campaigns"
          body="Agents draft, launch, and iterate on campaigns using your brand kit and existing content."
        />
        <Feature
          icon={<Workflow />}
          title="Durable optimization"
          body="Metrics sync, budget scaling, and creative rotation run as durable background workflows."
        />
        <Feature
          icon={<ShieldCheck />}
          title="Spend, governed"
          body="Every spend-affecting change passes a fail-closed budget guard, an approval gate, and an audit log."
        />
      </div>

      <Card className="border-border/60 bg-card/40">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <div className="rounded-full bg-muted p-3">
            <Sparkles className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <h2 className="text-lg font-semibold">Ad accounts coming online</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Google Ads and Meta Ads connections, campaigns, and the approvals
            inbox are being wired up. Nothing here can spend money until you
            connect an account and approve it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-5">
        <AppIcon color="orange">{icon}</AppIcon>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
