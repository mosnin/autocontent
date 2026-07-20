import * as React from "react";

import {
  GlassPanel,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  Stagger,
  StatStrip,
  TextReveal,
  VignetteCard,
  warmChip,
  type VignetteScene,
} from "@/components/marketing/system";
import {
  ApprovalVignette,
  QueueVignette,
} from "@/components/marketing/vignettes";
import { cn } from "@/lib/utils";

import { ProofList } from "./proof-list";
import { VignetteStage } from "./vignette-stage";

/* ------------------------------------------------------------------ */
/* Queue moment                                                        */
/* ------------------------------------------------------------------ */

export function QueueMoment() {
  return (
    <section aria-label="The publish queue" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="pearl"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>The queue</Kicker>
            <TextReveal
              as="h2"
              className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
            >
              Renders, schedules, publishes. On its own.
            </TextReveal>
            <Lede className="mt-5">
              Every video moves through the queue with a status you can read
              at a glance. Rendering now, scheduled for the next window,
              published and reporting back.
            </Lede>
            <ProofList
              className="mt-8"
              items={[
                "Posting windows are set per niche, so posts land when your audience is watching.",
                "Publishing to TikTok, Reels, and Shorts happens from one queue, not three tabs.",
                "Engagement metrics flow back in and steer the next ideation round.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center" delay={0.12}>
            <VignetteStage scene="sky">
              <QueueVignette />
            </VignetteStage>
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Character consistency                                               */
/* ------------------------------------------------------------------ */

const TRAITS = ["mid-30s barista", "denim apron", "warm, direct", "counter framing"];

const SCENE_TILES = [
  {
    id: "char-scene-dawn",
    label: "Scene 1 · dawn",
    sky: ["#fecdd3", "#fef3c7"],
    glow: { cx: 22, cy: 38, r: 12, fill: "#fb923c", opacity: 0.4 },
  },
  {
    id: "char-scene-day",
    label: "Scene 4 · day",
    sky: ["#bfdbfe", "#e0f2fe"],
    glow: { cx: 62, cy: 12, r: 9, fill: "#fef08a", opacity: 0.8 },
  },
  {
    id: "char-scene-dusk",
    label: "Scene 7 · dusk",
    sky: ["#c7d2fe", "#fbcfe8"],
    glow: { cx: 58, cy: 40, r: 13, fill: "#f472b6", opacity: 0.35 },
  },
] as const;

/** The same presenter silhouette in every tile; that sameness is the point. */
function CharacterSilhouette() {
  return (
    <g fill="#3f3f46" fillOpacity="0.8">
      <circle cx="40" cy="24" r="7.5" />
      <path d="M26 52 C26 40.5 32 35.5 40 35.5 C48 35.5 54 40.5 54 52 Z" />
    </g>
  );
}

function SceneTile({ tile }: { tile: (typeof SCENE_TILES)[number] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-900/[0.06] bg-white">
      <svg aria-hidden className="block h-auto w-full" viewBox="0 0 80 52">
        <defs>
          <linearGradient id={tile.id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={tile.sky[0]} />
            <stop offset="1" stopColor={tile.sky[1]} />
          </linearGradient>
        </defs>
        <rect fill={`url(#${tile.id})`} height="52" width="80" />
        {/* Scene light: sun low at dawn, high at midday, warm at dusk */}
        <circle
          cx={tile.glow.cx}
          cy={tile.glow.cy}
          fill={tile.glow.fill}
          opacity={tile.glow.opacity}
          r={tile.glow.r}
        />
        {/* Counter line, same framing every scene */}
        <rect fill="#ffffff" height="8" opacity="0.35" width="80" y="44" />
        <CharacterSilhouette />
      </svg>
      <p className="py-1.5 text-center text-[10px] font-medium text-zinc-400">
        {tile.label}
      </p>
    </div>
  );
}

function CharacterSheetCard() {
  return (
    <GlassPanel className="w-full max-w-sm p-5">
      <div className="flex items-center justify-between border-b border-zinc-900/[0.06] pb-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-rose-100 ring-1 ring-white/80"
          >
            <span className="size-2 rounded-full bg-zinc-900/70" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-zinc-900">
              Character sheet
            </p>
            <p className="text-[11px] text-zinc-400">home-espresso · v3</p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium",
            warmChip,
          )}
        >
          locked
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {TRAITS.map((t) => (
          <span
            className="rounded-full bg-zinc-900/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-500"
            key={t}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {SCENE_TILES.map((tile) => (
          <SceneTile key={tile.id} tile={tile} />
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] text-zinc-400">
        same face, every keyframe, every video
      </p>
    </GlassPanel>
  );
}

export function CharacterBand() {
  return (
    <section aria-label="Character consistency" className="px-4 pt-6 md:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal className="flex justify-center lg:order-1">
            <CharacterSheetCard />
          </Reveal>
          <Reveal className="lg:order-2" delay={0.12}>
            <Kicker>On-model, every frame</Kicker>
            <TextReveal
              as="h2"
              className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
            >
              The same face in video one and video forty.
            </TextReveal>
            <Lede className="mt-5">
              Each niche gets a character sheet: who fronts the videos, how
              they look, how they hold the frame. Every gpt-image-1 keyframe
              is generated against it.
            </Lede>
            <Lede className="mt-4">
              So your channel reads like a channel, one presenter your
              audience recognizes, not a new stranger every post.
            </Lede>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Approval gate                                                       */
/* ------------------------------------------------------------------ */

export function ApprovalGateBand() {
  return (
    <section aria-label="Approval gate" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="sky"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>The approval gate</Kicker>
            <TextReveal
              as="h2"
              className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
            >
              Nothing posts without your rules.
            </TextReveal>
            <Lede className="mt-5">
              The gate is optional, the control is not. Hold every video for
              review, or let the pipeline run full-auto inside the rules you
              set. Either way, QA runs before publish.
            </Lede>
            <ProofList
              className="mt-8"
              items={[
                "Approval on: finished cuts wait in the queue until you say so.",
                "Approval off: QA still gates every cut before it can go out.",
                "Change your mind per niche, any time. The queue adjusts.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center" delay={0.12}>
            <VignetteStage scene="dawn">
              <ApprovalVignette />
            </VignetteStage>
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Platforms                                                           */
/* ------------------------------------------------------------------ */

const PLATFORMS: Array<{
  name: string;
  note: string;
  scene: VignetteScene;
  wash: string;
  caption: [string, string, string];
  time: string;
}> = [
  {
    name: "TikTok",
    note: "Native 9:16 export, karaoke captions burned in for sound-off scrolls.",
    scene: "mist",
    wash: "bg-[linear-gradient(160deg,#c7d2fe,#fbcfe8)]",
    caption: ["dial in", "your", "shot"],
    time: "0:38",
  },
  {
    name: "Instagram Reels",
    note: "Same cut, Reels-ready. Scheduled into the windows your niche sets.",
    scene: "dawn",
    wash: "bg-[linear-gradient(160deg,#fbcfe8,#fde68a)]",
    caption: ["steam", "silky", "milk"],
    time: "0:42",
  },
  {
    name: "YouTube Shorts",
    note: "Published alongside the rest, with per-post metrics flowing back.",
    scene: "sky",
    wash: "bg-[linear-gradient(160deg,#bae6fd,#c7d2fe)]",
    caption: ["grind", "finer", "today"],
    time: "0:36",
  },
];

/**
 * Tiny 9:16 short in a phone-shaped frame: gradient still, word-level
 * karaoke captions (current word carries the warm highlight), and the
 * playhead. Product miniature, not decoration.
 */
function ShortThumb({ platform }: { platform: (typeof PLATFORMS)[number] }) {
  const [before, current, after] = platform.caption;
  return (
    <div
      className={cn(
        "relative mx-auto flex aspect-[9/16] w-[30%] min-w-[3rem] max-w-[6.5rem] flex-col justify-end overflow-hidden rounded-2xl shadow-[0_14px_36px_rgba(15,23,42,0.16)] ring-1 ring-inset ring-zinc-900/[0.08]",
        platform.wash,
      )}
    >
      <span className="absolute right-2 top-2 rounded-full bg-zinc-900/45 px-1.5 py-0.5 font-mono text-[8px] font-medium text-white/90">
        {platform.time}
      </span>
      <div className="px-1.5 pb-2 text-center">
        <p className="text-[9px] font-semibold leading-tight text-white drop-shadow-[0_1px_2px_rgba(15,23,42,0.45)]">
          {before}{" "}
          <span className="rounded-[3px] bg-amber-500/95 px-0.5 text-white">
            {current}
          </span>{" "}
          {after}
        </p>
        <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-white/30">
          <div className="h-full w-3/5 rounded-full bg-white/90" />
        </div>
      </div>
    </div>
  );
}

export function PlatformRow() {
  return (
    <section
      aria-label="Publishing platforms"
      className="mx-auto max-w-6xl px-6 py-24 md:py-32"
    >
      <Reveal className="max-w-2xl">
        <Kicker>Distribution</Kicker>
        <TextReveal
          as="h2"
          className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
        >
          Posted where short-form lives.
        </TextReveal>
        <Lede className="mt-5">
          One render, three destinations. Posting windows are set per niche,
          mornings for coffee, evenings for gaming, and the queue hits them
          without you.
        </Lede>
      </Reveal>
      <Stagger className="mt-12 grid gap-6 md:grid-cols-3" gap={0.08}>
        {PLATFORMS.map((p) => (
          <VignetteCard
            description={p.note}
            key={p.name}
            scene={p.scene}
            title={p.name}
            vignette={<ShortThumb platform={p} />}
          />
        ))}
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function VideoStats() {
  return (
    <section
      aria-label="Video by the numbers"
      className="mx-auto max-w-6xl px-6 pb-24 md:pb-28"
    >
      <StatStrip
        stats={[
          { value: 10, label: "stages from brief to post" },
          {
            value: 0.5,
            prefix: "$",
            decimals: 2,
            label: "typical cost of a finished short",
          },
          { value: 3, label: "platforms from one render" },
        ]}
      />
    </section>
  );
}
