import type { Metadata } from "next";

import {
  MetadataBand,
  OutlineBand,
  QaBand,
  SerpBand,
} from "@/components/marketing/features/articles-sections";
import { Note } from "@/components/marketing/features/detail-a/note";
import { SpecCards } from "@/components/marketing/features/detail-a/spec-cards";
import { Panel } from "@/components/marketing/features/detail-c/panel";
import { StageRail } from "@/components/marketing/features/detail-c/stage-rail";
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
  "Live SERP research, structured outlines, sections written in parallel under E-E-A-T rules, QA scoring, full SEO metadata, JSON-LD, and internal links.";

export const metadata: Metadata = {
  title: "Articles & SEO — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Articles & SEO — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/articles" },
};

/**
 * The pipeline's own statuses, in the order the article row moves through
 * them. Every one of these is a value the API reports and the list screen
 * filters on — not a marketing abstraction of the process.
 */
const STAGES = [
  {
    label: "Queued",
    copy: "The run is accepted and the row exists. If you didn't name a topic, one is picked here — checked against the titles this niche already published so the same piece never ships twice.",
  },
  {
    label: "Researching",
    copy: "The focus keyword goes out to a search provider and what currently ranks comes back. The angles, the depth and the gaps get summarised into a brief for the outline.",
    tag: "live serp",
  },
  {
    label: "Outlining",
    copy: "One H1 and a set of H2s, each with a job to do, written against the research rather than against the topic in the abstract.",
  },
  {
    label: "Writing",
    copy: "Sections are drafted concurrently, a bounded few at a time, each one carrying the whole outline so the piece argues one thing instead of repeating itself in five voices.",
    tag: "parallel",
  },
  {
    label: "QA",
    copy: "The draft is scored. Below the bar it gets exactly one corrective rewrite against the scorer's own notes, then it is scored again.",
    tag: "one rewrite",
  },
  {
    label: "Metadata",
    copy: "Title, slug, meta description and keywords, JSON-LD for the page, and internal-link suggestions drawn from the articles you have already published.",
  },
  {
    label: "Imaging",
    copy: "An editorial hero image is generated to match the piece. Optional by design — an article is fully publishable without one.",
  },
  {
    label: "Done",
    copy: "The row is complete and publishable. Nothing has a public URL yet; that is a separate decision with its own guards.",
  },
];

/** The four scores the QA pass returns. */
const SCORES = [
  {
    name: "Overall",
    chips: ["threshold"],
    copy: "The weighted number the gate reads. Under the bar and the piece is rewritten once before it can be scored again.",
  },
  {
    name: "Keyword density",
    chips: ["measured"],
    copy: "Counted from the text, not asked of a model. It is the one score that cannot be flattered by the thing being judged.",
  },
  {
    name: "E-E-A-T",
    chips: ["judged"],
    copy: "Whether experience, expertise, authority and trust signals are actually present in the prose, rather than asserted in the intro.",
  },
  {
    name: "Readability",
    chips: ["judged"],
    copy: "Sentence length and structure. Scored alongside notes that name what to fix, which is what the rewrite is handed.",
  },
];

/**
 * The publication guards in `cms/publish.py`. Each one refuses a specific
 * way a live URL goes wrong; the codes are stable for API clients.
 */
const GUARDS = [
  {
    name: "Nothing empty goes live",
    chips: ["no_content"],
    copy: "A live URL rendering an empty page is worse than a 404: it gets crawled, indexed as thin content, and nobody notices for weeks.",
  },
  {
    name: "Nothing untitled goes live",
    chips: ["no_title"],
    copy: "The title is the page title and the search headline. Publishing without one ships a result called “Untitled” into the index.",
  },
  {
    name: "Nothing unfinished goes live",
    chips: ["not_finished"],
    copy: "Only a completed run can publish. Mid-run, the metadata and the score don't exist yet; a failed run is a partial draft that was never scored at all.",
  },
  {
    name: "A live slug is frozen",
    chips: ["slug_frozen"],
    copy: "The slug is the URL. Renaming a published one breaks every inbound link and frees the old path for something unrelated to claim. Drafts can change theirs freely.",
  },
  {
    name: "Publishing twice is not an event",
    chips: ["idempotent"],
    copy: "A repeated publish returns the article unchanged and does not re-stamp the date — a moving publish date reads as churn to crawlers and re-fires feed readers.",
  },
  {
    name: "Unpublishing is said out loud",
    chips: ["explicit"],
    copy: "Scheduling an already-live article is refused rather than quietly taking the URL down and bringing it back later. You have to ask for the unpublish.",
  },
];

