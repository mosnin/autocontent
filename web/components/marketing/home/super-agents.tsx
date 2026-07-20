import * as React from "react";
import Link from "next/link";

import { Reveal } from "@/components/marketing/system";
import { MediaSlot } from "@/components/media-slot";

/** The big "new era" band: display headline, one CTA, one hero photo. */
export function SuperAgents() {
  return (
    <section aria-label="Agents" className="bg-white py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight text-zinc-950 md:text-6xl">
            A new era of marketing,
            <br />
            with agents on staff.
          </h2>
          <div className="mt-8">
            <Link
              className="inline-flex min-h-12 items-center rounded-xl bg-zinc-900 px-7 text-[15px] font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
              href="/features/automation"
            >
              Put an agent to work
            </Link>
          </div>
        </Reveal>

        <Reveal className="mt-16" delay={0.1}>
          <div className="group relative aspect-[21/10] overflow-hidden rounded-[2rem] shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
            <MediaSlot id="mk-agents" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
