import { IntegrationsView } from "@/components/app/integrations/integrations-view";
import type { AdAccount } from "@/lib/ads-client";
import type { X402Config } from "@/lib/business";
import type { AyrshareConnectStatus, PersonalAccessToken } from "@/lib/types";
import type { WebhookEndpoint } from "@/lib/webhooks-client";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Integrations · Marketer" };

export default async function IntegrationsPage() {
  const [ayrshare, adAccounts, tokens, webhooks, x402] = await Promise.all([
    safe<AyrshareConnectStatus>("/api/v1/connect/ayrshare/status"),
    safe<AdAccount[]>("/api/v1/ads/accounts"),
    safe<PersonalAccessToken[]>("/api/v1/tokens"),
    safe<WebhookEndpoint[]>("/api/v1/webhook-endpoints"),
    safe<X402Config>("/api/v1/x402/config"),
  ]);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "https://your-marketer-api";
  return <IntegrationsView ayrshare={ayrshare} adAccounts={adAccounts} tokens={tokens} webhooks={webhooks} x402={x402} apiBase={apiBase} />;
}
