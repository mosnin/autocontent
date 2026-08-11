import * as React from "react";

import { Marquee, TaggedPlaceholder } from "@/components/marketing/system";

/**
 * Trusted-by strip under the hero. Real customer logos land later —
 * each slot is a tagged placeholder drifting in a slow marquee until
 * the assets are uploaded (upload: web/public/logo/customers/logo-1.svg …).
 */
export function LogoBand() {
  return (
    <section aria-label="Trusted by" className="border-y border-zinc-900/[0.05] bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-6 py-10 md:flex-row md:justify-between">
        <p className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
          Trusted by teams shipping daily
        </p>
        <div
          className="w-full md:max-w-xl"
          style={{
            maskImage:
              "linear-gradient(90deg,transparent,black 8%,black 92%,transparent)",
          }}
        >
          <Marquee ariaLabel="Customer logos" itemClassName="gap-3 pr-3" seconds={30}>
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <span
                className="mr-3 block h-9 w-28 shrink-0 overflow-hidden rounded-lg"
                key={n}
              >
                <TaggedPlaceholder
                  kind="image"
                  label="Customer logo"
                  tone="slate"
                />
              </span>
            ))}
          </Marquee>
        </div>
      </div>
    </section>
  );
}
