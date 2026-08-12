import type { Metadata } from "next";

import { Note } from "@/components/marketing/features/detail-a/note";
import { SpecCards } from "@/components/marketing/features/detail-a/spec-cards";
import { StageGrid } from "@/components/marketing/features/detail-a/stage-grid";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import {
  Band,
  MediaCard,
  Section,
  SectionHead,
  Stats,
} from "@/components/site/sections";

const DESCRIPTION =
  "Connect Google Ads or Meta, let agents draft campaigns and propose changes, and keep every spend-affecting action behind a fail-closed guard, an approval gate, and an append-only log.";

export const metadata: Metadata = {
  title: "Paid ads — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Paid ads — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/ads" },
};

/**
 * The six checks `services/ad_spend_guard.evaluate_budget_change` runs, in
 * the order the code runs them. Nothing here is a claim about outcomes —
 * each line is one branch of the guard.
 */
const GUARD_STAGES = [
  {
    label: "A connected account",
    copy: "No account, or an account that isn't active, and the change is refused before anything else is considered.",
    tag: "fail-closed",
  },
  {
    label: "The kill switch",
    copy: "While it's engaged, nothing may grow. Reductions and pauses still go through, so you can wind spend down mid-incident.",
  },
  {
    label: "A sane number",
    copy: "A negative daily budget is refused rather than normalised into something the platform would accept.",
  },
  {
    label: "The account's daily ceiling",
    copy: "The other active campaigns' committed budgets plus this change have to fit under the cap — and today's booked spend must not already be at it.",
  },
  {
    label: "The account's monthly ceiling",
    copy: "Booked spend for the month is checked against its own cap before an increase is allowed.",
  },
  {
    label: "Your signature",
    copy: "An increase at or above your approval threshold is allowed only as a proposal. It waits in the approvals queue until you decide.",
    tag: "human gate",
  },
];

const DIRECTIONS = [
  {
    name: "Product Hero",
    chips: ["1:1"],
    copy: "Physical products, hardware, tangible goods.",
  },
  {
    name: "Isometric World",
    chips: ["1:1"],
    copy: "B2B SaaS, developer tools, APIs, platforms.",
  },
  {
    name: "Type Poster",
    chips: ["1:1"],
    copy: "Statement-driven brands, abstract products, bold positioning.",
  },
  {
    name: "Macro Material",
    chips: ["1:1"],
    copy: "Beauty, food, fashion, premium finishes and textures.",
  },
  {
    name: "Chart as Art",
    chips: ["1:1"],
    copy: "Analytics, BI, observability, data platforms.",
  },
  {
    name: "Blueprint",
    chips: ["1:1"],
    copy: "Engineering, hardware, infrastructure, industrial.",
  },
];

