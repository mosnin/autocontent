"use client";

import { Power } from "@/components/marketing/power";
import { Reveal } from "@/components/marketing/reveal";
import { LoopCircuit } from "@/components/marketing/pipeline-circuit";

const PHASES = [
  {
    n: "01",
    title: "Research & angles",
    body: "Ideation reads the last 30 days of your channel (which hooks earned views, which flopped) and aims the next idea at proven ground plus one adjacent bet.",
  },
  {
    n: "02",
    title: "Staging & storyboard",
    body: "A scriptwriter drafts scene-by-scene narration; a visual director attaches image and motion prompts; your character sheet keeps every frame on-model. Review and refine your storyboard, scene by scene, with per-scene reroll and full revoice.",
  },
  {
    n: "03",
    title: "The assembly line",
    body: "Keyframes render, motion animates, the voice tracks over word-level captions, music beds in, ffmpeg mixes the master, every stage spend-checked and resumable.",
  },
  {
    n: "04",
    title: "Closed-loop optimization",
    body: "Posts go out on schedule. Analytics come back daily. Performance attribution scores every video, and the scores steer tomorrow's ideation. No intuition required.",
  },
];

export function LoopSection() {
  return (
    <section className="border-y border-border/60 bg-card/20" id="how-it-works">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-16 px-6 py-24 lg:grid-cols-[1fr_auto]">
        <div>
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
              How it works
            </p>
            <h2 className="mt-3 max-w-lg text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Four phases. Zero hand-offs. One loop that{" "}
              <Power>never stops learning</Power>.
            </h2>
          </Reveal>

          <div className="mt-12 space-y-10">
            {PHASES.map((p) => (
              <Reveal key={p.n}>
                <div className="grid grid-cols-[auto_1fr] gap-5">
                  <span className="font-mono text-sm tabular-nums text-brand">
                    {p.n}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold">{p.title}</h3>
                    <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
                      {p.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="hidden lg:block">
          <LoopCircuit />
          <p className="mt-3 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Make → ship → measure → learn
          </p>
        </div>
      </div>
    </section>
  );
}
