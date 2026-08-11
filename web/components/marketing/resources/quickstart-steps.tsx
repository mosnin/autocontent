import * as React from "react";

import { Body, MediaSlot, Stage, Title } from "@/components/site/sections";

const STEPS: Array<{
  title: string;
  copy: string;
  shot: string;
}> = [
  {
    title: "Sign up",
    copy: "Create an account with your email. There is nothing to install and no card required, your workspace is live in under a minute.",
    shot: "Sign-up screen",
  },
  {
    title: "Describe your channel in one sentence",
    copy: "Write one honest sentence about who you talk to and what you make. The AI drafts the full niche from it: audience, tone, topic pillars, and a starting posting plan.",
    shot: "Niche brief form",
  },
  {
    title: "Review voice, style, and caps",
    copy: "Everything the draft chose is editable. Pick the narration voice, set the visual style, and put a hard daily cap on spend before anything renders.",
    shot: "Voice, style, and cap review",
  },
  {
    title: "Your first video renders. Approve it",
    copy: "The pipeline runs end to end: script, on-model keyframes, animation, voiceover, captions, QA. You watch the result and approve or reject with one click.",
    shot: "First-video approval",
  },
  {
    title: "Add articles",
    copy: "Turn on the SEO pipeline for the same niche. It researches the SERP, outlines, writes sections in parallel, then ships metadata, JSON-LD, and a hero image with every draft.",
    shot: "Article pipeline toggle",
  },
  {
    title: "Set posting windows and let it run",
    copy: "Choose when each platform posts and how many per day. From here the system ideates, produces, publishes, and learns from performance, inside the caps you set.",
    shot: "Posting windows",
  },
];

/**
 * The quickstart's numbered rail: a vertical hairline with a node per step,
 * step copy on the left and a staged screenshot slot on the right.
 */
export function QuickstartSteps() {
  return (
    <ol className="os-quicksteps">
      {STEPS.map((step, i) => (
        <li className="os-rail" key={step.title}>
          <span aria-hidden className="os-rail__node" />
          <div className="os-quickstep">
            <div>
              <span className="os-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Title className="os-mt-12" level={2}>
                {step.title}
              </Title>
              <Body className="os-mt-16 os-measure">{step.copy}</Body>
            </div>
            <Stage>
              <MediaSlot
                className="os-aspect-43"
                kind="image"
                label={`${step.shot} — screenshot`}
              />
            </Stage>
          </div>
        </li>
      ))}
    </ol>
  );
}
