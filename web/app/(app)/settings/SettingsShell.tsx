"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BannerCard,
  DashHeading,
  DashPanel,
  DashRise,
  MediaCard,
} from "@/components/hub/dashboard-kit";
import { hubCardClass } from "@/components/hub/primitives";
import { cn } from "@/lib/utils";
import { SpendCapForm } from "./SpendCapForm";
import { NotificationsForm } from "./NotificationsForm";

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

      <div className="grid gap-5 lg:grid-cols-2">
        <DashRise delay={0.08}>
          <BannerCard
            href="/settings/brand"
            media={
              <div className="flex h-full min-h-44 flex-col justify-center gap-2 p-5">
                <div className="flex gap-2">
                  {["#18181b", "#f59e0b", "#f43f5e", "#fafafa"].map((c) => (
                    <span
                      className="size-8 rounded-lg border border-border/60"
                      key={c}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-[13px]">
                  <span className="font-semibold">Voice: </span>
                  <span className="text-muted-foreground">
                    direct, a little dry, never salesy
                  </span>
                </div>
                <div className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-[13px] text-muted-foreground">
                  Seeds every new channel draft automatically.
                </div>
              </div>
            }
            tagline="One identity behind every draft"
            title="Brand kit"
          />
        </DashRise>
        <DashRise delay={0.16}>
          <BannerCard
            href="/settings/billing"
            media={
              <div className="flex h-full min-h-44 flex-col justify-center gap-2 p-5">
                <div className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-medium">Pipeline credits</span>
                    <span className="font-mono text-[12px] text-muted-foreground">
                      62% left
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-900/10">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#f59e0b,#f43f5e)]"
                      style={{ width: "62%" }}
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-[13px] text-muted-foreground">
                  Balance, top-ups, and every charge — down to the API call.
                </div>
              </div>
            }
            tagline="Balance, top-ups, every charge"
            title="Billing & credits"
          />
        </DashRise>
      </div>

      <DashPanel delay={0.1} title="Workspace">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <MediaCard
            foot="Reusable presets for channels and drafts"
            href="/settings/kits"
            media={
              <div className="flex h-full min-h-28 flex-col justify-center gap-1.5 p-4 text-[11.5px]">
                {["Launch kit", "Evergreen kit", "UGC kit"].map((k) => (
                  <div
                    className="rounded-lg border border-border/60 bg-card px-2.5 py-1.5 font-medium"
                    key={k}
                  >
                    {k}
                  </div>
                ))}
              </div>
            }
            title="Kits"
          />
          <MediaCard
            foot="Link Ayrshare so scheduled posts actually ship"
            href="/connect"
            media={
              <div className="flex h-full min-h-28 flex-col justify-center gap-1.5 p-4 text-[11.5px]">
                {[
                  ["TikTok", "linked"],
                  ["YouTube", "linked"],
                  ["X", "not linked"],
                ].map(([name, state]) => (
                  <div
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-2.5 py-1.5"
                    key={name}
                  >
                    <span className="font-medium">{name}</span>
                    <span
                      className={cn(
                        "ml-2",
                        state === "linked"
                          ? "font-medium text-amber-600"
                          : "text-muted-foreground",
                      )}
                    >
                      {state}
                    </span>
                  </div>
                ))}
              </div>
            }
            title="Connect socials"
          />
          <MediaCard
            foot="For the CLI, MCP server, and external agents"
            href="/settings/tokens"
            media={
              <div className="flex h-full min-h-28 flex-col justify-center gap-1.5 p-4">
                <div className="rounded-lg border border-border/60 bg-card px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                  mk_live_••••••••7f2a
                </div>
                <div className="rounded-lg border border-border/60 bg-card px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                  mk_live_••••••••c914
                </div>
                <p className="px-0.5 pt-1 text-[11.5px] text-muted-foreground">
                  Scoped, revocable, audit-logged.
                </p>
              </div>
            }
            title="Tokens"
          />
          <MediaCard
            foot="Signed real-time events for agents and automation"
            href="/settings/webhooks"
            media={
              <div className="flex h-full min-h-28 flex-col justify-center gap-1.5 p-4 text-[11.5px]">
                {[
                  ["run.completed", "200"],
                  ["post.published", "200"],
                  ["cap.reached", "200"],
                ].map(([event, code]) => (
                  <div
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-2.5 py-1.5"
                    key={event}
                  >
                    <span className="truncate font-mono text-[10.5px]">
                      {event}
                    </span>
                    <span className="ml-2 shrink-0 font-mono text-[10.5px] font-semibold text-amber-600">
                      {code}
                    </span>
                  </div>
                ))}
              </div>
            }
            title="Webhooks"
          />
          <MediaCard
            foot="Export everything we hold, or delete your account"
            href="/settings/privacy"
            media={
              <div className="flex h-full min-h-28 flex-col justify-center gap-1.5 p-4 text-[11.5px]">
                <div className="rounded-lg border border-border/60 bg-card px-2.5 py-1.5 font-medium">
                  Export my data
                </div>
                <div className="rounded-lg border border-dashed border-border/70 bg-card/60 px-2.5 py-1.5 text-muted-foreground">
                  Delete account — yours to pull, any time
                </div>
              </div>
            }
            title="Privacy"
          />
        </div>
      </DashPanel>

      <DashPanel delay={0.12} title="Account controls">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className={hubCardClass}>
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
          <Card className={hubCardClass}>
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
    </div>
  );
}
