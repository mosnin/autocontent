import * as React from "react";

import { AutomationOrbitIllustration } from "@/components/marketing/illustrations";
import {
  DisplayHeading,
  GlassPanel,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  Stagger,
} from "@/components/marketing/system";

import { ProofList } from "./proof-list";

/* ------------------------------------------------------------------ */
/* Surface cards: API / SDK / CLI / MCP                                */
/* ------------------------------------------------------------------ */

function TerminalFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-900/[0.06] bg-zinc-950">
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="size-2.5 rounded-full bg-white/10" />
      </div>
      <div className="space-y-1 overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function SurfaceCard({
  name,
  title,
  copy,
  children,
}: {
  name: string;
  title: string;
  copy: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-[2rem] border border-zinc-900/[0.06] bg-white p-7 shadow-[0_8px_40px_rgba(15,23,42,0.06)] md:p-8">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl font-semibold tracking-tight text-zinc-900">
          {title}
        </h3>
        <span className="rounded-full bg-zinc-900/[0.05] px-2.5 py-1 font-mono text-[11px] font-medium text-zinc-500">
          {name}
        </span>
      </div>
      <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">{copy}</p>
      <div className="mt-auto pt-6">{children}</div>
    </div>
  );
}

export function SurfaceCards() {
  return (
    <section
      aria-label="Agent surfaces"
      className="mx-auto max-w-6xl px-6 py-24 md:py-32"
    >
      <Reveal className="max-w-2xl">
        <Kicker>Four surfaces, one platform</Kicker>
        <DisplayHeading className="mt-4">
          Whatever your agent speaks, it&apos;s covered.
        </DisplayHeading>
        <Lede className="mt-5">
          Agents can create niches, enqueue videos, generate articles, and
          check spend, from whichever surface fits the stack.
        </Lede>
      </Reveal>

      <Stagger className="mt-12 grid gap-6 md:grid-cols-2" gap={0.08}>
        <SurfaceCard
          copy="Every pipeline behind plain endpoints. Enqueue a video, poll a job, read the ledger."
          name="REST"
          title="API"
        >
          <TerminalFrame>
            <p className="text-zinc-300">
              <span className="text-sky-400">POST</span> /v1/niches/home-espresso/videos
            </p>
            <p className="text-zinc-500">
              202 Accepted · job <span className="text-zinc-300">vid_8c21</span> queued
            </p>
          </TerminalFrame>
        </SurfaceCard>

        <SurfaceCard
          copy="Typed end to end. Your editor knows the request shapes before the docs do."
          name="Python"
          title="SDK"
        >
          <TerminalFrame>
            <p className="text-zinc-300">
              <span className="text-violet-400">from</span> marketer{" "}
              <span className="text-violet-400">import</span> Marketer
            </p>
            <p className="text-zinc-300">
              client.videos.enqueue(niche=<span className="text-emerald-400">&quot;home-espresso&quot;</span>)
            </p>
          </TerminalFrame>
        </SurfaceCard>

        <SurfaceCard
          copy="The whole platform from a shell. Scriptable, cron-able, agent-runnable."
          name="CLI"
          title="marketer"
        >
          <TerminalFrame>
            <p className="text-zinc-300">
              <span className="text-zinc-600">$ </span>marketer articles generate --niche{" "}
              <span className="text-emerald-400">&quot;home espresso&quot;</span>
            </p>
            <p className="text-zinc-500">→ outline ready · 8 sections · draft queued</p>
          </TerminalFrame>
        </SurfaceCard>

        <SurfaceCard
          copy="Tool descriptions carry cost estimates, so an agent knows the price before it calls."
          name="MCP"
          title="MCP server"
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-zinc-900/[0.06] bg-zinc-950 px-4 py-3">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[11px] text-zinc-400">
                tool
              </span>
              <code className="font-mono text-[13px] text-zinc-300">
                generate_article
              </code>
              <span className="ml-auto font-mono text-[11px] text-zinc-500">
                confirms cost first
              </span>
            </div>
            <div className="rounded-2xl border border-zinc-900/[0.06] bg-white px-4 py-3 text-[13px] leading-snug text-zinc-600 shadow-sm">
              Estimated $0.34 against today&apos;s $10.00 cap. Proceed?
            </div>
          </div>
        </SurfaceCard>
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Scheduled windows                                                   */
/* ------------------------------------------------------------------ */

export function WindowsBand() {
  return (
    <section aria-label="Scheduled windows" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="pearl"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>Autopilot</Kicker>
            <DisplayHeading className="mt-4">
              The schedule runs itself.
            </DisplayHeading>
            <Lede className="mt-5">
              Each niche has posting windows. When one opens, the pipeline
              produces, checks, and publishes without anyone at the
              keyboard. Your approval gate, if you set one, still applies.
            </Lede>
            <div className="mt-7 flex flex-wrap gap-2">
              {["Mon-Fri 9:00", "Daily 12:30", "Weekends 18:00"].map((w) => (
                <span
                  className="rounded-full border border-zinc-900/10 bg-white/80 px-3.5 py-1.5 font-mono text-xs font-medium text-zinc-600"
                  key={w}
                >
                  {w}
                </span>
              ))}
            </div>
            <ProofList
              className="mt-8"
              items={[
                "Windows are per niche, tuned to when that audience actually watches.",
                "Agents can add or move windows through any surface.",
                "Caps are checked before each run, so autopilot can't outspend you.",
              ]}
            />
          </Reveal>
          <Reveal delay={0.12}>
            <AutomationOrbitIllustration />
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Reliability                                                         */
/* ------------------------------------------------------------------ */

const JOB_ROWS = [
  {
    id: "vid_8c21",
    event: "animation step failed",
    action: "retrying 2/3",
    tone: "amber" as const,
  },
  {
    id: "art_2210",
    event: "worker lost mid-write",
    action: "reaped, requeued",
    tone: "sky" as const,
  },
  {
    id: "vid_8c22",
    event: "daily cap reached",
    action: "held, fails closed",
    tone: "zinc" as const,
  },
];

const TONE = {
  amber: "border-amber-600/15 bg-amber-50/80 text-amber-700",
  sky: "border-sky-600/15 bg-sky-50/80 text-sky-700",
  zinc: "border-zinc-900/10 bg-white/80 text-zinc-500",
};

export function ReliabilityBand() {
  return (
    <section aria-label="Reliability" className="px-4 pt-6 md:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal className="flex justify-center lg:order-1">
            <GlassPanel className="w-full max-w-sm p-5">
              <p className="text-[13px] font-semibold text-zinc-900">
                Queue health
              </p>
              <ul className="mt-4 space-y-2">
                {JOB_ROWS.map((row) => (
                  <li
                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3.5 py-3"
                    key={row.id}
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-[12px] text-zinc-800">
                        {row.id}
                      </p>
                      <p className="text-[11px] text-zinc-400">{row.event}</p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${TONE[row.tone]}`}
                    >
                      {row.action}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </Reveal>
          <Reveal className="lg:order-2" delay={0.12}>
            <Kicker>Reliability</Kicker>
            <DisplayHeading className="mt-4">
              Retry and reaping keep the queue honest.
            </DisplayHeading>
            <Lede className="mt-5">
              Failed steps retry. Jobs orphaned by a dead worker get reaped
              and requeued. And when a spend cap trips, the job fails
              closed instead of quietly burning money.
            </Lede>
            <Lede className="mt-4">
              The result: a queue you can leave alone, because it never
              needs a human to unstick it.
            </Lede>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
