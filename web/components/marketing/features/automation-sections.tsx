import * as React from "react";

import {
  Band,
  CardGrid,
  Chip,
  MediaCard,
  Section,
  SectionHead,
} from "@/components/site/sections";
import { VignetteCard } from "@/components/marketing/system";

import { StageMedia } from "./stage-media";

/* ------------------------------------------------------------------ */
/* Surface cards: API / SDK / CLI / MCP                                */
/* ------------------------------------------------------------------ */

const SURFACES = [
  {
    kicker: "REST",
    title: "API",
    description:
      "Every pipeline behind plain endpoints. Enqueue a video, poll a job, read the ledger.",
    scene: "sky" as const,
    label: "REST call — enqueue endpoint request and response",
  },
  {
    kicker: "Python",
    title: "SDK",
    description:
      "Typed end to end. Your editor knows the request shapes before the docs do.",
    scene: "pearl" as const,
    label: "Python SDK snippet — enqueue a video",
  },
  {
    kicker: "CLI",
    title: "marketer",
    description:
      "The whole platform from a shell. Scriptable, cron-able, agent-runnable.",
    scene: "dusk" as const,
    label: "CLI session — marketer command output",
  },
  {
    kicker: "MCP",
    title: "MCP server",
    description:
      "Tool descriptions carry cost estimates, so an agent knows the price before it calls.",
    scene: "mist" as const,
    label: "MCP tool call — cost-aware tool description",
  },
];

export function SurfaceCards() {
  return (
    <Section label="Agent surfaces">
      <div className="os-split">
        <SectionHead
          eyebrow="Four surfaces, one platform"
          heading="Create a niche. Enqueue a video. Check the spend."
          highlight="Check the spend."
          lede="The same three calls, from whichever surface fits the stack: REST, the Python SDK, the CLI, or MCP."
        />
        <MediaCard
          kind="illustration"
          label="Surface map — API, SDK, CLI, MCP"
        />
      </div>
      <CardGrid className="os-mt-48" cols={2}>
        {SURFACES.map((s) => (
          <VignetteCard
            description={s.description}
            key={s.title}
            kicker={s.kicker}
            scene={s.scene}
            title={s.title}
            vignette={<StageMedia kind="image" label={s.label} />}
          />
        ))}
      </CardGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Scheduled windows                                                   */
/* ------------------------------------------------------------------ */

export function WindowsBand() {
  return (
    <Band
      bullets={[
        "Windows are per niche, tuned to when that audience actually watches.",
        "Agents can add or move windows through any surface.",
        "Caps are checked before each run, so autopilot can't outspend you.",
      ]}
      eyebrow="Autopilot"
      heading="The schedule runs itself."
      highlight="runs itself"
      label="Scheduled windows"
      lede="Each niche has posting windows. When one opens, the pipeline produces, checks, and publishes without anyone at the keyboard. Your approval gate, if you set one, still applies."
      media={
        <MediaCard
          kind="illustration"
          label="Posting schedule — per-niche windows"
        />
      }
    >
      <div className="os-actions os-mt-8">
        {["Mon-Fri 9:00", "Daily 12:30", "Weekends 18:00"].map((w) => (
          <Chip key={w}>{w}</Chip>
        ))}
      </div>
    </Band>
  );
}

/* ------------------------------------------------------------------ */
/* Reliability                                                         */
/* ------------------------------------------------------------------ */

export function ReliabilityBand() {
  return (
    <Band
      eyebrow="Reliability"
      extraCopy="The result: a queue you can leave alone, because it never needs a human to unstick it."
      flip
      heading="Retry and reaping keep the queue honest."
      highlight="keep the queue honest"
      label="Reliability"
      lede="Failed steps retry. Jobs orphaned by a dead worker get reaped and requeued. And when a spend cap trips, the job fails closed instead of quietly burning money."
      media={
        <MediaCard
          kind="image"
          label="Queue health panel — retries and reaping status"
        />
      }
    />
  );
}
