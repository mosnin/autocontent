"use client";

import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AskPill,
  ButtonLink,
  Column,
  CountBadge,
  EmptyLine,
  FilterPill,
  List,
  ListRow,
  PageHeader,
  Section,
  Segmented,
  StatusBadge,
  ToolIcon,
} from "@/design-system";
import { TOOL_ICON } from "@/components/shell/sidebar";
import type { DepartmentId } from "@/lib/departments";
import { formatRelative, titleCase } from "@/lib/format";
import {
  type Activity,
  type ActivityEvent,
  type ActivityKind,
  type DecisionPage,
  hrefFor,
  type Inbox,
  type InboxKind,
  requiredActionFocusId,
  requiredActions,
  waitingCount,
} from "@/lib/workspace";
import { InboxCard } from "../inbox/inbox-card";
import { RequiredActionCard } from "../inbox/required-action-card";
import { dayKey, formatTime, relativeDayLabel, useLocalTime } from "./days";
import { DecisionsList } from "./decisions";

export type ActivityTab = "needs" | "all" | "decisions";

const DEPT: Record<ActivityKind, DepartmentId> = {
  video: "content",
  carousel: "content",
  article: "seo",
  ad_action: "paid",
  approval: "paid",
  campaign: "distribution",
};
const KIND_LABEL: Record<ActivityKind, string> = {
  video: "Video",
  carousel: "Carousel",
  article: "Article",
  ad_action: "Ad change",
  approval: "Approval",
  campaign: "Campaign",
};

type Filter = "all" | "video" | "carousel" | "article" | "ads" | "campaign";
const FILTERS: { value: Filter; label: string; kinds: ActivityKind[] }[] = [
  { value: "all", label: "All kinds", kinds: [] },
  { value: "video", label: "Videos", kinds: ["video"] },
  { value: "carousel", label: "Carousels", kinds: ["carousel"] },
  { value: "article", label: "Articles", kinds: ["article"] },
  { value: "ads", label: "Paid media", kinds: ["ad_action", "approval"] },
  { value: "campaign", label: "Campaigns", kinds: ["campaign"] },
];

const INBOX_GROUPS: { kind: InboxKind; label: string }[] = [
  { kind: "ad_change", label: "Ad changes" },
  { kind: "video", label: "Videos" },
  { kind: "carousel", label: "Carousels" },
];

const FAILED = new Set(["failed", "error", "errored"]);
const REJECTED = new Set(["rejected", "declined", "cancelled", "canceled"]);
const PENDING = new Set(["pending", "awaiting_approval", "needs_approval"]);
const DONE = new Set([
  "done",
  "approved",
  "posted",
  "published",
  "completed",
  "succeeded",
  "applied",
  "ready",
]);
const RUNNING = new Set([
  "running",
  "active",
  "queued",
  "ideating",
  "scripting",
  "generating_images",
  "animating",
  "voicing",
  "editing",
  "captioning",
  "qa",
  "scheduling",
  "researching",
  "outlining",
  "writing",
  "rendering",
  "planning",
  "generating",
]);

