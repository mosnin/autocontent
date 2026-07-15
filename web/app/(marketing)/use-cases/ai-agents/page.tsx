import type { Metadata } from "next";

import { SectionCta } from "@/components/marketing/system";
import { FaqBand, type FaqItem } from "@/components/marketing/use-cases/faq";
import { AgentChatMock } from "@/components/marketing/use-cases/mocks/agent-chat";
import {
  MockBand,
  OutcomesBand,
  PainBand,
  StepsBand,
  UseCaseHero,
} from "@/components/marketing/use-cases/template";

const DESCRIPTION =
  "marketer.sh gives AI agents a full marketing department: MCP tools with cost-aware descriptions, PAT auth, and hard spend caps so agents cannot overspend.";

export const metadata: Metadata = {
  title: "AI agents — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "AI agents — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/use-cases/ai-agents" },
};

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "How do agents authenticate?",
    a: "With scoped personal access tokens. Mint a PAT, limit it to the niches an agent may touch, and use it across the API, TypeScript SDK, CLI, and MCP server.",
  },
  {
    q: "Can an agent overspend?",
    a: "No. Per-niche daily caps and a global cap are enforced server-side, and everything runs on prepaid credits. A call that would pass a cap is refused before it costs anything, and every tool description states its cost up front so agents can plan.",
  },
  {
    q: "Does anything post without review?",
    a: "Only if you turn the approval gate off. With the gate on, agents can brief, produce, and queue freely, and publishing waits for a human. Many teams start gated and hand agents the keys once the output has earned it.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function AiAgentsPage() {
  return (
    <main>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
        type="application/ld+json"
      />
      <UseCaseHero
        headline={["Your agents are", "the marketing team."]}
        kicker="For AI agents · the namesake"
        lede="marketer.sh exists so software can run marketing. Every pipeline is a tool an agent can call, every cost is declared up front, and every dollar stops at a cap you set."
        primaryHref="/resources/api"
        primaryLabel="Read the API docs"
        scene="aurora"
        secondaryHref="/sign-up"
        secondaryLabel="Start creating"
      />
      <PainBand
        heading="Agents can plan. They can't produce."
        lede="Your agent can write the campaign doc. Then what?"
        pains={[
          {
            title: "No hands",
            copy: "An agent can draft a strategy, but rendering video, cutting captions, and publishing on schedule takes a stack it doesn't have.",
          },
          {
            title: "Five APIs and a prayer",
            copy: "Gluing a script model to a video model to a voice model to a scheduler is a platform team's quarter, per pipeline.",
          },
          {
            title: "Nobody trusts it with a card",
            copy: "Generative spend compounds fast. Without hard limits, an agent with a budget is an incident report waiting to file itself.",
          },
        ]}
      />
      <StepsBand
        heading="Connect, call, stay under the cap."
        steps={[
          {
            title: "Connect over MCP or the API",
            copy: "Point your agent at the MCP server, or use the API, SDK, or CLI with a scoped PAT. The whole platform is callable.",
          },
          {
            title: "Tools declare their cost",
            copy: "Every tool description says what it does and what it costs, so agents budget before they act instead of apologizing after.",
          },
          {
            title: "Guardrails do the worrying",
            copy: "Per-niche and global caps refuse overspend at the API. The approval gate holds publishing for a human until you lift it.",
          },
        ]}
      />
      <MockBand
        bullets={[
          "MCP tools with cost-aware descriptions",
          "Scoped PAT auth for every surface",
          "Caps refuse overspend server-side, gates hold publishing",
        ]}
        heading="One sentence in. A campaign out."
        kicker="The product moment"
        lede="An ops agent gets a one-line instruction, calls the tools, checks its budget, and parks the whole push at your approval gate."
        scene="aurora"
      >
        <AgentChatMock />
      </MockBand>
      <OutcomesBand
        heading="Autonomy, with receipts."
        stats={[
          { value: 4, label: "surfaces to drive it: API, SDK, CLI, MCP" },
          { value: 24, suffix: "/7", label: "the cadence agents can hold" },
          {
            value: 0,
            prefix: "$",
            label: "spendable past the caps, by design",
          },
        ]}
      />
      <FaqBand items={FAQ_ITEMS} />
      <SectionCta
        headline="Give your agent a marketing department."
        kicker="Get started"
        primaryHref="/sign-up"
        primaryLabel="Start creating"
        secondaryHref="/resources/api"
        secondaryLabel="Read the API docs"
        sub="Mint a PAT, set a cap, hand your agent the MCP server. Keep the gate on until it earns your trust."
      />
    </main>
  );
}
