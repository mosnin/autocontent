import * as React from "react";

import {
  Chip,
  MediaCard,
  Section,
  SectionHead,
} from "@/components/site/sections";

/**
 * The real production line, stage by stage.
 *
 * This used to pin and scrub through the ten stages with GSAP. The pin left
 * a viewport-and-a-half of empty page behind the fixed scene and depended on
 * a scroll library to show its own content; on the transcribed ground the
 * calm numbered rail reads better and renders without JavaScript, so the
 * stage list is now plain markup.
 */
const STAGES: Array<{ label: string; copy: string; tag?: string }> = [
  {
    label: "Ideation",
    copy: "Angles picked for your niche, steered by what the last round earned.",
    tag: "metrics-fed",
  },
  {
    label: "Script",
    copy: "Written scene by scene: hook, shots, lines, and timing.",
  },
  {
    label: "Keyframes",
    copy: "gpt-image-1 frames, kept on-model by the niche's character sheet.",
    tag: "gpt-image-1",
  },
  {
    label: "Animation",
    copy: "Keyframes become motion, one scene at a time.",
  },
  {
    label: "Voiceover",
    copy: "TTS with steerable delivery. Pace, tone, and emphasis to order.",
  },
  {
    label: "Music",
    copy: "A bed ducked under the voice. Never over it.",
  },
  {
    label: "Edit",
    copy: "ffmpeg assembles scenes, voice, and music into the cut.",
    tag: "ffmpeg",
  },
  {
    label: "Captions",
    copy: "Word-level karaoke captions, timed to the voice.",
  },
  {
    label: "QA",
    copy: "Every cut is checked before it can publish.",
  },
  {
    label: "Publish",
    copy: "Scheduled to TikTok, Reels, and Shorts in your niche's windows.",
  },
];

export function VideoWalkthrough() {
  return (
    <Section label="The ten video stages">
      <div className="os-split">
        <SectionHead
          eyebrow="The production line"
          heading="Ten stages. Zero hand-offs."
          highlight="Zero hand-offs."
          lede="What an editor, a voice actor, and a social manager would do in a week, run as one pipeline."
        />
        <MediaCard kind="illustration" label="Scene-by-scene pipeline" />
      </div>
      <ol className="os-stagegrid os-mt-48">
        {STAGES.map((s, i) => (
          <li className="os-stagecell" key={s.label}>
            <span className="os-num">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div className="os-stagecell__head">
                <p className="os-title os-title--sm">{s.label}</p>
                {s.tag ? <Chip>{s.tag}</Chip> : null}
              </div>
              <p className="os-body os-mt-8">{s.copy}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