function Status({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (FAILED.has(s)) return <StatusBadge tone="negative">Failed</StatusBadge>;
  if (REJECTED.has(s)) return <StatusBadge>{titleCase(s)}</StatusBadge>;
  if (PENDING.has(s))
    return <StatusBadge tone="attention">Needs you</StatusBadge>;
  if (RUNNING.has(s))
    return (
      <StatusBadge>
        {s === "running" || s === "active" ? "Running" : titleCase(s)}
      </StatusBadge>
    );
  if (DONE.has(s)) return null;
  // Ad actions carry the verb as their status (pause, budget_change…).
  return <span className="text-[12px] text-fg-faint">{titleCase(s)}</span>;
}

function EventRow({
  e,
  local,
  isToday,
}: {
  e: ActivityEvent;
  local: boolean;
  isToday: boolean;
}) {
  const tool = TOOL_ICON[DEPT[e.kind] ?? "strategy"];
  return (
    <ListRow href={hrefFor(e.kind, e.ref_id)} className="min-h-11 py-2">
      <ToolIcon tone={tool.tone}>{tool.icon}</ToolIcon>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{e.title}</span>
        <span className="block truncate text-[12px] text-fg-muted">
          {KIND_LABEL[e.kind] ?? titleCase(e.kind)}
          {e.detail && ` · ${e.detail}`}
        </span>
      </span>
      <Status status={e.status} />
      <time
        dateTime={e.at}
        suppressHydrationWarning
        className="shrink-0 whitespace-nowrap text-[12px] text-fg-faint tabular"
      >
        {isToday ? formatRelative(e.at) : formatTime(e.at, local)}
      </time>
    </ListRow>
  );
}

/**
 * Activity and Inbox, one place (ref 07): "Needs you" holds required actions
 * (unknown outcomes) and then every approval as a plan card; "Everything" is
 * what the department did, grouped by day; "Decisions" is the log of what the
 * decision models judged.
 */
export function ActivityView({
  activity,
  inbox = null,
  decisions,
  before,
  cursor = null,
  basePath = "/activity",
  initialTab,
  focus = null,
}: {
  activity: Activity | null;
  inbox?: Inbox | null;
  /** The caller's decision log. `null` = the fetch failed; an empty page = decision models are off. */
  decisions?: DecisionPage | null;
  before?: string | null;
  /** Decision log page cursor (older pages). */
  cursor?: string | null;
  basePath?: string;
  initialTab?: ActivityTab;
  focus?: string | null;
}) {
  const required = requiredActions(inbox);
  const waiting = waitingCount(inbox);
  const [tab, setTab] = useState<ActivityTab>(
    initialTab ?? (focus || (waiting > 0 && !before) ? "needs" : "all"),
  );
  const [filter, setFilter] = useState<Filter>("all");
  const local = useLocalTime();
  const events = useMemo(() => activity?.events ?? [], [activity]);

  const groups = useMemo(() => {
    const kinds = FILTERS.find((f) => f.value === filter)!.kinds;
    const shown =
      filter === "all" ? events : events.filter((e) => kinds.includes(e.kind));
    const out: { key: string; events: ActivityEvent[] }[] = [];
    for (const e of shown) {
      const key = dayKey(e.at, local);
      const last = out[out.length - 1];
      if (last?.key === key) last.events.push(e);
      else out.push({ key, events: [e] });
    }
    return out;
  }, [events, filter, local]);

  const filters = FILTERS.filter(
    (f) => f.value === "all" || events.some((e) => f.kinds.includes(e.kind)),
  );
  const today = dayKey(new Date(), local);
  const failed = events.filter((e) =>
    FAILED.has(e.status.toLowerCase()),
  ).length;

  const description = !inbox
    ? "Approvals and everything the department did"
    : waiting > 0
      ? `${waiting} waiting on you${failed ? ` · ${failed} failed` : ""}`
      : `Nothing waiting on you${failed ? ` · ${failed} failed` : ""}`;
  const ask =
    tab === "decisions"
      ? `/sessions/new?q=${encodeURIComponent("Explain the decisions your models made recently, and where they disagreed with the rules")}`
      : tab === "needs" && waiting > 0
        ? `/sessions/new?q=${encodeURIComponent("Walk me through what's waiting on my approval")}`
        : `/sessions/new?q=${encodeURIComponent("Summarize what the department did this week")}`;

  return (
    <>
      <PageHeader
        title="Activity"
        actions={
          before ? (
            <ButtonLink href={basePath} size="sm" variant="ghost">
              <ArrowLeft />
              Latest
            </ButtonLink>
          ) : undefined
        }
      />
      <Column
        title="Activity"
        description={description}
        control={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Show"
              value={tab}
              onChange={setTab}
              options={[
                {
                  value: "needs",
                  label: (
                    <>
                      Needs you
                      {waiting > 0 && <CountBadge count={waiting} />}
                    </>
                  ),
                },
                { value: "all", label: "Everything" },
                { value: "decisions", label: "Decisions" },
              ]}
            />
            {tab === "all" && filters.length > 2 && (
              <div className="ml-auto">
                <FilterPill
                  label="Kind"
                  value={filter}
                  onChange={setFilter}
                  options={filters.map((f) => ({
                    value: f.value,
                    label: f.label,
                  }))}
                />
              </div>
            )}
          </div>
        }
      >
        {tab === "decisions" ? (
          <DecisionsList decisions={decisions} basePath={basePath} cursor={cursor} />
        ) : tab === "needs" ? (
          !inbox ? (
            <EmptyLine>
              Couldn&apos;t load what needs you. Try again in a moment.
            </EmptyLine>
          ) : waiting === 0 ? (
            <EmptyLine
              action={
                <ButtonLink href="/sessions/new" size="sm">
                  Ask Marketer for more
                </ButtonLink>
              }
            >
              Nothing needs you right now.
            </EmptyLine>
          ) : (
            <>
              {required.length > 0 && (
                <Section
                  title={`Check what happened · ${required.length}`}
                  action={<span className="text-[12px] text-fg-muted">Nothing retries until you say</span>}
                >
                  <div className="space-y-3">
                    {required.map((r) => (
                      <RequiredActionCard
                        key={r.id}
                        action={r}
                        focused={focus === requiredActionFocusId(r.id)}
                      />
                    ))}
                  </div>
                </Section>
              )}
              {INBOX_GROUPS.map((g) => {
                const items = inbox.items.filter((i) => i.kind === g.kind);
                if (items.length === 0) return null;
                return (
                  <Section key={g.kind} title={`${g.label} · ${items.length}`}>
                    <div className="space-y-3">
                      {items.map((it) => (
                        <InboxCard
                          key={it.id}
                          item={it}
                          focused={focus === it.id}
                        />
                      ))}
                    </div>
                  </Section>
                );
              })}
            </>
          )
        ) : !activity ? (
          <EmptyLine>
            Couldn&apos;t load activity. Try again in a moment.
          </EmptyLine>
        ) : events.length === 0 ? (
          <EmptyLine
            action={
              <ButtonLink href={before ? basePath : "/sessions/new"} size="sm">
                {before ? "Back to latest" : "Ask Marketer to make something"}
              </ButtonLink>
            }
          >
            {before
              ? "Nothing earlier."
              : "Nothing yet. Videos, articles and ad changes show up here."}
          </EmptyLine>
        ) : (
          <>
            {groups.length === 0 ? (
              <EmptyLine>Nothing of this kind on this page.</EmptyLine>
            ) : (
              groups.map((g) => (
                <Section
                  key={g.key}
                  title={relativeDayLabel(g.key, today)}
                  action={
                    <span className="text-[12px] text-fg-faint tabular">
                      {g.events.length}
                    </span>
                  }
                >
                  <List>
                    {g.events.map((e) => (
                      <EventRow
                        key={e.id}
                        e={e}
                        local={local}
                        isToday={g.key === today}
                      />
                    ))}
                  </List>
                </Section>
              ))
            )}
            <div className="flex justify-center">
              {activity.next_before ? (
                <ButtonLink
                  href={`${basePath}?tab=all&before=${encodeURIComponent(activity.next_before)}`}
                >
                  Load older
                </ButtonLink>
              ) : (
                <span className="text-[12px] text-fg-faint">
                  That&apos;s everything.
                </span>
              )}
            </div>
          </>
        )}
        <AskPill
          label={
            tab === "decisions"
              ? "Ask about these decisions"
              : tab === "needs" && waiting > 0
                ? "Ask about what's waiting"
                : "Ask about this activity"
          }
          href={ask}
        />
      </Column>
    </>
  );
}
