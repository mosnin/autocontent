"use client";

import { CalendarDays, Send } from "lucide-react";
import { ButtonLink, Column, EmptyLine, KpiCard, PageHeader, Section, ApprovalCard, Time, ToolTitle } from "@/design-system";
import { StartSession } from "@/components/chat/start-session";
import { TOOL_ICON } from "@/components/shell/sidebar";
import type { CalendarItem, PlaybookRef } from "@/lib/business";
import { departmentById } from "@/lib/departments";
import type { AyrshareConnectStatus, Campaign } from "@/lib/types";
import { CampaignsTable, NewCampaignButton } from "./campaigns";
import { Channels } from "./channels";
import { channelLabel, Upcoming } from "./upcoming";

const WHEN: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/** Distribution (README §5 Tool): ask, KPIs, posts waiting on you, what goes out next, channels, campaigns. */
export function DistributionView({ ayrshare, campaigns, calendar, playbooks }: { ayrshare: AyrshareConnectStatus | null; campaigns: Campaign[] | null; calendar: CalendarItem[] | null; playbooks: PlaybookRef[] }) {
  const dept = departmentById("distribution")!;
  const tool = TOOL_ICON.distribution;
  const pb = Object.fromEntries(playbooks.map((p) => [p.id, p.title]));
  const items = calendar ?? [];
  const waiting = items.filter((i) => i.status === "awaiting_approval" && i.kind === "video");
  const running = (campaigns ?? []).filter((c) => c.status === "running");
  const runningBudget = running.reduce((s, c) => s + Number(c.budget_usd), 0);

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
          <Section title={`Needs you · ${waiting.length}`}>
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

        <Section
          title="Upcoming"
          action={
            <ButtonLink href="/plan" size="sm" variant="ghost">
              Open plan
            </ButtonLink>
          }
        >
          <Upcoming items={calendar} playbooks={playbooks} />
        </Section>

        <Section
          title="Channels"
          action={
            <ButtonLink href="/integrations" size="sm" variant="ghost">
              All integrations
            </ButtonLink>
          }
        >
          <Channels status={ayrshare} />
        </Section>

        <Section title="Campaigns" action={campaigns && campaigns.length > 0 ? <NewCampaignButton hasPlaybooks={playbooks.length > 0} /> : undefined}>
          {campaigns === null ? <EmptyLine>Campaigns are out of reach right now. Refresh in a moment.</EmptyLine> : <CampaignsTable campaigns={campaigns} hasPlaybooks={playbooks.length > 0} />}
        </Section>
      </Column>
    </>
  );
}
