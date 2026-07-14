import type { Metadata } from "next";
import * as React from "react";

import {
  GuideCallout,
  GuideCode,
  GuideLayout,
  GuideList,
  GuideP,
  GuideStrong,
  type GuideSection,
} from "@/components/marketing/resources/guide-layout";
import { GlassPanel, SectionCta } from "@/components/marketing/system";

const TITLE = "Hand your marketing to an agent, safely";
const DESCRIPTION =
  "Wire an AI agent to marketer.sh over MCP: personal access tokens, spend caps as guardrails, approval gates, and a sane path from supervised runs to real autonomy.";
const URL = "https://marketer.sh/resources/guides/agent-driven-marketing";

export const metadata: Metadata = {
  title: `${TITLE} — marketer.sh`,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
  alternates: { canonical: URL },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: TITLE,
  description: DESCRIPTION,
  url: URL,
  datePublished: "2026-06-12",
  dateModified: "2026-07-08",
  author: { "@type": "Organization", name: "marketer.sh", url: "https://marketer.sh" },
  publisher: { "@type": "Organization", name: "marketer.sh", url: "https://marketer.sh" },
};

/** A static transcript card: what a day of agent-driven marketing reads like. */
function SampleConversation() {
  const turns: Array<{ from: "you" | "agent"; text: string }> = [
    {
      from: "you",
      text: "Check the marketing budget, then queue whatever today needs.",
    },
    {
      from: "agent",
      text: "today_spend: $2.10 of the $10 cap used. The home-espresso niche has one video slot left today and no article since Friday.",
    },
    {
      from: "agent",
      text: "generate_article on “burr vs blade grinders” is estimated at $0.34, and enqueue_job for one video at about $0.55. Both fit the cap. Proceed?",
    },
    { from: "you", text: "Yes to both. Leave them in review." },
    {
      from: "agent",
      text: "Queued. Both jobs will wait in the approval queue; nothing publishes until you clear them.",
    },
  ];
  return (
    <GlassPanel className="mt-6 p-5 md:p-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
        A morning, transcribed
      </p>
      <div className="mt-4 space-y-3">
        {turns.map((turn, i) => (
          <div
            className={
              turn.from === "you"
                ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-[13px] leading-relaxed text-white"
                : "max-w-[85%] rounded-2xl rounded-bl-md border border-zinc-900/[0.06] bg-white px-4 py-2.5 text-[13px] leading-relaxed text-zinc-700"
            }
            key={i}
          >
            {turn.text}
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

const SECTIONS: GuideSection[] = [
  {
    id: "why-agents",
    heading: "Why give an agent the keys at all",
    body: (
      <>
        <GuideP>
          Marketing is the rare job an agent can own end to end, because the
          loop is closed: ideas become posts, posts produce numbers, numbers
          produce better ideas. What has been missing is not agent capability
          but <GuideStrong>a safe surface to act on</GuideStrong>: one where
          the worst case is bounded in dollars and nothing irreversible
          happens without a human.
        </GuideP>
        <GuideP>
          marketer.sh is built as that surface. Every action an agent can
          take runs through the same caps, approval gates, and audit log as
          the dashboard. The rest of this guide is the order to turn things
          on.
        </GuideP>
      </>
    ),
  },
  {
    id: "mcp-setup",
    heading: "Set up the MCP server",
    body: (
      <>
        <GuideP>
          Any MCP-capable agent, Claude Code among them, connects through{" "}
          <GuideCode>marketer-mcp</GuideCode>. Add it to your agent&apos;s MCP
          configuration with <GuideCode>uvx marketer-mcp</GuideCode> as the
          command and a token in <GuideCode>MARKETER_PAT</GuideCode>, then
          restart the agent. It discovers tools like{" "}
          <GuideCode>generate_article</GuideCode>,{" "}
          <GuideCode>enqueue_job</GuideCode>, and{" "}
          <GuideCode>today_spend</GuideCode> on its own.
        </GuideP>
        <GuideP>
          One design detail matters more than it looks:{" "}
          <GuideStrong>tool descriptions state costs</GuideStrong>. An agent
          reading <GuideCode>enqueue_job</GuideCode> learns what a video will
          draw from the balance before it calls anything, so a well-behaved
          model checks <GuideCode>today_spend</GuideCode> and estimates before
          it spends. You will see this in transcripts: agents narrate the
          budget without being asked, because the tools taught them to.
        </GuideP>
      </>
    ),
  },
  {
    id: "tokens",
    heading: "Mint a token the agent can lose",
    body: (
      <>
        <GuideP>
          Create the agent&apos;s token in Settings → Access tokens. Tokens
          are prefixed <GuideCode>mkt_</GuideCode>, shown once, and hashed at
          rest. Treat each agent as a separate employee:
        </GuideP>
        <GuideList
          items={[
            <>
              <GuideStrong>One token per agent.</GuideStrong> When a token
              leaks or an experiment goes sideways, you revoke one agent, not
              your whole automation setup.
            </>,
            <>
              <GuideStrong>Name tokens for their job.</GuideStrong>{" "}
              &ldquo;claude-articles-prod&rdquo; tells future-you what breaks
              when it is revoked.
            </>,
            <>
              <GuideStrong>Keep tokens out of prompts and repos.</GuideStrong>{" "}
              Pass them through the MCP config&apos;s environment, a secret
              manager, or CI secrets, never inline.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "guardrails",
    heading: "Caps are the guardrail, not the leash",
    body: (
      <>
        <GuideP>
          The per-niche daily cap and the global cap are what make agent
          autonomy boring, in the good sense. Every call the agent makes is
          pre-checked against both; a job that would cross either is{" "}
          <GuideStrong>refused before any money moves</GuideStrong>. The agent
          gets a clean, machine-readable refusal it can plan around, and your
          worst day is arithmetic: caps times days, no matter what the agent
          decides.
        </GuideP>
        <GuideCallout title="Start smaller than feels efficient">
          Give a new agent a $5 daily global cap for its first week. The point
          is not saving money; it is generating a week of transcripts you can
          audit before the number matters.
        </GuideCallout>
      </>
    ),
  },
  {
    id: "approval-gates",
    heading: "Approval gates: the human veto",
    body: (
      <>
        <GuideP>
          Caps bound spending; approval gates bound publishing. With
          review-before-post on, an agent can research, ideate, and produce
          all day, and everything it makes stops in a queue for you. This
          split is the core safety property:{" "}
          <GuideStrong>the agent controls work, you control the
          world</GuideStrong>. Reversible actions are cheap, so let the agent
          have them. Publishing is the irreversible one, so it waits for a
          human until the track record says otherwise.
        </GuideP>
        <SampleConversation />
      </>
    ),
  },
  {
    id: "widening-autonomy",
    heading: "When to widen autonomy",
    body: (
      <>
        <GuideP>
          Autonomy should be earned per niche and per format, on evidence you
          can point to. A reasonable bar: two weeks of transcripts with no
          surprising tool calls, an approval rate above 90 percent, and zero
          cap refusals you did not expect. Then widen one notch at a time,
          let video publish on schedule but keep articles gated, or raise the
          cap before you drop the gate, never both in the same week.
        </GuideP>
        <GuideP>
          And keep the exits cheap: every gate you open can be closed in one
          click, tokens revoke instantly, and the audit log records what the
          agent did while you were not looking. Trust it the way you trust a
          new hire: incrementally, with the logs open.
        </GuideP>
      </>
    ),
  },
];

export default function AgentDrivenMarketingGuidePage() {
  return (
    <main>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        type="application/ld+json"
      />
      <GuideLayout
        lede="An agent with MCP access can run your whole marketing loop. The platform's job is to make that safe: tokens you can revoke, caps that fail closed, and gates that keep publishing human. Here is the setup, in the order that keeps you comfortable."
        readingTime="6 min read"
        sections={SECTIONS}
        title={TITLE}
        updated="Jul 8, 2026"
      />
      <SectionCta
        className="mt-6"
        headline="Your agent's first tool call is five minutes away."
        kicker="Try it"
        primaryHref="/sign-up"
        primaryLabel="Create a token"
        secondaryHref="/resources/api"
        secondaryLabel="See all surfaces"
        sub="Sign up, mint an mkt_ token, add marketer-mcp to your agent, and watch it check the budget before it spends."
      />
    </main>
  );
}