export default function AdsFeaturePage() {
  return (
    <main>
      <FeatureHero
        highlight="can't move money."
        illustration={
          <MediaCard
            kind="image"
            label="Ads overview — spend today, approvals, campaigns"
            ratio="16/9"
          />
        }
        kicker="Paid ads"
        lede="Connect Google Ads or Meta and let agents do the drafting and the proposing. Between every proposal and your card sits a guard that fails closed, an approval queue, and a log that can't be edited."
        magneticPrimary
        titleText="Agents can run the ads. They can't move money."
        variant="sky"
      />

      {/* 1 — connecting */}
      <Band
        bullets={[
          "Google Ads: search, Performance Max, and YouTube campaigns.",
          "Meta Ads: Facebook and Instagram.",
          "Each account shows its real state — connected, authorizing, or errored — and can be refreshed or disconnected from the same screen.",
        ]}
        eyebrow="Connecting"
        extraCopy="A new campaign is created as a draft. Its intended daily budget is stored on the draft and only takes effect — inside your caps — when you activate it."
        heading="Connecting grants access. It does not grant spend."
        highlight="It does not grant spend."
        label="Connecting an ad account"
        lede="Accounts are linked by OAuth. Linking one lets the system read and draft; it cannot start spending until you set a budget and approve the change that turns it on."
        media={
          <MediaCard
            kind="image"
            label="Connect — Google Ads and Meta account states"
          />
        }
      />

      {/* 2 — the guard */}
      <StageGrid
        eyebrow="The spend guard"
        heading="Six checks stand between a proposal and a dollar."
        highlight="Six checks"
        label="The spend guard"
        lede="Every spend-affecting action runs through one guard, and the guard is written to deny. Anything missing, ambiguous, or over a ceiling is refused — it never optimistically allows."
        media={{
          kind: "illustration",
          label: "Spend guard — the six checks in order",
        }}
        stages={GUARD_STAGES}
      />

      {/* 3 — approvals */}
      <Band
        bullets={[
          "A proposal above your threshold parks as a pending approval and does not execute.",
          "You get an email when something is waiting, if you've left that on.",
          "Approve or reject from the queue; an approved action re-enters the same guarded path rather than skipping it.",
        ]}
        eyebrow="Approvals"
        flip
        heading="An agent can propose. Only you can commit."
        highlight="Only you can commit."
        label="The approvals queue"
        lede="The optimization workflow reads recent performance and, where a change is warranted, proposes it through the safe-execute layer. That layer is the only sanctioned path to a platform, and it parks large changes instead of applying them."
        media={
          <MediaCard
            kind="image"
            label="Approvals queue — action, summary, dollar delta"
          />
        }
      />

      {/* 4 — audit trail */}
      <Band
        bullets={[
          "Allowed actions, denied actions, approval requests, and executions are all written down.",
          "Each row carries the actor — you or an agent — the target, and the change in dollars per day.",
          "The log is read-only in the product. It is the record, not a view of one.",
        ]}
        eyebrow="Audit trail"
        heading="Every attempt is written down, including the refused ones."
        highlight="including the refused ones."
        label="The ads audit trail"
        lede="Ads actions append to a log rather than mutating a status. Afterwards, what an agent tried to do, what it was allowed to do, and what actually moved are all answerable from storage."
        media={
          <MediaCard
            kind="image"
            label="Activity log — actions, actors, dollar deltas"
          />
        }
      />

      {/* 5 — creative studio */}
      <Section label="Ad creative studio">
        <SectionHead
          eyebrow="Ad creative studio"
          heading="A domain in. A wall of on-brand square ads out."
          highlight="on-brand square ads"
          lede="Point the studio at a public domain. It researches the brand, its homepage, its real products and its style guide, then plans a run where every slot gets a distinct creative direction rendered on a distinct image model."
        />
        <div className="os-mt-48">
          <MediaCard
            kind="image"
            label="Ad creative studio — gallery of rendered 1:1 ads"
            ratio="16/8"
          />
        </div>
        <SpecCards className="os-mt-24" items={DIRECTIONS} />
        <Note title="It will not invent your catalogue.">
          Brand research runs as separate probes and its failures are graded
          rather than pooled. If the product research comes back empty the run
          stops, because putting a made-up offering in front of you as if it
          were yours is worse than no ad at all. Twelve creative directions
          ship in the catalog; the six above are a sample.
        </Note>
      </Section>

      {/* 6 — numbers */}
      <Section label="Ads by the numbers" size="tight">
        <Stats
          items={[
            { value: "2", label: "ad platforms: Google and Meta" },
            { value: "12", label: "creative directions in the studio catalog" },
            {
              value: "4",
              label: "logged outcomes: allow, deny, approval, execution",
            },
          ]}
        />
      </Section>

      <SectionCta
        headline="Put an agent on the ads. Keep the keys."
        highlight="Keep the keys."
        kicker="Get started"
        sub="Connect an account, set the caps, and decide how much a proposal may move before it needs your signature."
      />
    </main>
  );
}
