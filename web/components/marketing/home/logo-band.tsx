import * as React from "react";

/**
 * The strip under the hero states something true: where the machine
 * actually publishes. No invented customer logos — real ones can join
 * later, as themselves.
 */
const DESTINATIONS = [
  "TikTok",
  "Instagram Reels",
  "YouTube Shorts",
  "SEO articles",
  "Google Ads",
  "Meta Ads",
];

export function LogoBand() {
  return (
    <section aria-label="Publishes to" className="border-y border-zinc-900/[0.05] bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-6 py-10 md:flex-row md:justify-between">
        <p className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
          One brief ships to
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-2">
          {DESTINATIONS.map((d) => (
            <li
              className="rounded-full border border-zinc-900/10 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700"
              key={d}
            >
              {d}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
