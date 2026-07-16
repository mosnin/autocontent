"use client";

// Agenda / timeline rendering of the calendar. Because posting windows
// are sparse, a vertical list of day-sections reads far better than a
// dense month grid: each present day gets a heading and its scheduled
// items as rows. Videos link to /queue/[id]; articles to /articles/[id].
import * as React from "react";
import Link from "next/link";
import { Instagram, Music2, Youtube } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  articleStatusLabel,
  ArticleStatusBadge,
  jobStatusLabel,
  StatusBadge,
} from "@/lib/status-badge";
import { cn } from "@/lib/utils";
import type { ArticleStatus, JobStatus } from "@/lib/types";

import type { CalendarItem } from "./types";
import { formatTime, type DayGroup } from "./utils";

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

function PlatformIcon({ platform }: { platform: string }) {
  const cls = "size-3.5 text-muted-foreground";
  if (platform === "tiktok") return <Music2 className={cls} aria-hidden />;
  if (platform === "reels") return <Instagram className={cls} aria-hidden />;
  if (platform === "shorts") return <Youtube className={cls} aria-hidden />;
  return null;
}

const KIND_META: Record<
  CalendarItem["kind"],
  { label: string; dot: string }
> = {
  video: { label: "Video", dot: "bg-brand" },
  article: { label: "Article", dot: "bg-cat-navy/60" },
  ad: { label: "Ad", dot: "bg-cat-orange" },
};

function KindChip({ kind }: { kind: CalendarItem["kind"] }) {
  const meta = KIND_META[kind];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span aria-hidden className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

function statusText(item: CalendarItem): string {
  if (item.kind === "video") return jobStatusLabel(item.status as JobStatus);
  if (item.kind === "ad") return item.status;
  return articleStatusLabel(item.status as ArticleStatus);
}

function itemHref(item: CalendarItem): string {
  if (item.kind === "video") return `/queue/${item.id}`;
  if (item.kind === "ad") return `/ads/campaigns/${item.id}`;
  return `/articles/${item.id}`;
}

function AgendaItem({ item }: { item: CalendarItem }) {
  const href = itemHref(item);
  const time = formatTime(item.at);
  const platformLabel =
    item.platform != null
      ? (PLATFORM_LABEL[item.platform] ?? item.platform)
      : null;

  return (
    <li>
      <Link
        href={href}
        aria-label={`${KIND_META[item.kind].label}: ${
          item.title
        }, ${statusText(item)}, scheduled ${time}`}
        className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40"
      >
        <time
          dateTime={item.at}
          className="w-16 shrink-0 font-mono text-sm tabular-nums text-muted-foreground"
        >
          {time}
        </time>
        <KindChip kind={item.kind} />
        <span className="min-w-0 flex-1 basis-40 truncate font-medium transition-colors group-hover:text-foreground">
          {item.title}
        </span>
        {item.kind === "video" && platformLabel && (
          <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            {item.platform && <PlatformIcon platform={item.platform} />}
            {platformLabel}
          </span>
        )}
        {item.kind === "video" ? (
          <StatusBadge status={item.status as JobStatus} />
        ) : item.kind === "article" ? (
          <ArticleStatusBadge status={item.status as ArticleStatus} />
        ) : (
          <span className="rounded-md border border-cat-orange/40 bg-cat-orange/10 px-2 py-0.5 text-xs font-medium capitalize text-cat-orange">
            {item.status}
          </span>
        )}
      </Link>
    </li>
  );
}

function DaySection({ group }: { group: DayGroup }) {
  const headingId = `day-${group.key}`;
  const count = group.items.length;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2
          id={headingId}
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          {group.isToday && (
            <span aria-hidden className="size-1.5 rounded-full bg-brand" />
          )}
          {group.label}
        </h2>
        <span className="text-xs text-muted-foreground">{group.sub}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {count} {count === 1 ? "item" : "items"}
        </span>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <ul className="divide-y divide-border/60">
          {group.items.map((item) => (
            <AgendaItem key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

export function AgendaList({ groups }: { groups: DayGroup[] }) {
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <DaySection key={group.key} group={group} />
      ))}
    </div>
  );
}
