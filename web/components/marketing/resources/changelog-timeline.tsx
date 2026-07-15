import * as React from "react";

import { Stagger } from "@/components/marketing/system";

export type ChangelogEntry = {
  date: string;
  title: string;
  body: string;
  tags: string[];
};

/**
 * Vertical changelog: hairline rail on the left, date chips at each node,
 * one white entry card per release. Newest first.
 */
export function ChangelogTimeline({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute inset-y-3 left-[0.4375rem] w-px bg-zinc-900/[0.08]"
      />
      <Stagger className="space-y-10" gap={0.06}>
        {entries.map((entry) => (
          <div className="relative pl-10" key={entry.title}>
            <span
              aria-hidden
              className="absolute left-0 top-2 size-[0.9375rem] rounded-full border-[3px] border-white bg-zinc-900/20 shadow-[0_0_0_1px_rgba(15,23,42,0.10)]"
            />
            <p className="inline-flex items-center rounded-full border border-zinc-900/10 bg-white px-3 py-1 font-mono text-[11px] font-medium tabular-nums text-zinc-500">
              {entry.date}
            </p>
            <div className="mt-3 rounded-[1.5rem] border border-zinc-900/[0.06] bg-white p-6 shadow-[0_8px_40px_rgba(15,23,42,0.05)] md:p-7">
              <h2 className="font-display text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
                {entry.title}
              </h2>
              <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-zinc-600">
                {entry.body}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {entry.tags.map((tag) => (
                  <span
                    className="rounded-full border border-zinc-900/[0.08] bg-zinc-900/[0.03] px-2.5 py-1 text-[11px] font-medium text-zinc-500"
                    key={tag}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </Stagger>
    </div>
  );
}
