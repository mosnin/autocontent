"use client";

import { ArrowUpRight, Bot, Code2, Search, Wallet, Webhook } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { connectAyrshareAction } from "@/lib/actions";
import { Badge, Button, ButtonLink, IconTile, Input } from "../ui";
import { SectionTitle } from "../page";

export interface AppEntry {
  id: string;
  name: string;
  /** "via Ayrshare", "via Composio", "Built in". */
  provider: string;
  blurb: string;
  /** A letter for third-party apps (no hot-linked logos) or a built-in glyph. */
  glyph: string | "mcp" | "api" | "webhooks" | "x402";
  connected: boolean;
  status?: string;
  action: { kind: "link"; href: string; label: string } | { kind: "ayrshare"; label: string };
  forAgents?: boolean;
}

const GLYPHS: Record<string, ReactNode> = { mcp: <Bot />, api: <Code2 />, webhooks: <Webhook />, x402: <Wallet /> };

/** The marketplace list: search, then Connected and Available rows. */
export function AppDirectory({ apps }: { apps: AppEntry[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? apps.filter((a) => `${a.name} ${a.provider} ${a.blurb}`.toLowerCase().includes(s)) : apps;
  }, [apps, q]);
  const connected = filtered.filter((a) => a.connected);
  const available = filtered.filter((a) => !a.connected);

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search integrations" aria-label="Search integrations" className="h-10 pl-10" />
      </div>
      {filtered.length === 0 && <p className="px-1 text-[13px] text-muted-foreground">Nothing matches “{q}”.</p>}
      {connected.length > 0 && (
        <section>
          <SectionTitle>Connected · {connected.length}</SectionTitle>
          <AppList apps={connected} />
        </section>
      )}
      {available.length > 0 && (
        <section>
          <SectionTitle>Available</SectionTitle>
          <AppList apps={available} />
        </section>
      )}
    </div>
  );
}

function AppList({ apps }: { apps: AppEntry[] }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
      {apps.map((a) => (
        <div key={a.id} className="flex min-h-[60px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <IconTile size={36}>
            {GLYPHS[a.glyph] ?? <span className="text-[14px] font-medium">{a.glyph}</span>}
          </IconTile>
          <div className="min-w-0 flex-1 basis-[200px]">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate text-[14px] font-medium">{a.name}</span>
              <span className="text-[12px] text-faint">{a.provider}</span>
              {a.forAgents && <Badge tone="accent">For agents</Badge>}
            </div>
            <div className="text-[13px] text-muted-foreground">{a.status ?? a.blurb}</div>
          </div>
          {a.action.kind === "ayrshare" ? (
            <form action={connectAyrshareAction} className="ml-auto shrink-0">
              <Button type="submit" size="sm" variant={a.connected ? "ghost" : "secondary"}>
                {a.action.label}
              </Button>
            </form>
          ) : a.action.href.startsWith("#") ? (
            <Link href={a.action.href} className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              {a.action.label}
            </Link>
          ) : (
            <ButtonLink href={a.action.href} size="sm" variant={a.connected ? "ghost" : "secondary"} className="ml-auto">
              {a.action.label}
              {!a.connected && <ArrowUpRight />}
            </ButtonLink>
          )}
        </div>
      ))}
    </div>
  );
}
