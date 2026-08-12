import type { Metadata } from "next";

import { Note } from "@/components/marketing/features/detail-a/note";
import { SpecCards } from "@/components/marketing/features/detail-a/spec-cards";
import { WeightCards } from "@/components/marketing/features/detail-a/weight-cards";
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
  "Score any page the way an AI answer engine reads it: 32 rules across six weighted categories, evidence for every finding, and a copy-paste prompt for the agent that will fix it.";

export const metadata: Metadata = {
  title: "AI SEO audit — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "AI SEO audit — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/seo-audit" },
};

/** The six scored categories and their weights, straight from the rule set. */
const CATEGORIES = [
  {
    name: "Technical AI crawlability",
    points: 28.4,
    copy: "Can AI retrieval crawlers fetch and parse the page without running JavaScript?",
  },
  {
    name: "Content structure & chunking",
    points: 25.4,
    copy: "Can answer engines extract self-contained, quotable passages from it?",
  },
  {
    name: "E-E-A-T & entity authority",
    points: 21.4,
    copy: "Does the page expose trust, authorship, and entity signals?",
  },
  {
    name: "Structured data / schema",
    points: 13.4,
    copy: "Does the raw HTML expose machine-readable entities and page facts?",
  },
  {
    name: "Citation surface presence",
    points: 8.4,
    copy: "Does the page connect the brand to surfaces AI engines often cite?",
  },
  {
    name: "Measurement & governance",
    points: 3.0,
    copy: "Are monitoring and refresh signals visible or inferable?",
  },
];

/** The five bands, with the thresholds the scorer actually uses. */
const BANDS = [
  {
    name: "Critical",
    chips: ["0–40"],
    copy: "The page is structurally hard for AI engines to fetch, parse, or trust.",
  },
  {
    name: "Below average",
    chips: ["41–55"],
    copy: "Foundations are present in places, but the page is losing extractability and trust signals.",
  },
  {
    name: "Average",
    chips: ["56–70"],
    copy: "Reasonable AI SEO hygiene, with gaps in chunking, schema, or authority signals.",
  },
  {
    name: "Strong",
    chips: ["71–85"],
    copy: "Structured well enough to compete for AI citations on relevant prompts.",
  },
  {
    name: "Excellent",
    chips: ["86–100"],
    copy: "Strong crawlability, structure, schema, and trust signals across the board.",
  },
];

export default function SeoAuditFeaturePage() {
  return (
    <main>
      <FeatureHero
        highlight="an answer engine"
        illustration={
          <MediaCard
            kind="image"
            label="Audit result — score, band, and the six categories"
            ratio="16/9"
          />
        }
        kicker="AI SEO audit"
        lede="Paste a URL. About thirty seconds later you have a score out of a hundred, every rule it passed and failed with the evidence from your own page, and the prompt to hand your coding agent."
        magneticPrimary
        titleText="Score a page the way an answer engine reads it."
        variant="pearl"
      />

      {/* 1 — categories */}
      <Section label="The six categories">
        <SectionHead
          eyebrow="How it scores"
          heading="Six categories, weighted the way retrieval actually weights them."
          highlight="weighted"
          lede="Crawlability and chunking carry most of the score because they decide whether a passage can be retrieved at all. Governance carries the least because it is the smallest lever. Every category's points are split across the rules that applied to your page."
        />
        <WeightCards className="os-mt-48" items={CATEGORIES} />
      </Section>

      {/* 2 — rules */}
      <Band
        bullets={[
          "Every rule returns a status, the evidence it found on your page, and what to do about it.",
          "A rule that doesn't apply is marked as such and removed from its category's denominator — it neither takes free credit nor shrinks the rules that did apply.",
          "Rule ids are stable, so an audit you stored last month still means the same thing.",
        ]}
        eyebrow="The rules"
        extraCopy="Half credit is a real outcome here, not a rounding: a partial pass earns half its share, which is what most real pages score on structure rules."
        flip
        heading="Thirty-two rules, and each one shows its working."
        highlight="shows its working."
        label="The rule set"
        lede="Rules check the things an answer engine needs: HTTPS, critical content present in the raw HTML, a canonical that points somewhere indexable, one H1 with topical H2s, passages short enough to retrieve, JSON-LD entities, authorship, dates, citations."
        media={
          <MediaCard
            kind="image"
            label="Rule list — pass, partial, fail, didn't apply"
          />
        }
      />

      {/* 3 — bands */}
      <Section label="Score bands">
        <SectionHead
          eyebrow="Reading the number"
          heading="A score is only useful if it says what to think."
          highlight="what to think."
          lede="Each score lands in a band with a plain-language interpretation, so a 62 reads as a diagnosis rather than a grade."
        />
        <SpecCards className="os-mt-48" cols={3} items={BANDS} />
      </Section>

      {/* 4 — agent prompts */}
      <Band
        bullets={[
          "One full prompt covering every actionable finding, in priority order.",
          "The eight highest-impact findings as standalone prompts, for fixing one at a time.",
          "Downloadable as plain text, and byte-stable for the same audit so it can go straight into a diff or an issue.",
        ]}
        eyebrow="The fix"
        heading="The findings come back as a prompt, not a lecture."
        highlight="as a prompt"
        label="Agent fix prompts"
        lede="Findings are sorted by the points they could win back and assembled into prompts a coding agent can act on. They are built from your results, not generated — the same audit always produces the same text."
        media={
          <MediaCard
            kind="image"
            label="Agent fix prompt — full and top-issue prompts"
          />
        }
      >
        <Note title="The prompts forbid inventing the signals they ask for.">
          Several rules reward things an agent could trivially fake — authority,
          reviews, authorship, credentials, dates, analytics evidence. The
          prompts say so out loud and forbid fabricating any of them, because
          inventing a signal is worse than failing the rule that looks for it.
        </Note>
      </Band>

      {/* 5 — how it fetches */}
      <Band
        bullets={[
          "Page bytes come through a fetching vendor that owns rendering and robots compliance — never a direct request from us to your site.",
          "Audits are stored per URL. A repeat inside twenty-four hours is served from the stored result unless you ask for a fresh one.",
          "Change the rules or the result shape and the whole cache generation retires at once, so a stale audit is never served as current.",
        ]}
        eyebrow="How it fetches"
        flip
        heading="Two fetches, then pure arithmetic."
        highlight="pure arithmetic."
        label="How the audit runs"
        lede="An audit is the page's HTML and its Markdown, parsed once into everything the rules read, then scored on the spot. It runs in one round trip instead of a job you have to come back to."
        media={
          <MediaCard kind="illustration" label="Fetch, parse, score, store" />
        }
      />

      <Section label="Audit by the numbers" size="tight">
        <Stats
          items={[
            { value: "32", label: "rules across six weighted categories" },
            { value: "~30s", label: "typical time for one audit" },
            { value: "8", label: "top issues handed over as standalone prompts" },
          ]}
        />
      </Section>

      <SectionCta
        headline="Audit the page you care most about."
        highlight="care most about."
        kicker="Get started"
        sub="Run it once for the score, hand the prompt to your agent, and re-run it when the fix ships."
      />
    </main>
  );
}
