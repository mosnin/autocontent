"use client";

import { CalendarDays, Send } from "lucide-react";
import { useState } from "react";
import { ButtonLink, Column, EmptyLine, KpiCard, PageHeader, Section, Segmented, ApprovalCard, Time, ToolTitle } from "@/design-system";
import { StartSession } from "@/components/chat/start-session";
import { TOOL_ICON } from "@/components/shell/sidebar";
import type { CalendarItem, PlaybookRef } from "@/lib/business";
import { departmentById } from "@/lib/departments";
import type { AyrshareConnectStatus, Campaign } from "@/lib/types";
import { CampaignsTable, NewCampaignButton } from "./campaigns";
import { Channels } from "./channels";
import { channelLabel, Upcoming } from "./upcoming";

const WHEN: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

type Detail = "upcoming" | "campaigns" | "channels";

/**
 * Distribution (README §5 Tool): ask, the next 7 days, posts waiting on you,
 * then one segmented control for what goes out next, campaigns and channels.
 * When no posting profile exists, the channel row sits above it instead, since
 * nothing posts until it's connected.
 */
export function DistributionView({ ayrshare, campaigns, calendar, playbooks }: { ayrshare: AyrshareConnectStatus | null; campaigns: Campaign[] | null; calendar: CalendarItem[] | null; playbooks: PlaybookRef[] }) {
  const dept = departmentById("distribution")!;
  const tool = TOOL_ICON.distribution;
  const pb = Object.fromEntries(playbooks.map((p) => [p.id, p.title]));
  const items = calendar ?? [];
  const waiting = items.filter((i) => i.status === "awaiting_approval" && i.kind === "video");
  const running = (campaigns ?? []).filter((c) => c.status === "running");
  const runningBudget = running.reduce((s, c) => s + Number(c.budget_usd), 0);
  const unconnected = ayrshare === null || !ayrshare.connected;
  const [detail, setDetail] = useState<Detail>("upcoming");

  return (
    <>
      <PageHeader
        icon={<Send />}
        title="Distribution"
        actions={
          <ButtonLink href="/plan" variant="ghost">
            <CalendarDays /> Plan
          </ButtonLink>
        }
      />
      <Column width="lg" title={<ToolTitle icon={tool.icon} tone={tool.tone}>Distribution</ToolTitle>} description={dept.summary}>
        <StartSession scope="distribution" lockScope />

        <Section title="Next 7 days">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Scheduled" value={calendar === null ? "—" : items.length} href="/plan" />
            <KpiCard label="Waiting on you" value={calendar === null ? "—" : waiting.length} href="/inbox" />
            <KpiCard label="Running campaigns" value={campaigns === null ? "—" : running.length} />
            <KpiCard label="Running budgets" value={campaigns === null ? "—" : `$${runningBudget.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
          </div>
        </Section>

        {waiting.length > 0 && (
          <Section title="Needs you" count={waiting.length}>
            <div className="space-y-3">
              {waiting.map((it) => (
                <ApprovalCard
                  key={it.id}
                  item={{ kind: "video", ref_id: it.id }}
                  title={it.title}
                  icon={<Send className="size-3.5 text-on-fill" />}
                  meta={channelLabel(it)}
                  steps={[
                    { label: `Post to ${channelLabel(it)}${pb[it.niche_id] ? ` · ${pb[it.niche_id]}` : ""}` },
                    { label: <>Scheduled for <Time iso={it.at} format={WHEN} /></> },
                    { label: "Goes out on schedule once approved" },
                  ]}
                />
              ))}
            </div>
          </Section>
        )}

        {unconnected && (
          <Section title="Channels">
            <Channels status={ayrshare} />
          </Section>
        )}

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="Distribution detail"
              value={detail}
              onChange={setDetail}
              options={[
                { value: "upcoming", label: "Upcoming" },
                { value: "campaigns", label: <>Campaigns{running.length > 0 && <span className="font-normal text-fg-faint tabular">{running.length} running</span>}</> },
                ...(unconnected ? [] : [{ value: "channels" as const, label: "Channels" }]),
              ]}
            />
            {/* The header's "Plan" already opens the calendar; only Campaigns needs its own action here. */}
            {detail === "campaigns" && campaigns && campaigns.length > 0 && <NewCampaignButton hasPlaybooks={playbooks.length > 0} />}
          </div>
          <div key={detail} className="ds-swap">
            {detail === "upcoming" ? (
              <Upcoming items={calendar} playbooks={playbooks} />
            ) : detail === "campaigns" ? (
              campaigns === null ? <EmptyLine>Campaigns are out of reach right now. Refresh in a moment.</EmptyLine> : <CampaignsTable campaigns={campaigns} hasPlaybooks={playbooks.length > 0} />
            ) : (
              <Channels status={ayrshare} />
            )}
          </div>
        </section>
      </Column>
    </>
  );
}
