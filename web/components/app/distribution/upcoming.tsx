"use client";

import { useEffect, useState } from "react";
import { EmptyLine, List, ListRow, StatusBadge, Time } from "@/design-system";
import type { CalendarItem, PlaybookRef } from "@/lib/business";

export const PLATFORM: Record<string, string> = { tiktok: "TikTok", reels: "Reels", shorts: "Shorts" };
const KIND: Record<string, string> = { video: "Video", article: "Article", ad: "Ad" };

export const channelLabel = (it: CalendarItem) => (it.platform ? (PLATFORM[it.platform] ?? it.platform) : (KIND[it.kind] ?? it.kind));

export function itemHref(it: CalendarItem): string {
  if (it.kind === "video") return `/content/videos/${it.id}`;
  if (it.kind === "article") return `/seo/${it.id}`;
  if (it.kind === "ad") return `/paid/campaigns/${it.id}`;
  return "/plan";
}

const WHEN: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" };

/** A compact list of what goes out next. The full calendar lives on Plan. */
export function Upcoming({ items, playbooks, max = 8 }: { items: CalendarItem[] | null; playbooks: PlaybookRef[]; max?: number }) {
  // Past items drop off once the browser knows the time (server and client may differ).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  if (items === null) return <EmptyLine>The calendar is out of reach right now.</EmptyLine>;
  const pb = Object.fromEntries(playbooks.map((p) => [p.id, p.title]));
  const list = items
    .filter((i) => now === null || new Date(i.at).getTime() >= now - 3600_000)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, max);
  if (list.length === 0) return <EmptyLine>Nothing scheduled in the next seven days.</EmptyLine>;
  return (
    <List>
      {list.map((it) => (
        <ListRow key={`${it.kind}-${it.id}`} href={itemHref(it)} className="min-h-11 py-2">
          <span className="w-[92px] shrink-0 whitespace-nowrap text-[12px] text-fg-muted tabular">
            <Time iso={it.at} format={WHEN} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px]">{it.title}</span>
            <span className="block truncate text-[12px] text-fg-muted sm:hidden">
              {channelLabel(it)}
              {pb[it.niche_id] ? ` · ${pb[it.niche_id]}` : ""}
            </span>
          </span>
          <span className="hidden shrink-0 text-[12px] text-fg-muted sm:inline">
            {channelLabel(it)}
            {pb[it.niche_id] ? ` · ${pb[it.niche_id]}` : ""}
          </span>
          {it.status === "awaiting_approval" && <StatusBadge tone="attention">Needs you</StatusBadge>}
        </ListRow>
      ))}
    </List>
  );
}
