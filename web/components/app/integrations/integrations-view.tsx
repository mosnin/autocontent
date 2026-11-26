"use client";

import { Bot, Code2, Plug, Search, Wallet, Webhook } from "lucide-react";
import { type ReactNode, useEffect, useState, useTransition } from "react";
import { AppRow, Button, ButtonLink, EmptyLine, HeroBanner, Input, PageHeader, Section, Segmented } from "@/design-system";
import type { AdAccount } from "@/lib/ads-client";
import { connectAyrshareAction } from "@/lib/actions";
import type { X402Config } from "@/lib/business";
import type { AyrshareConnectStatus, PersonalAccessToken } from "@/lib/types";
import type { WebhookEndpoint } from "@/lib/webhooks-client";
import { AgentAccess } from "./agent-access";
import { Webhooks } from "./webhooks";

export interface IntegrationsData {
  ayrshare: AyrshareConnectStatus | null;
  adAccounts: AdAccount[] | null;
  tokens: PersonalAccessToken[] | null;
  webhooks: WebhookEndpoint[] | null;
  x402: X402Config | null;
  apiBase: string;
}

type Group = "Publishing" | "Ads" | "For agents";

interface App {
  id: string;
  group: Group;
  name: string;
  description: string;
  logo: ReactNode;
  connected: boolean;
  /** "ayrshare" opens Ayrshare's account chooser; a string is a link. */
  connect: "ayrshare" | string;
}

const letter = (l: string) => <span className="text-[15px] font-medium">{l}</span>;
const s = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function buildApps({ ayrshare, adAccounts, tokens, webhooks, x402 }: IntegrationsData): App[] {
  const social = Boolean(ayrshare?.connected);
  const ads = (p: string) => (adAccounts ?? []).filter((a) => a.platform === p && a.status !== "disconnected");
  const adLine = (p: string, fallback: string) => {
    const list = ads(p);
    return list.length > 0 ? `${s(list.length, "account")}${list.some((a) => a.killswitch) ? " · kill switch on" : ""}` : fallback;
  };
  const tokenCount = tokens?.length ?? 0;
  const hooks = webhooks ?? [];
  return [
    { id: "tiktok", group: "Publishing", name: "TikTok", description: social ? "Posting through Ayrshare" : "Post videos on schedule", logo: letter("T"), connected: social, connect: "ayrshare" },
    { id: "instagram", group: "Publishing", name: "Instagram", description: social ? "Posting through Ayrshare" : "Reels and carousels on schedule", logo: letter("I"), connected: social, connect: "ayrshare" },
    { id: "youtube", group: "Publishing", name: "YouTube", description: social ? "Posting through Ayrshare" : "Shorts on schedule", logo: letter("Y"), connected: social, connect: "ayrshare" },
    { id: "google_ads", group: "Ads", name: "Google Ads", description: adLine("google_ads", "Search, Performance Max and YouTube"), logo: letter("G"), connected: ads("google_ads").length > 0, connect: "/paid/connect" },
    { id: "meta_ads", group: "Ads", name: "Meta Ads", description: adLine("meta_ads", "Facebook and Instagram campaigns"), logo: letter("M"), connected: ads("meta_ads").length > 0, connect: "/paid/connect" },
    { id: "mcp", group: "For agents", name: "MCP server", description: tokenCount > 0 ? s(tokenCount, "access token") : "Claude, Cursor or your own agent", logo: <Bot />, connected: tokenCount > 0, connect: "#agents" },
    { id: "api", group: "For agents", name: "REST API, SDK and CLI", description: "Every page here is an endpoint", logo: <Code2 />, connected: false, connect: "#agents" },
    { id: "webhooks", group: "For agents", name: "Webhooks", description: hooks.length > 0 ? `${hooks.filter((w) => w.enabled).length} of ${s(hooks.length, "endpoint")} delivering` : "Signed events when work finishes", logo: <Webhook />, connected: hooks.length > 0, connect: "#webhooks" },
    { id: "x402", group: "For agents", name: "x402 payments", description: x402?.enabled ? `${x402.asset} on ${x402.network}` : x402 ? "Off on this deployment" : "Agents fund their own credit", logo: <Wallet />, connected: Boolean(x402?.enabled), connect: "#agents" },
  ];
}

const ask = (dept: string, q: string) => `/sessions/new?dept=${dept}&q=${encodeURIComponent(q)}`;

