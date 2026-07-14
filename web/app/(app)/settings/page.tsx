import Link from "next/link";
import { ChevronRight, Coins, Gauge, KeyRound, Link2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { SpendCapForm } from "./SpendCapForm";

export const dynamic = "force-dynamic";

// Linked settings areas that live on their own routes.
const AREAS = [
  {
    href: "/settings/billing",
    icon: Coins,
    title: "Pipeline credits",
    description: "Balance, top-ups, and every charge — down to the API call.",
  },
  {
    href: "/connect",
    icon: Link2,
    title: "Connect socials",
    description: "Link Ayrshare so scheduled posts actually ship.",
  },
  {
    href: "/settings/tokens",
    icon: KeyRound,
    title: "Personal access tokens",
    description: "For the CLI, MCP server, and external agents.",
  },
] as const;

// Index page for the settings sub-tree. Contains a Spend Caps section
// plus nav cards for Connect and Tokens.
export default async function SettingsPage() {
  // Best-effort: if the user fetch fails we still render the page.
  let user: User | null = null;
  try {
    user = await api<User>("/api/v1/users/me");
  } catch {
    // ignore — form renders with empty default
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Settings
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Connections &amp; account
        </h1>
        <p className="text-sm text-muted-foreground">
          Spend caps, authentication, and per-account config for your
          marketer.sh workspace.
        </p>
      </header>

      {/* Spend caps — an inline form, not a nav target. */}
      <Card className="border-border/60 bg-card/40">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Gauge
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <CardTitle className="text-base font-semibold">
              Spend caps
            </CardTitle>
          </div>
          <CardDescription>
            Set a global daily limit across all niches. Leave blank for no
            global cap (each niche still has its own per-niche cap).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpendCapForm initialCap={user?.global_daily_cap_usd ?? null} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {AREAS.map((area) => {
          const Icon = area.icon;
          return (
            <Link
              key={area.href}
              href={area.href}
              className={cn(
                "group flex items-start gap-4 rounded-xl border border-border/60 bg-card/40 p-5 transition-colors",
                "hover:border-brand/30 hover:bg-card/60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              )}
            >
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground transition-colors group-hover:border-brand/30 group-hover:text-brand">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-sm font-semibold leading-none">
                  {area.title}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {area.description}
                </span>
              </span>
              <ChevronRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-brand"
                aria-hidden="true"
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
