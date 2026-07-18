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
  VignetteCard,
} from "@/components/marketing/system";
import {
  MCPVignette,
  TerminalVignette,
} from "@/components/marketing/vignettes";

import { ProofList } from "./proof-list";

/* ------------------------------------------------------------------ */
/* Surface cards: API / SDK / CLI / MCP                                */
/* ------------------------------------------------------------------ */

/**
 * Dark code miniature for the REST and SDK cards, in the
 * `TerminalVignette` frame language: traffic dots, mono 11px, staged
 * inside the card's vignette wash.
 */
function CodeVignette({
  meta,
  children,
}: {
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[380px] rounded-2xl border border-white/10 bg-zinc-900 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.35)]">
      <div className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-white/15" />
        <span className="size-2 rounded-full bg-white/15" />
        <span className="size-2 rounded-full bg-white/15" />
        <span className="ml-auto font-mono text-[10px] text-zinc-500">
          {meta}
        </span>
      </div>
      <div className="mt-3 space-y-1.5 font-mono text-[11px] leading-relaxed">
        {children}
      </div>
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
          Agents can create channels, enqueue videos, generate articles, and
          check spend, from whichever surface fits the stack.
        </Lede>
      </Reveal>

      <Stagger className="mt-12 grid gap-6 md:grid-cols-2" gap={0.08}>
        <VignetteCard
          description="Every pipeline behind plain endpoints. Enqueue a video, poll a job, read the ledger."
          kicker="REST"
          scene="sky"
          title="API"
          vignette={
            <CodeVignette meta="HTTP">
              <p className="text-zinc-100">
                <span className="text-sky-300">POST</span>{" "}
                /v1/niches/home-espresso/videos
              </p>
              <p className="text-zinc-400">
                202 Accepted · job{" "}
                <span className="text-zinc-200">vid_8c21</span> queued
              </p>
            </CodeVignette>
          }
        />

        <VignetteCard
          description="Typed end to end. Your editor knows the request shapes before the docs do."
          kicker="Python"
          scene="pearl"
          title="SDK"
          vignette={
            <CodeVignette meta="agent.py">
              <p className="text-zinc-100">
                <span className="text-violet-300">from</span> marketer{" "}
                <span className="text-violet-300">import</span> Marketer
              </p>
              <p className="text-zinc-100">
                client.videos.enqueue(niche=
                <span className="text-amber-300">&quot;home-espresso&quot;</span>)
              </p>
            </CodeVignette>
          }
        />

        <VignetteCard
          description="The whole platform from a shell. Scriptable, cron-able, agent-runnable."
          kicker="CLI"
          scene="dusk"
          title="marketer"
          vignette={<TerminalVignette />}
        />

        <VignetteCard
          description="Tool descriptions carry cost estimates, so an agent knows the price before it calls."
          kicker="MCP"
          scene="mist"
          title="MCP server"
          vignette={<MCPVignette />}
        />
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
              Each channel has posting windows. When one opens, the pipeline
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
                "Windows are per channel, tuned to when that audience actually watches.",
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
