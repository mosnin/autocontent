"use client";

import * as React from "react";
import Link from "next/link";

import { AgentGridIllustration } from "@/components/marketing/illustrations";
import { Reveal, Stagger } from "@/components/marketing/system";
import {
  MCPVignette,
  TerminalVignette,
} from "@/components/marketing/vignettes";

const SURFACES = ["API", "SDK", "CLI", "MCP"];

/**
 * The one dark moment on the page: marketer.sh as a tool your agents call.
 */
export function AgentsBand() {
  return (
    <section aria-label="Built for agents" className="px-4 py-6 md:px-6">
      <div className="mx-auto max-w-[88rem] overflow-hidden rounded-[2.5rem] bg-zinc-950">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <div>
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                Built for agents
              </p>
              <h2 className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-white md:text-5xl">
                Your agents ship the campaign.
              </h2>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-zinc-400">
                And you don&apos;t even have to be the one asking. Point an
                agent at the API, the TypeScript SDK, the CLI, or the MCP
                server and it can brief, approve, and publish for you, inside
                the caps you set.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {SURFACES.map((s) => (
                  <span
                    className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 font-mono text-xs font-medium text-zinc-300"
                    key={s}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </Reveal>

            <Stagger className="mt-10 space-y-3" gap={0.1}>
              {/* The CLI at work */}
              <TerminalVignette className="mx-0 max-w-none border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.35)]" />
              {/* The MCP surface */}
              <MCPVignette className="mx-0 max-w-none" />
            </Stagger>

            <Reveal delay={0.2}>
              <Link
                className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-white transition-colors hover:text-zinc-300"
                href="/features/automation"
              >
                Explore automation & agents
                <svg
                  aria-hidden
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </Link>
            </Reveal>
          </div>

          <Reveal delay={0.1}>
            <AgentGridIllustration tone="dark" />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
