"use client";

import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/square/ui/card";
import { DashHeading, DashPanel } from "@/components/hub/dashboard-kit";
import { SpendCapForm } from "./SpendCapForm";
import { NotificationsForm } from "./NotificationsForm";

const SETTINGS_LINKS = [
  { href: "/settings/brand", label: "Brand kit", desc: "Voice, colors, and defaults for every draft" },
  { href: "/settings/billing", label: "Billing & credits", desc: "Balance, top-ups, and every charge" },
  { href: "/settings/kits", label: "Kits", desc: "Reusable presets for channels and drafts" },
  { href: "/connect", label: "Connect socials", desc: "Link the platforms scheduled posts publish to" },
  { href: "/settings/tokens", label: "Tokens", desc: "Scoped API tokens for the CLI, MCP, and agents" },
  { href: "/settings/webhooks", label: "Webhooks", desc: "Signed real-time events for automation" },
  { href: "/settings/privacy", label: "Privacy", desc: "Export your data, or delete your account" },
];

export function SettingsShell({
  initialCap,
  initialNotifications,
}: {
  initialCap: string | null;
  initialNotifications: boolean;
}) {
  return (
    <div className="space-y-10">
      <DashHeading
        as="h1"
        sub="Spend caps, authentication, and per-account config for your marketer.sh workspace."
      >
        Everything behind the scenes
      </DashHeading>

      <DashPanel delay={0.08} title="Account controls">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Spend caps
              </CardTitle>
              <CardDescription>
                Set a global daily limit across all niches. Leave blank for no
                global cap (each niche still has its own per-niche cap).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SpendCapForm initialCap={initialCap} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Notifications
              </CardTitle>
              <CardDescription>
                Control the emails marketer.sh sends you at the end of a run.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NotificationsForm initialEnabled={initialNotifications} />
            </CardContent>
          </Card>
        </div>
      </DashPanel>

      <DashPanel delay={0.1} title="More settings">
        <div className="grid gap-3 sm:grid-cols-2">
          {SETTINGS_LINKS.map((link) => (
            <Link className="block" href={link.href} key={link.href}>
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardContent className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{link.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {link.desc}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </DashPanel>
    </div>
  );
}