const PROMPTS = [
  { app: "TikTok", text: "Post tomorrow's video at 6pm", href: ask("distribution", "Post tomorrow's video on TikTok at 6pm") },
  { app: "Meta", text: "Pause ad sets with CPA over $40", href: ask("paid", "Pause any Meta ad set with CPA over $40") },
  { app: "MCP", text: "Let Claude read this week's inbox", href: ask("distribution", "How do I connect Claude to Marketer over MCP?") },
];

const GROUPS: Group[] = ["Publishing", "Ads", "For agents"];

type View = "apps" | "developers";
const DEV_HASHES = new Set(["agents", "webhooks", "tokens", "x402"]);

/**
 * Integrations (ref 03), in two views. Apps: the banner with example asks and
 * the grouped app rows, which is what most people come for. Developers: how an
 * agent connects, access tokens, webhooks and x402. The "For agents" rows and
 * the old #agents / #webhooks links open Developers at the right section.
 */
export function IntegrationsView(data: IntegrationsData) {
  const apps = buildApps(data);
  const [view, setView] = useState<View>("apps");
  const [q, setQ] = useState("");
  const openDevelopers = (hash: string) => {
    setView("developers");
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#${hash}`);
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }));
  };
  useEffect(() => {
    const sync = () => {
      const h = window.location.hash.slice(1);
      if (DEV_HASHES.has(h)) {
        setView("developers");
        requestAnimationFrame(() => document.getElementById(h)?.scrollIntoView({ block: "start" }));
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const pick = (v: View) => {
    setView(v);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${v === "developers" ? "#agents" : ""}`);
  };
  const [pending, start] = useTransition();
  const term = q.trim().toLowerCase();
  const shown = term ? apps.filter((a) => `${a.name} ${a.description} ${a.group}`.toLowerCase().includes(term)) : apps;
  const ayrshare = () => start(() => connectAyrshareAction());

  return (
    <>
      <PageHeader icon={<Plug />} title="Integrations" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-5 pb-20 pt-12 sm:px-6">
          <h2 className="text-center text-[22px] font-medium leading-tight">{view === "apps" ? "Connect where you publish" : "Connect your own agents"}</h2>
          <div className="mt-5 flex justify-center">
            <Segmented
              label="Integrations view"
              value={view}
              onChange={pick}
              options={[
                { value: "apps", label: "Apps" },
                { value: "developers", label: "Developers" },
              ]}
            />
          </div>

          {view === "apps" ? (
            <div key="apps" className="ds-swap">
              <HeroBanner palette="dusk" prompts={PROMPTS} className="mt-8" />
              <div className="relative mt-6">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search integrations…" aria-label="Search integrations" className="h-9 rounded-full pl-8" />
              </div>
              <div className="mt-10 space-y-10">
                {shown.length === 0 && <EmptyLine>Nothing matches “{q}”.</EmptyLine>}
                {GROUPS.map((g) => {
                  const rows = shown.filter((a) => a.group === g);
                  if (rows.length === 0) return null;
                  const action =
                    g === "Publishing" && data.ayrshare?.connected ? (
                      <Button size="sm" variant="ghost" onClick={ayrshare} loading={pending}>
                        Manage accounts
                      </Button>
                    ) : g === "Ads" && rows.some((r) => r.connected) ? (
                      <ButtonLink href="/paid/connect" size="sm" variant="ghost">
                        Manage accounts
                      </ButtonLink>
                    ) : g === "For agents" ? (
                      <Button size="sm" variant="ghost" onClick={() => openDevelopers("agents")}>
                        Developer settings
                      </Button>
                    ) : undefined;
                  return (
                    <Section key={g} title={g} action={action}>
                      <div className="grid gap-x-8 sm:grid-cols-2">
                        {rows.map((a) => (
                          <AppRow
                            key={a.id}
                            logo={a.logo}
                            name={a.name}
                            description={a.description}
                            connected={a.connected}
                            {...(a.connect === "ayrshare" ? { onConnect: ayrshare } : a.connect.startsWith("#") ? { onConnect: () => openDevelopers(a.connect.slice(1)) } : { href: a.connect })}
                          />
                        ))}
                      </div>
                    </Section>
                  );
                })}
              </div>
            </div>
          ) : (
            <div key="developers" className="ds-swap mt-10 space-y-10">
              <div id="agents" className="scroll-mt-4">
                <AgentAccess tokens={data.tokens} x402={data.x402} apiBase={data.apiBase} />
              </div>
              <div id="webhooks" className="scroll-mt-4">
                <Webhooks endpoints={data.webhooks} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
