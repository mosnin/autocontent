import { Bot, Code2, Megaphone, Plug, Send, Webhook } from "lucide-react";
import type { ReactNode } from "react";
import { PageBody, PageHeader, SectionTitle } from "../page";
import { Shader } from "../shader";
import { AgentAccess, AgentsHeader } from "./agent-access";
import { AppDirectory, type AppEntry } from "./app-directory";
import { Webhooks } from "./webhooks";
import type { AdAccount } from "@/lib/ads-client";
import type { X402Config } from "@/lib/business";
import type { AyrshareConnectStatus, PersonalAccessToken } from "@/lib/types";
import type { WebhookEndpoint } from "@/lib/webhooks-client";

export interface IntegrationsData {
  ayrshare: AyrshareConnectStatus | null;
  adAccounts: AdAccount[] | null;
  tokens: PersonalAccessToken[] | null;
  webhooks: WebhookEndpoint[] | null;
  x402: X402Config | null;
  apiBase: string;
}

function buildApps({ ayrshare, adAccounts, tokens, webhooks, x402 }: IntegrationsData): AppEntry[] {
  const social = Boolean(ayrshare?.connected);
  const ads = (p: string) => (adAccounts ?? []).filter((a) => a.platform === p && a.status !== "disconnected");
  const socialEntry = (id: string, name: string, glyph: string, blurb: string): AppEntry => ({
    id,
    name,
    provider: "via Ayrshare",
    blurb,
    glyph,
    connected: social,
    status: social ? "Posting profile ready. Link or revoke this account in Ayrshare's chooser." : undefined,
    action: { kind: "ayrshare", label: social ? "Manage" : "Connect" },
  });
  const adEntry = (id: string, name: string, glyph: string, blurb: string): AppEntry => {
    const list = ads(id);
    return {
      id,
      name,
      provider: "via Composio",
      blurb,
      glyph,
      connected: list.length > 0,
      status: list.length > 0 ? `${list.length} account${list.length === 1 ? "" : "s"}${list.some((a) => a.killswitch) ? " · kill switch on" : ""} · governed by your caps` : undefined,
      action: { kind: "link", href: "/paid/connect", label: list.length > 0 ? "Manage" : "Connect" },
    };
  };
  return [
    socialEntry("tiktok", "TikTok", "T", "Post videos on schedule from your playbooks."),
    socialEntry("instagram", "Instagram", "I", "Reels and carousels, posted on schedule."),
    socialEntry("youtube", "YouTube", "Y", "Shorts, posted on schedule."),
    adEntry("google_ads", "Google Ads", "G", "Search, Performance Max and YouTube campaigns run by the Media buyer."),
    adEntry("meta_ads", "Meta Ads", "M", "Facebook and Instagram campaigns run by the Media buyer."),
    {
      id: "mcp",
      name: "MCP server",
      provider: "Built in",
      blurb: "Give Claude, Cursor or your own agent Marketer's tools.",
      glyph: "mcp",
      connected: (tokens?.length ?? 0) > 0,
      status: (tokens?.length ?? 0) > 0 ? `${tokens!.length} access token${tokens!.length === 1 ? "" : "s"}` : undefined,
      action: { kind: "link", href: "#agents", label: "Set up" },
      forAgents: true,
    },
    { id: "api", name: "REST API, SDK and CLI", provider: "Built in", blurb: "Every page here is an endpoint first.", glyph: "api", connected: false, action: { kind: "link", href: "#agents", label: "Snippets" }, forAgents: true },
    {
      id: "webhooks",
      name: "Webhooks",
      provider: "Built in",
      blurb: "Signed events when work finishes, fails or needs approval.",
      glyph: "webhooks",
      connected: (webhooks?.length ?? 0) > 0,
      status: (webhooks?.length ?? 0) > 0 ? `${webhooks!.filter((w) => w.enabled).length} of ${webhooks!.length} endpoints delivering` : undefined,
      action: { kind: "link", href: "#webhooks", label: (webhooks?.length ?? 0) > 0 ? "Manage" : "Add endpoint" },
      forAgents: true,
    },
    {
      id: "x402",
      name: "x402 payments",
      provider: "Built in",
      blurb: x402 && !x402.enabled ? "Agents paying their own way over HTTP 402. Off on this deployment." : "Agents fund their own credit over HTTP 402.",
      glyph: "x402",
      connected: Boolean(x402?.enabled),
      status: x402?.enabled ? `${x402.asset} on ${x402.network}` : undefined,
      action: { kind: "link", href: "#agents", label: "Details" },
      forAgents: true,
    },
  ];
}

function Glyph({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`flex size-11 items-center justify-center rounded-[12px] bg-white/80 text-black/70 shadow-[0_1px_2px_rgb(0_0_0/0.08)] backdrop-blur [&_svg]:size-5 ${className ?? ""}`}>{children}</span>;
}

/** The connections hub: one place for the tools Marketer posts, buys and reports through, and the door agents come in by. */
export function IntegrationsView(data: IntegrationsData) {
  const apps = buildApps(data);
  return (
    <>
      <PageHeader icon={<Plug />} title="Integrations" />
      <PageBody width="4xl">
        <div className="t-stagger space-y-8">
          <div className="relative h-[176px] overflow-hidden rounded-[20px] border border-border">
            <div className="absolute inset-0 dark:brightness-[0.88]">
              <Shader palette="lagoon" seed={3} />
            </div>
            <div className="absolute inset-0 bg-gradient-to-r from-white/75 via-white/40 to-transparent" />
            <div aria-hidden className="absolute right-6 top-1/2 hidden -translate-y-1/2 grid-cols-3 gap-2.5 md:grid">
              <Glyph>
                <Send />
              </Glyph>
              <Glyph className="translate-y-3">
                <Megaphone />
              </Glyph>
              <Glyph>
                <Bot />
              </Glyph>
              <Glyph className="-translate-y-1">
                <Code2 />
              </Glyph>
              <Glyph className="translate-y-2">
                <Plug />
              </Glyph>
              <Glyph className="-translate-y-2">
                <Webhook />
              </Glyph>
            </div>
            <div className="relative flex h-full flex-col justify-end p-5 sm:p-6">
              <h2 className="max-w-[22ch] text-[24px] font-medium leading-tight tracking-[-0.022em] text-black/90 sm:text-[26px]">Connect the tools your marketing runs on</h2>
              <p className="mt-1.5 max-w-[48ch] text-[14px] text-black/65">Channels to post to, ad accounts to buy on, and the door your own agents come in by.</p>
            </div>
          </div>

          <section id="agents" className="scroll-mt-4 rounded-[20px] border border-border bg-subtle p-1.5">
            <div className="px-3.5 pb-3 pt-2.5">
              <AgentsHeader />
            </div>
            <div className="rounded-[14px] bg-card px-4 py-4 shadow-[0_0_0_0.5px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)] sm:px-5 dark:shadow-[inset_0_0_0_1px_hsl(var(--border))]">
              <AgentAccess tokens={data.tokens} x402={data.x402} apiBase={data.apiBase} />
            </div>
          </section>

          <AppDirectory apps={apps} />

          <section id="webhooks" className="scroll-mt-4">
            <SectionTitle>Outbound webhooks</SectionTitle>
            <Webhooks endpoints={data.webhooks} />
          </section>
        </div>
      </PageBody>
    </>
  );
}
