import { api } from "@/lib/api";
import type { WebhookEndpoint } from "@/lib/webhooks-client";
import { WebhooksClient } from "./WebhooksClient";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  // Fetched server-side and handed to the client as SWR fallbackData so the
  // list renders immediately, then revalidates in the browser.
  const endpoints = await api<WebhookEndpoint[]>("/api/v1/webhook-endpoints");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Agent access
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Register HTTPS endpoints to receive signed, real-time events when jobs
          and articles finish, fail, or need approval — the hook agents and
          automation use to react without polling. Every delivery is signed with
          a per-endpoint secret so you can verify it came from marketer.sh.
        </p>
      </div>

      <WebhooksClient initial={endpoints} />
    </div>
  );
}
