import type { Metadata } from "next";

import { CodeTabs } from "@/components/marketing/resources/code-tabs";
import { PageHero } from "@/components/marketing/resources/page-hero";
import {
  DisplayHeading,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  SectionCta,
  Stagger,
} from "@/components/marketing/system";

const DESCRIPTION =
  "One platform, four surfaces: the marketer.sh REST API, Python SDK, CLI, and MCP server. Authenticate with personal access tokens and let agents enqueue real work.";

export const metadata: Metadata = {
  title: "API, SDK, CLI & MCP — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "API, SDK, CLI & MCP — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/resources/api" },
};

const PAT_POINTS = [
  {
    title: "Created in Settings",
    copy: "Generate tokens from Settings → Access tokens. Each starts with mkt_ and is shown exactly once, so store it in a secret manager, not a repo.",
  },
  {
    title: "Hashed at rest",
    copy: "We store a hash, never the token. If a token leaks, revoke it in one click; every surface using it stops working immediately.",
  },
  {
    title: "Bounded by your caps",
    copy: "A token can never outspend you. Every call it makes runs through the same per-niche and global daily caps as the dashboard, and fails closed at the limit.",
  },
];

export default function ApiPage() {
  return (
    <main>
      <PageHero
        headline="One platform. Four surfaces."
        kicker="Developers"
        sub="Everything the dashboard does is callable: REST for anything, a Python SDK for scripts, a CLI for the terminal, and an MCP server for agents."
      />

      {/* Surfaces */}
      <section
        aria-label="Developer surfaces"
        className="mx-auto max-w-6xl px-6 py-24 md:py-32"
      >
        <Reveal className="max-w-2xl">
          <Kicker>Pick a surface</Kicker>
          <DisplayHeading className="mt-4">
            The same platform, however you call it.
          </DisplayHeading>
          <Lede className="mt-5">
            All four surfaces share one API, one token format, and one set of
            spend rules. Start where you are comfortable and switch anytime.
          </Lede>
        </Reveal>
        <Reveal className="mt-12" delay={0.1}>
          <CodeTabs />
        </Reveal>
      </section>

      {/* PAT auth */}
      <section aria-label="Authentication" className="px-4 py-6 md:px-6">
        <GradientScene
          className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
          variant="pearl"
        >
          <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
            <Reveal className="max-w-2xl">
              <Kicker>Authentication</Kicker>
              <DisplayHeading className="mt-4">
                Tokens you can hand to an agent.
              </DisplayHeading>
              <Lede className="mt-5">
                Personal access tokens authenticate every surface. They are
                designed to be given away, to a script, a CI job, or an
                autonomous agent, without giving away your account.
              </Lede>
            </Reveal>
            <Stagger
              className="mt-14 grid gap-4 md:grid-cols-3"
              gap={0.08}
              itemClassName="h-full"
            >
              {PAT_POINTS.map((point) => (
                <div
                  className="h-full rounded-[1.5rem] border border-white/60 bg-white/70 p-7 shadow-[0_8px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl"
                  key={point.title}
                >
                  <h3 className="font-display text-lg font-semibold tracking-tight text-zinc-900">
                    {point.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
                    {point.copy}
                  </p>
                </div>
              ))}
            </Stagger>
            <Reveal className="mt-8" delay={0.15}>
              <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                <code className="rounded-md border border-zinc-900/[0.08] bg-white px-2 py-1 font-mono text-[12px] text-zinc-700">
                  Authorization: Bearer mkt_…
                </code>
                works identically on the API, SDK, CLI, and MCP server.
              </p>
            </Reveal>
          </div>
        </GradientScene>
      </section>

      <SectionCta
        headline="Point an agent at it today."
        kicker="Build"
        primaryHref="/sign-up"
        primaryLabel="Create a token"
        secondaryHref="/resources/guides/agent-driven-marketing"
        secondaryLabel="Agent setup guide"
        sub="Sign up, mint a token in Settings, and your agent can enqueue its first article in the next five minutes."
      />
    </main>
  );
}
