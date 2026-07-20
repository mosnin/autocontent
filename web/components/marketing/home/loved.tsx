import * as React from "react";

import { Reveal, Stagger } from "@/components/marketing/system";
import { MediaSlot } from "@/components/media-slot";

/** Testimonial rail — portrait video cards like the reference. Quotes and
 *  portraits are placeholders until real customer stories are uploaded. */
const CARDS = [
  {
    quote: "The overnight queue is the closest thing to hiring I've done without hiring.",
    who: "Creator, fitness niche",
    slotId: "mk-testimonial-1",
  },
  {
    quote: "We cap every client at their retainer and never think about overruns again.",
    who: "Agency founder",
    slotId: "mk-testimonial-2",
  },
  {
    quote: "Our agent files the brief on Monday and the channel is full by Friday.",
    who: "SaaS marketing lead",
    slotId: "mk-testimonial-3",
  },
  {
    quote: "Articles that used to take a week of freelancer wrangling ship in an afternoon.",
    who: "Ecommerce owner",
    slotId: "mk-testimonial-4",
  },
];

export function Loved() {
  return (
    <section aria-label="Testimonials" className="bg-[#f5f6f8] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <h2 className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
            Loved by teams that ship daily.
          </h2>
          <div className="mt-6 flex items-center gap-2">
            {[1, 2, 3].map((n) => (
              <span
                className="flex h-10 w-20 items-center justify-center rounded-lg border border-dashed border-zinc-900/10 bg-white font-mono text-[10px] text-zinc-300"
                key={n}
              >
                award-{n}
              </span>
            ))}
          </div>
        </Reveal>

        <Stagger className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map((c) => (
            <figure
              className="flex flex-col overflow-hidden rounded-3xl border border-zinc-900/[0.06] bg-white shadow-[0_8px_32px_rgba(15,23,42,0.06)]"
              key={c.slotId}
            >
              <div className="group aspect-[4/5]">
                <MediaSlot
                  alt={`Customer portrait video — ${c.who}`}
                  id={c.slotId}
                  showChip={false}
                />
              </div>
              <div className="flex flex-1 flex-col p-5">
                <blockquote className="text-[14.5px] leading-relaxed text-zinc-800">
                  &ldquo;{c.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-3 text-[12.5px] font-medium text-zinc-500">
                  {c.who}
                </figcaption>
              </div>
            </figure>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