export default function ArticlesFeaturePage() {
  return (
    <main>
      <FeatureHero
        highlight="Not blog filler."
        illustration={
          <MediaCard
            kind="video"
            label="Press demo — SERP research to published article"
            ratio="16/9"
          />
        }
        kicker="Articles & SEO"
        lede="Every piece starts with research into what currently ranks, gets written under E-E-A-T rules, and is scored before it ships. With metadata, schema, and internal links included."
        magneticPrimary
        titleText="Articles that rank. Not blog filler."
        variant="pearl"
      />

      {/* 1 — the stages */}
      <Section label="The article pipeline">
        <div className="os-split">
          <SectionHead
            eyebrow="The pipeline"
            heading="Eight stages, and you can watch it move through them."
            highlight="watch it move"
            lede="The row is written back at every stage, so an article in progress is a status you can read rather than a spinner. It also means a run that dies mid-way is visible, retryable, and resumes as itself."
          />
          <MediaCard
            kind="image"
            label="Article detail — stage status and progress"
          />
        </div>
        <StageRail className="os-mt-48" steps={STAGES} />
      </Section>

      <SerpBand />

      <OutlineBand />

      {/* Voice */}
      <Band
        bullets={[
          "The niche's tone leads, because it is the most specific thing you have said about this vertical.",
          "The account brand voice refines it, so long-form reads like the shorts and the ads read.",
          "A writing kit — your reusable voice and style system — can be pinned per niche or left as the account default.",
        ]}
        eyebrow="Voice"
        extraCopy="Banned words are not a filter applied afterwards. They are a hard constraint written into the outline prompt, the section prompts and the scoring prompt, so the piece is never drafted with them in the first place."
        flip
        heading="One voice, assembled from what you already told it."
        highlight="One voice,"
        label="Brand voice and writing kits"
        lede="Nothing here asks you to restate your brand for the article pipeline. The tone is composed from the niche, the account brand kit and the writing kit, in that order of specificity."
        media={
          <MediaCard
            kind="image"
            label="Brand kit — tone of voice and banned words"
          />
        }
      />

      <MetadataBand />

      <QaBand />

      {/* Scores */}
      <Section label="What the QA pass scores">
        <SectionHead
          eyebrow="The four numbers"
          heading="Three judgements and one measurement."
          highlight="one measurement."
          lede="A model can be talked into liking its own prose, so the score that decides whether keyword use is honest is computed from the text rather than asked for. The other three are judged, and every one of them comes back with notes."
        />
        <SpecCards className="os-mt-48" cols={2} items={SCORES} />
        <Note title="One rewrite, then the number stands.">
          A piece under the bar is rewritten once, against the notes that
          explain why, and re-scored. There is no third attempt: a pipeline
          that rewrites until it passes is a pipeline whose gate means
          nothing.
        </Note>
      </Section>

      {/* Publishing */}
      <Section label="Publishing guards">
        <div className="os-split">
          <SectionHead
            eyebrow="Going live"
            heading="A finished article and a public URL are two different decisions."
            highlight="two different decisions."
            lede="Publishing is the one action with consequences outside the database — it mints a URL that crawlers index and people link to. So each of these refusals exists because of a specific way that goes wrong, and each returns a stable code rather than a generic error."
          />
          <MediaCard
            kind="image"
            label="Publication state — draft, scheduled, published"
          />
        </div>
        <SpecCards className="os-mt-48" items={GUARDS} />
      </Section>

      {/* Revisions */}
      <Band
        bullets={[
          "An edit captures the state it is replacing before it writes the new one.",
          "A restore doesn't rewind. It records where you were and writes the older content forward, so the trip back is itself in the history.",
          "Nothing updates or deletes a revision row. What changed, and when, stays answerable.",
        ]}
        cta={{ label: "Audit a live page", href: "/features/seo-audit" }}
        eyebrow="Revisions"
        heading="Editing is allowed. Losing the previous version isn't."
        highlight="Losing the previous version isn't."
        label="Revision history"
        lede="Articles are editable — the pipeline writes a draft, you make it yours. History is append-only underneath that, which is what makes an edit safe to make in the first place."
        media={
          <MediaCard
            kind="image"
            label="Revision list — edits with before-state snapshots"
          />
        }
      />

      <Panel
        body="An article is fully publishable without a hero image, so a hero image that fails is logged and skipped rather than taking the piece down with it. A spend cap is the one exception: that is a money guardrail, not an illustration problem, so it ends the run cleanly like every other metered stage."
        bullets={[
          "No search provider configured degrades research to model knowledge instead of failing the run.",
          "A brand kit or writing kit that can't be loaded seasons nothing and blocks nothing.",
          "Every LLM and image call is metered to the ledger and checked against your niche cap, your global cap, and your prepaid balance.",
        ]}
        eyebrow="When something is missing"
        heading="The optional parts degrade. The money parts don't."
        highlight="The money parts don't."
        label="Degraded modes"
      />

      <Section label="Articles by the numbers" size="tight">
        <Stats
          items={[
            { value: "8", label: "pipeline stages, each one a readable status" },
            { value: "1", label: "corrective rewrite, then the score stands" },
            { value: "6", label: "guards between a finished draft and a live URL" },
          ]}
        />
      </Section>

      <SectionCta
        headline="Publish your first ranked page."
        highlight="first ranked page."
        kicker="Get started"
        sub="Pick a niche. The pipeline researches, writes, scores, and hands you a ship-ready article."
      />
    </main>
  );
}
