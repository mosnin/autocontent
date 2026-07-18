"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CheckCircle2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import type { IntegrationFlag, IntegrationsStatus } from "./types";

const INTEGRATIONS_KEY = "/api/v1/admin/integrations";

interface ProviderRow {
  key: keyof IntegrationsStatus;
  label: string;
  unlocks: string;
}

// Order mirrors the go-live checklist: content pipelines first, then
// distribution/growth, then platform plumbing.
const PROVIDERS: ProviderRow[] = [
  {
    key: "openai",
    label: "OpenAI",
    unlocks:
      "Ideation, scripting, DALL-E keyframes, TTS, Whisper captions, and article drafting.",
  },
  {
    key: "xai",
    label: "xAI (Grok Imagine)",
    unlocks: "Animates each Studio keyframe into a short video clip.",
  },
  {
    key: "ayrshare",
    label: "Ayrshare",
    unlocks: "Publishes and schedules posts to TikTok, Reels, and Shorts.",
  },
  {
    key: "pixabay",
    label: "Pixabay",
    unlocks: "Background music selection for video edits.",
  },
  {
    key: "exa",
    label: "Exa",
    unlocks:
      "SERP research for article outlines. Absent, research degrades to model knowledge instead of failing.",
  },
  {
    key: "fal",
    label: "fal.ai",
    unlocks: "Studio image/video tools: edit, upscale, remove background, animate.",
  },
  {
    key: "composio",
    label: "Composio",
    unlocks: "Per-user OAuth and agent tool access to Google Ads and Meta Ads.",
  },
  {
    key: "google_oauth",
    label: "Google OAuth (Search Console)",
    unlocks: "Connects Search Console for Press performance attribution.",
  },
  {
    key: "resend",
    label: "Resend",
    unlocks: "Transactional email: notifications and newsletter digests.",
  },
  {
    key: "stripe",
    label: "Stripe",
    unlocks: "Checkout, credit purchases, and billing webhooks for the hosted product.",
  },
  {
    key: "inngest",
    label: "Inngest",
    unlocks: "Durable Ads workflows: metrics sync, optimization, budget scaling.",
  },
  {
    key: "sentry",
    label: "Sentry",
    unlocks: "Error reporting and trace sampling in production.",
  },
];

interface MasterFlagRow {
  key: keyof IntegrationsStatus;
  label: string;
  unlocks: string;
}

const MASTER_FLAGS: MasterFlagRow[] = [
  {
    key: "ads_enabled",
    label: "Ads product",
    unlocks: "The whole paid-campaigns product. Inert until true and Composio/Inngest keys are set.",
  },
  {
    key: "billing_enabled",
    label: "Billing",
    unlocks: "Prepaid credit metering and Stripe checkout for the hosted product.",
  },
  {
    key: "press_autopilot_enabled",
    label: "Press autopilot",
    unlocks: "Scheduler enqueues article generation from approved topic proposals on cadence.",
  },
  {
    key: "newsletters_enabled",
    label: "Newsletters",
    unlocks: "Sends newsletter digests through Resend.",
  },
  {
    key: "x402_enabled",
    label: "x402 agent payments",
    unlocks: "Agents can fund their own prepaid credit over HTTP 402.",
  },
];

export function IntegrationsClient({ initial }: { initial: IntegrationsStatus }) {
  const { data, error, isValidating, mutate } = useSWR<IntegrationsStatus>(
    INTEGRATIONS_KEY,
    clientFetch,
    { fallbackData: initial },
  );

  const errorToastedRef = React.useRef(false);
  React.useEffect(() => {
    if (error && !errorToastedRef.current) {
      errorToastedRef.current = true;
      toast.error(`Live updates paused: ${error.message ?? "fetch failed"}`);
    }
    if (!error) errorToastedRef.current = false;
  }, [error]);

  const status = data ?? initial;

  async function onRefresh() {
    try {
      await mutate();
    } catch {
      // Errors surface via the SWR error toast above.
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Integrations
          </h1>
          <p className="text-sm text-muted-foreground">
            Go-live checklist: which provider keys are configured. Values are
            never shown, only presence.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onRefresh()}
            disabled={isValidating}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isValidating && "animate-spin")}
              aria-hidden
            />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-muted-foreground">
          Live updates paused: {error.message ?? "fetch failed"}
        </p>
      )}

      <div className="overflow-x-auto">
        <Card className="min-w-[640px]">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Provider</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead>What it unlocks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PROVIDERS.map((row) => (
                  <IntegrationRow
                    key={row.key}
                    label={row.label}
                    unlocks={row.unlocks}
                    flag={status[row.key] as IntegrationFlag}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Master flags
        </h2>
        <p className="text-sm text-muted-foreground">
          Whole products/features gated off by default, independent of any
          single provider key.
        </p>
      </div>

      <div className="overflow-x-auto">
        <Card className="min-w-[640px]">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Flag</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead>What it unlocks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MASTER_FLAGS.map((row) => (
                  <FlagRow
                    key={row.key}
                    label={row.label}
                    unlocks={row.unlocks}
                    enabled={status[row.key] as boolean}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ ok, onLabel, offLabel }: { ok: boolean; onLabel: string; offLabel: string }) {
  return (
    <Badge
      variant={ok ? "success" : "secondary"}
      className="font-mono lowercase"
    >
      {ok ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : (
        <XCircle className="size-3" aria-hidden />
      )}
      {ok ? onLabel : offLabel}
    </Badge>
  );
}

function IntegrationRow({
  label,
  unlocks,
  flag,
}: {
  label: string;
  unlocks: string;
  flag: IntegrationFlag;
}) {
  return (
    <TableRow>
      <TableCell className="pl-6 align-top font-medium">{label}</TableCell>
      <TableCell className="align-top">
        <StatusBadge ok={flag.configured} onLabel="configured" offLabel="not set" />
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">
        {unlocks}
      </TableCell>
    </TableRow>
  );
}

function FlagRow({
  label,
  unlocks,
  enabled,
}: {
  label: string;
  unlocks: string;
  enabled: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="pl-6 align-top font-medium">{label}</TableCell>
      <TableCell className="align-top">
        <StatusBadge ok={enabled} onLabel="on" offLabel="off" />
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">
        {unlocks}
      </TableCell>
    </TableRow>
  );
}
