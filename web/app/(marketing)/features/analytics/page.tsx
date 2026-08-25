import type { Metadata } from "next";

import {
  AnalyticsStats,
  LoopBand,
  MetricsMoment,
  SpendBand,
} from "@/components/marketing/features/analytics-sections";
import { Note } from "@/components/marketing/features/detail-a/note";
import { SpecCards } from "@/components/marketing/features/detail-a/spec-cards";
import { FactCards } from "@/components/marketing/features/detail-c/fact-cards";
import { Panel } from "@/components/marketing/features/detail-c/panel";
import { StageRail } from "@/components/marketing/features/detail-c/stage-rail";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import {
  Band,
  MediaCard,
  Section,
  SectionHead,
} from "@/components/site/sections";

const DESCRIPTION =
  "Per-post views, watch time, and completion feed the next ideation round. Every model call is metered to a ledger with hard caps that fail closed, not open.";

export const metadata: Metadata = {
  title: "Analytics & spend — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Analytics & spend — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/analytics" },
};

/**
 * What actually happens around one provider call, in order. Taken from
 * `services/spend_context.py` — the pre-flight check, the ledger write,
 * the debit, and the post-spend re-read that is the real guarantee.
 */
const SPEND_PATH = [
  {
    label: "Before the call, an estimate",
    copy: "Every metered call names what it expects to cost before it is made. Nothing is spent on the strength of finding out afterwards.",
    tag: "pre-flight",
  },
  {
    label: "Three ceilings are read",
    copy: "Today's spend for this niche, today's spend across every niche, and your prepaid balance — including the margin the charge will carry. Any one of them short and the call is refused.",
  },
  {
    label: "The call happens",
    copy: "A model, an image, a render, a voice, a transcription. Whatever it was, the provider and the exact SKU are known by name.",
  },
  {
    label: "The ledger row is written",
    copy: "Provider, SKU, units, dollars, and the job, article or post it belongs to. This is the record — the dashboard reads it, it does not maintain a second one.",
    tag: "append-only",
  },
  {
    label: "The balance is debited",
    copy: "On the hosted product the same movement lands on the credit ledger, atomically: the balance change and its transaction row are one database transaction or neither happens.",
  },
  {
    label: "Then the ceilings are read again",
    copy: "This is the part that matters. Re-reading after the write is what makes the cap hold when several jobs — or several scenes inside one job — are spending at the same moment.",
    tag: "the guarantee",
  },
  {
    label: "And everything else stops",
    copy: "A breach flips a signal the rest of the run watches, tagged with which ceiling it was, so sibling tasks and later stages stop cheaply instead of discovering it one call at a time.",
  },
];

/** The three independent ceilings, each optional and separately enforced. */
const CEILINGS = [
  {
    kicker: "Per niche",
    title: "A daily cap on one channel",
    copy: "Each niche carries its own daily ceiling, so a channel you are experimenting with cannot eat the budget of the one that works. It shows on the dashboard as a meter, spent against allowed.",
    chips: ["per day"],
  },
  {
    kicker: "Per account",
    title: "A daily cap over everything",
    copy: "One number across every niche, checked on the same schedule as the per-niche cap. It exists for the case where four modest caps still add up to more than you meant to spend.",
    chips: ["per day"],
  },
  {
    kicker: "Prepaid",
    title: "A balance that is simply finite",
    copy: "Credit is bought up front, from five dollars, with no subscription. It is the last gate: a call that would take the balance past what you paid for is refused before it is made.",
    chips: ["from $5", "no subscription"],
  },
];

/**
 * Fields the analytics client parses off a post. Every one of them is
 * optional downstream, because platforms expose different subsets.
 */
const POST_METRICS = [
  {
    name: "Reach",
    chips: ["views", "impressions"],
    copy: "How many times it was served and how many people it got to. The denominator for everything else on this list.",
  },
  {
    name: "Attention",
    chips: ["avg watch", "total watch"],
    copy: "Average watch time per viewer and total watch time across all of them — the difference between a hook that works and one that only gets clicked.",
  },
  {
    name: "Completion",
    chips: ["rate"],
    copy: "The share of viewers who stayed to the end. The single most useful signal for short-form, and the one the next ideation round leans on hardest.",
  },
  {
    name: "Response",
    chips: ["likes", "comments", "shares", "saves"],
    copy: "What people did rather than what they watched. Stored per post alongside the rest.",
  },
];

