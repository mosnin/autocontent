"use client";

import * as React from "react";

import { PinScene } from "@/components/marketing/system";
import {
  Chip,
  MediaSlot,
  SectionHead,
  Stage,
} from "@/components/site/sections";
import { cn } from "@/lib/utils";

/**
 * The real production line, stage by stage. `macro` maps each stage to the
 * pipeline illustration's coarse phases (0 Ideate · 1 Script · 2 Render ·
 * 3 Publish) so the drawing lights up as the rail advances.
 */
const STAGES: Array<{
  label: string;
  copy: string;
  tag?: string;
  macro: number;
}> = [
  {
    label: "Ideation",
    copy: "Angles picked for your niche, steered by what the last round earned.",
    tag: "metrics-fed",
    macro: 0,
  },
  {
    label: "Script",
    copy: "Written scene by scene: hook, shots, lines, and timing.",
    macro: 1,
  },
  {
    label: "Keyframes",
    copy: "gpt-image-1 frames, kept on-model by the niche's character sheet.",
    tag: "gpt-image-1",
    macro: 2,
  },
  {
    label: "Animation",
    copy: "Keyframes become motion, one scene at a time.",
    macro: 2,
  },
  {
    label: "Voiceover",
    copy: "TTS with steerable delivery. Pace, tone, and emphasis to order.",
    macro: 2,
  },
  {
    label: "Music",
    copy: "A bed ducked under the voice. Never over it.",
    macro: 2,
  },
  {
    label: "Edit",
    copy: "ffmpeg assembles scenes, voice, and music into the cut.",
    tag: "ffmpeg",
    macro: 2,
  },
  {
    label: "Captions",
    copy: "Word-level karaoke captions, timed to the voice.",
    macro: 2,
  },
  {
    label: "QA",
    copy: "Every cut is checked before it can publish.",
    macro: 3,
  },
  {
    label: "Publish",
    copy: "Scheduled to TikTok, Reels, and Shorts in your niche's windows.",
    macro: 3,
  },
];

function Header() {
  return (
    <SectionHead
      eyebrow="The production line"
      heading="Ten stages. Zero hand-offs."
      highlight="Zero hand-offs."
      lede="What an editor, a voice actor, and a social manager would do in a week, run as one pipeline."
    />
  );
}

function Rail({ active }: { active: number }) {
  return (
    <ol className="os-stagelist">
      {STAGES.map((s, i) => {
        const on = i === active;
        return (
          <li className={cn("os-stagerow", on && "os-stagerow--on")} key={s.label}>
            <span className="os-num">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <p className="os-stagerow__label">{s.label}</p>
              <p className={cn("os-stagerow__copy", on && "os-stagerow__copy--on")}>
                {s.copy}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Scene({ stage }: { stage: number }) {
  return (
    <div className="os-inset">
      <Header />
      <div className="os-walk os-mt-40">
        <Rail active={stage} />
        <Stage>
          <MediaSlot
            className="os-aspect-43"
            kind="illustration"
            label="Scene-by-scene pipeline"
          />
        </Stage>
      </div>
    </div>
  );
}

/** Static fallback: the numbered rail as a staggered two-column grid. */
function StaticWalkthrough() {
  return (
    <div className="os-inset">
      <Header />
      <div className="os-stagegrid os-mt-48">
        {STAGES.map((s, i) => (
          <div className="os-stagecell" key={s.label}>
            <span className="os-num">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div className="os-stagecell__head">
                <p className="os-title os-title--sm">{s.label}</p>
                {s.tag ? <Chip>{s.tag}</Chip> : null}
              </div>
              <p className="os-body os-mt-8">{s.copy}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Pins the walkthrough and drives the stage rail from the scrub position.
 * The pin/scrub is GSAP-owned (the only pinned scene on the features
 * pages); the active stage lives in React state so `Rail`/`Scene` keep
 * their plain prop-driven rendering.
 */
function PinnedWalkthrough() {
  const [stage, setStage] = React.useState(0);
  const stageRef = React.useRef(0);

  return (
    <PinScene
      build={(_el, tl) => {
        const proxy = { value: 0 };
        tl.to(proxy, {
          value: STAGES.length - 1,
          ease: "none",
          onUpdate: () => {
            const next = Math.round(proxy.value);
            if (next !== stageRef.current) {
              stageRef.current = next;
              setStage(next);
            }
          },
        });
      }}
      lengthVh={150}
    >
      <Scene stage={stage} />
    </PinScene>
  );
}

/**
 * The stage walkthrough. On large screens it pins and scroll advances the
 * ten-stage rail while the pipeline diagram tracks along. Small screens and
 * reduced motion get the static numbered rail.
 */
export function VideoWalkthrough() {
  return (
    <section aria-label="The ten video stages" className="os-section">
      <div className="os-section__inner">
        <div className="os-walkthrough-lg">
          <PinnedWalkthrough />
        </div>
        <div className="os-walkthrough-sm">
          <StaticWalkthrough />
        </div>
      </div>
    </section>
  );
}
