"use client";

import Link from "next/link";
import { Bell, ChevronRight, Coins, Gauge, KeyRound, Link2, Palette, ShieldCheck, Webhook } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  HoverLift,
  HubHeading,
  HubSection,
  Rise,
  hubCardClass,
  hubCardHoverClass,
} from "@/components/hub/primitives";
import { cn } from "@/lib/utils";
import { SpendCapForm } from "./SpendCapForm";
import { NotificationsForm } from "./NotificationsForm";

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
  {
    href: "/settings/brand",
    icon: Palette,
    title: "Brand kit",
    description: "A reusable identity that seeds every new channel draft.",
  },
  {
    href: "/settings/webhooks",
    icon: Webhook,
    title: "Webhooks",
    description: "Signed real-time events for agents and automation.",
  },
  {
    href: "/settings/privacy",
    icon: ShieldCheck,
    title: "Data & privacy",
    description: "Export everything we hold, or delete your account.",
  },
] as const;

export function SettingsShell({
  initialCap,
  initialNotifications,
}: {
  initialCap: string | null;
  initialNotifications: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Rise>
        <header className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
            Settings
          </p>
          <HubHeading as="h1">Connections &amp; account</HubHeading>
          <p className="text-sm text-muted-foreground">
            Spend caps, authentication, and per-account config for your
            marketer.sh workspace.
          </p>
        </header>
      </Rise>

      {/* Spend caps — an inline form, not a nav target. */}
      <Rise delay={0.08}>
        <Card className={hubCardClass}>
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
            <SpendCapForm initialCap={initialCap} />
          </CardContent>
        </Card>
      </Rise>

      {/* Notifications — inline toggle, saves optimistically. */}
      <Rise delay={0.16}>
        <Card className={hubCardClass}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-base font-semibold">
                Notifications
              </CardTitle>
            </div>
            <CardDescription>
              Control the emails marketer.sh sends you at the end of a run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationsForm initialEnabled={initialNotifications} />
          </CardContent>
        </Card>
      </Rise>

      <HubSection index={3} title="Workspace">
        <div className="grid gap-4 sm:grid-cols-2">
          {AREAS.map((area) => {
            const Icon = area.icon;
            return (
              <HoverLift key={area.href}>
                <Link
                  href={area.href}
                  className={cn(
                    hubCardClass,
                    hubCardHoverClass,
                    "group flex h-full items-start gap-4 p-5",
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
              </HoverLift>
            );
          })}
        </div>
      </HubSection>
    </div>
  );
}
