"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import TextType from "@/components/reactbits/TextType";
import { HubHeading, Rise, hubCardClass } from "@/components/hub/primitives";
import { LatestVideos } from "@/components/latest-videos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The suite home: a working brief composer (creates a real campaign and
 * jumps into it), the live video library, and direct links into every
 * surface. Everything here is functional — navigation lives in the shell
 * sidebar and switcher.
 */
export function HomeHub() {
  const router = useRouter();
  const [brief, setBrief] = React.useState("");
  const [budget, setBudget] = React.useState("25");
  const [busy, setBusy] = React.useState(false);

  const createCampaign = async () => {
    const text = brief.trim();
    if (!text) {
      toast.error("Write a one-line brief first");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/api/v1/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // First clause as the name, full text as the objective.
          name: text.split(/[.!?\n]/)[0].slice(0, 80) || "New campaign",
          objective: text,
          budget_usd: budget || "25",
          ends_at: null,
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const campaign = await res.json();
      toast.success("Campaign created — add lanes and press start");
      router.push(`/campaigns/${campaign.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      {/* Brief composer — the "chat" surface of the suite. */}
      <section aria-label="New brief" className="space-y-4">
        <Rise>
          <HubHeading as="h1" className="text-2xl">
            What are we shipping today?
          </HubHeading>
          <TextType
            as="p"
            className="mt-1 text-sm text-muted-foreground"
            cursorCharacter="▍"
            pauseDuration={2200}
            text={[
              "Describe the push. It becomes a campaign.",
              "Content, SEO, and ads, under one cap.",
              "Your agents are on the clock.",
            ]}
            typingSpeed={40}
          />
        </Rise>
        <Rise delay={0.06}>
          <div className={cn(hubCardClass, "p-4")}>
            <Textarea
              aria-label="Campaign brief"
              className="min-h-24 resize-none border-0 p-1 text-[15px] shadow-none focus-visible:ring-0"
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  void createCampaign();
                }
              }}
              placeholder="Describe the campaign — audience, goal, angle. Example: Drive signups for the spring launch with daily shorts and two buying guides."
              value={brief}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Daily cap $
                <Input
                  aria-label="Daily credit cap in USD"
                  className="h-8 w-20"
                  min={1}
                  onChange={(e) => setBudget(e.target.value)}
                  step="1"
                  type="number"
                  value={budget}
                />
              </label>
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  ⌘↵ to create
                </span>
                <Button disabled={busy} onClick={() => void createCampaign()}>
                  {busy ? "Creating…" : "Create campaign"}
                </Button>
              </div>
            </div>
          </div>
        </Rise>
        <Rise className="flex flex-wrap gap-2.5" delay={0.12}>
          {[
            { label: "Queue a short", href: "/queue" },
            { label: "Draft an article", href: "/articles?new=1" },
            { label: "Review ad approvals", href: "/ads/approvals" },
            { label: "Connect socials", href: "/connect" },
            { label: "Top up credits", href: "/settings/billing" },
          ].map((a) => (
            <Link
              className="rounded-full border border-border/70 bg-card px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={a.href}
              key={a.label}
            >
              {a.label}
            </Link>
          ))}
        </Rise>
      </section>

      {/* Library — real rendered videos, straight from the API. The
          component owns its own heading and links. */}
      <Rise delay={0.1}>
        <LatestVideos />
      </Rise>
    </div>
  );
}
