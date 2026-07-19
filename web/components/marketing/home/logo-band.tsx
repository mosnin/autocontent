import * as React from "react";

/**
 * Trusted-by strip under the hero. Real customer logos land later —
 * each slot is a labeled placeholder box until the assets are uploaded
 * (upload: web/public/logo/customers/logo-1.svg … logo-6.svg).
 */
export function LogoBand() {
  return (
    <section aria-label="Trusted by" className="border-y border-zinc-900/[0.05] bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-6 py-10 md:flex-row md:justify-between">
        <p className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
          Trusted by teams shipping daily
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <span
              className="flex h-9 w-24 items-center justify-center rounded-lg border border-dashed border-zinc-900/10 bg-zinc-50 font-mono text-[10px] text-zinc-300"
              key={n}
            >
              logo-{n}.svg
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