export default function AnalyticsFeaturePage() {
  return (
    <main>
      <FeatureHero
        highlight="It never overspends."
        illustration={
          <MediaCard
            kind="illustration"
            label="Performance loop — spend caps diagram"
            ratio="16/9"
          />
        }
        kicker="Analytics & spend"
        lede="Every post reports back with views, watch time, and completion. Every dollar is metered as it's spent. The system learns from the first and is bound by the second."
        magneticPrimary
        titleText="It learns what works. It never overspends."
        variant="sky"
      />

      <LoopBand />

      {/* What comes back per post */}
      <Section label="What a post reports">
        <div className="os-split">
          <SectionHead
            eyebrow="Per post"
            heading="Not a follower count. What the video actually did."
            highlight="What the video actually did."
            lede="Metrics are pulled per published post and stored raw alongside the parsed fields, so a number that a platform stops reporting doesn't quietly become a zero — it becomes absent, which is a different thing."
          />
          <MediaCard
            kind="image"
            label="Post performance card — views, watch time, completion"
          />
        </div>
        <SpecCards className="os-mt-48" cols={2} items={POST_METRICS} />
        <Note title="Platforms disagree about what to tell you.">
          TikTok, Reels and Shorts each expose a different subset of these,
          and every field is optional the whole way down. Where a platform
          reports nothing, nothing is invented to fill the column — the
          learning loop simply reads what is there.
        </Note>
      </Section>

      {/* Loop back into ideation */}
      <Band
        bullets={[
          "The top and bottom performers of the last thirty days are looked up per niche, and their original hooks and topics are loaded back.",
          "Both ends are handed to ideation — a losing angle is as informative as a winning one, and cheaper to learn from twice.",
          "With no metrics yet, the context is empty and the agent works from its defaults. A cold start is not a broken one.",
        ]}
        eyebrow="The feedback loop"
        flip
        heading="Last month's results are this month's brief."
        highlight="this month's brief."
        label="Performance-fed ideation"
        lede="Attribution here is not a report you read. It is an input: before a new video is ideated, the niche's recent winners and losers are summarised and put in front of the agent that picks the next angle."
        media={
          <MediaCard
            kind="image"
            label="This week's performers — top and bottom angles"
          />
        }
      />

      <SpendBand />

      {/* The spend path */}
      <Section label="How a dollar is guarded">
        <div className="os-split">
          <SectionHead
            eyebrow="The spend path"
            heading="A cap that is only checked beforehand isn't a cap."
            highlight="isn't a cap."
            lede="Six scenes rendering at once all read the same balance before any of them writes to it. Check once at the start and they can collectively sail past a ceiling that every one of them individually respected. So the check runs again, after every write, against the database."
          />
          <MediaCard
            kind="illustration"
            label="Spend path — estimate, call, ledger, re-check"
          />
        </div>
        <StageRail className="os-mt-48" steps={SPEND_PATH} />
      </Section>

      {/* Ceilings */}
      <Section label="The three ceilings">
        <SectionHead
          eyebrow="Three ceilings"
          heading="Three limits, and any one of them is enough to stop a job."
          highlight="any one of them"
          lede="They are independent. Set the ones you want, leave the ones you don't, and each is enforced on its own terms — the failure message names which ceiling it was, so you never have to guess what stopped a run."
        />
        <FactCards className="os-mt-48" items={CEILINGS} />
      </Section>

      <MetricsMoment />

      {/* Failures */}
      <Band
        bullets={[
          "Spend cap, render QA, content QA, provider error, timeout or stuck, and everything else.",
          "Jobs, articles and image posts are triaged into the same inbox rather than one screen per product.",
          "Anything in it can be replayed in place, through the same retry path each surface already had.",
        ]}
        eyebrow="Failures"
        extraCopy="A run that dies with no progress is failed on a timer rather than left in a non-terminal state — a job nobody can retry and no alert can see is the worst of both outcomes."
        heading="Six categories, one inbox, and a retry button."
        highlight="one inbox,"
        label="The failures inbox"
        lede="Things fail: a provider goes down, a cap trips mid-render, a script gets rejected. What matters is whether you find out in one place and can act there, or discover it product by product a week later."
        media={
          <MediaCard
            kind="image"
            label="Failures inbox — categorized failures with retry"
          />
        }
      />

      <Panel
        body="Credit is bought in packs and lands on the balance one for one. Every purchase is idempotent on its checkout session, so a retried payment webhook credits you once, and every movement in either direction is mirrored into a transaction row you can read back."
        bullets={[
          "The estimate is shown before a run, in onboarding, in the run dialog, and on the job itself.",
          "Every ledger row names its provider and SKU, so a surprising day is a line item, not a mystery.",
          "The balance sits until you use it. There is nothing to cancel, because there is nothing recurring.",
        ]}
        eyebrow="Prepaid, not billed"
        heading="You cannot be surprised by an invoice you never signed up for."
        highlight="an invoice you never signed up for."
        label="Prepaid credit"
      />

      <AnalyticsStats />

      <SectionCta
        headline="Put the loop to work."
        highlight="the loop"
        kicker="Get started"
        sub="Start with a small cap. Watch the metrics steer the next round. Raise it when the numbers earn it."
      />
    </main>
  );
}
