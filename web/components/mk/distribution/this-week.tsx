"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CalendarItem, PlaybookRef } from "@/lib/business";
import { Dot } from "../ui";

const PLATFORM: Record<string, string> = { tiktok: "TikTok", reels: "Reels", shorts: "Shorts" };
const KIND: Record<string, string> = { video: "Video", article: "Article", ad: "Ad" };

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function itemHref(it: CalendarItem): string {
  if (it.kind === "video") return `/content/videos/${it.id}`;
  if (it.kind === "article") return `/seo/${it.id}`;
  if (it.kind === "ad") return `/paid/campaigns/${it.id}`;
  return "/plan";
}

/** A compact week: what's going out, grouped by day. The full calendar lives on Plan. */
export function ThisWeek({ items, playbooks }: { items: CalendarItem[] | null; playbooks: PlaybookRef[] }) {
  // Times render in the viewer's timezone, so this waits for the browser.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  if (items === null) return <p className="text-[13px] text-muted-foreground">The calendar is out of reach right now.</p>;
  if (now === null) return <div className="h-24" aria-busy />;
  const week = items.filter((i) => {
    const t = new Date(i.at).getTime();
    return t >= now - 3600_000 && t <= now + 7 * 86400_000;
  }).sort((a, b) => a.at.localeCompare(b.at));
  if (week.length === 0) return <p className="text-[13px] text-muted-foreground">Nothing scheduled in the next seven days. Ask the Distribution manager to fill the week.</p>;
  const pb = Object.fromEntries(playbooks.map((p) => [p.id, p.title]));
  const label = (it: CalendarItem) => [it.platform ? PLATFORM[it.platform] ?? it.platform : KIND[it.kind] ?? it.kind, pb[it.niche_id]].filter(Boolean).join(" · ");
  const groups: [string, CalendarItem[]][] = [];
  for (const it of week.slice(0, 8)) {
    const k = dayKey(it.at);
    const g = groups.find(([key]) => key === k);
    if (g) g[1].push(it);
    else groups.push([k, [it]]);
  }
  return (
    <div className="space-y-3">
      {groups.map(([k, list]) => (
        <div key={k}>
          <div className="mb-1 text-[12px] text-faint">{k}</div>
          <ul className="-mx-2">
            {list.map((it) => (
              <li key={`${it.kind}-${it.id}`}>
                <Link href={itemHref(it)} title={label(it)} className="press flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                  <span className="w-[60px] shrink-0 whitespace-nowrap text-[12px] text-muted-foreground tabular">{new Date(it.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                  {it.status === "awaiting_approval" ? <Dot tone="warn" label="Needs you" /> : <Dot tone="muted" />}
                  <span className="min-w-0 flex-1 truncate text-[14px]">{it.title}</span>
                  <span className="hidden shrink-0 text-[12px] text-faint sm:inline">
                    {it.platform ? PLATFORM[it.platform] ?? it.platform : KIND[it.kind] ?? it.kind}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

