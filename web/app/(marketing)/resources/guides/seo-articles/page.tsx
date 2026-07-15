import type { Metadata } from "next";

import {
  GuideCallout,
  GuideCode,
  GuideLayout,
  GuideList,
  GuideP,
  GuideStrong,
  type GuideSection,
} from "@/components/marketing/resources/guide-layout";
import { SectionCta } from "@/components/marketing/system";

const TITLE = "Rank with articles your agents write";
const DESCRIPTION =
  "How the marketer.sh article pipeline works, from SERP research to JSON-LD, and how to configure niches, internal links, and publishing cadence so articles actually rank.";
const URL = "https://marketer.sh/resources/guides/seo-articles";

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
  datePublished: "2026-07-01",
  dateModified: "2026-07-10",
  author: { "@type": "Organization", name: "marketer.sh", url: "https://marketer.sh" },
  publisher: { "@type": "Organization", name: "marketer.sh", url: "https://marketer.sh" },
};

const SECTIONS: GuideSection[] = [
  {
    id: "pipeline",
    heading: "What the pipeline actually does",
    body: (
      <>
        <GuideP>
          An article job is not one model call. It is a staged pipeline, and
          each stage exists because skipping it produces the generic AI
          article everyone can smell.
        </GuideP>
        <GuideList
          items={[
            <>
              <GuideStrong>SERP research.</GuideStrong> The pipeline reads
              what currently ranks for the topic: the angles taken, the
              questions answered, the gaps nobody covers. Your article is
              positioned against the real competition, not written into a
              void.
            </>,
            <>
              <GuideStrong>Outline.</GuideStrong> A structure is drafted
              first, sections, FAQs, and target headings, so the piece argues
              one thing instead of wandering.
            </>,
            <>
              <GuideStrong>Parallel writing.</GuideStrong> Sections are
              written concurrently against the shared outline, which keeps a
              2,000-word piece fast without letting it drift.
            </>,
            <>
              <GuideStrong>QA.</GuideStrong> A separate pass checks claims
              against the research, cuts filler, and rejects drafts that fail.
              Failed drafts cost you a retry, not a published embarrassment.
            </>,
            <>
              <GuideStrong>Metadata, JSON-LD, hero image.</GuideStrong> Every
              draft ships with title tag, meta description, Article structured
              data, and a generated hero image. Nothing to bolt on later.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "eeat",
    heading: "Earning E-E-A-T with a machine",
    body: (
      <>
        <GuideP>
          Search engines reward experience, expertise, authority, and trust.
          A pipeline cannot fake your experience, but it can stop diluting it.
          The niche settings are where you put the things only you know:
          your point of view, your terminology, the claims you will and will
          not make, the products you actually use.
        </GuideP>
        <GuideP>
          The practical move is to treat the niche&apos;s tone and topic
          pillars as an <GuideStrong>editorial policy</GuideStrong>, not a
          style preference. &ldquo;We always state prices, we never say
          &lsquo;game-changer&rsquo;, we test before recommending&rdquo; is
          policy the QA stage can enforce on every draft. Generic content is
          mostly the absence of policy.
        </GuideP>
        <GuideCallout title="Put a human name on it">
          Articles perform better with a real byline and author page. Review
          drafts under your name in approval mode; the veto you exercise is
          exactly the editorial oversight E-E-A-T is trying to measure.
        </GuideCallout>
      </>
    ),
  },
  {
    id: "per-niche-setup",
    heading: "What to set per niche",
    body: (
      <>
        <GuideP>
          Articles inherit the niche&apos;s audience and tone, but a few
          settings deserve their own pass before you turn the pipeline on:
        </GuideP>
        <GuideList
          items={[
            <>
              <GuideStrong>Topic pillars.</GuideStrong> Three to five themes
              the niche owns. Ideation proposes topics inside the pillars, so
              tight pillars produce a coherent site section instead of a
              scattershot blog.
            </>,
            <>
              <GuideStrong>Search intent mix.</GuideStrong> Decide the ratio
              of informational (&ldquo;how does x work&rdquo;) to commercial
              (&ldquo;best x for y&rdquo;) pieces. Early on, weight
              informational; it ranks sooner and builds the authority the
              commercial pieces need.
            </>,
            <>
              <GuideStrong>The daily cap.</GuideStrong> Articles cost less
              than videos, so a mixed niche needs headroom for both. Check{" "}
              <GuideCode>today_spend</GuideCode> or the dashboard strip if
              article jobs are getting refused late in the day.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "internal-linking",
    heading: "Internal links: think in clusters",
    body: (
      <>
        <GuideP>
          A hundred orphan articles rank worse than thirty linked ones. The
          strategy that works is boring and old:{" "}
          <GuideStrong>hub and spoke</GuideStrong>. One pillar page owns the
          broad query; spoke articles answer the specific questions and link
          up to the pillar; the pillar links down to every spoke.
        </GuideP>
        <GuideP>
          Map your pillars to hubs before you generate volume. When you
          enqueue a topic, you are really choosing which cluster it joins, and
          a topic that fits no cluster is usually a topic to skip. As spokes
          accumulate around a hub, the hub starts moving for queries you could
          not have targeted directly.
        </GuideP>
      </>
    ),
  },
  {
    id: "cadence",
    heading: "Cadence: steady beats heroic",
    body: (
      <>
        <GuideP>
          Search engines index rhythm. Three articles a week for six months
          outperforms ninety articles in a burst followed by silence, both in
          crawling behavior and in your own ability to read results. Set the
          niche&apos;s article cadence to something you can review
          sustainably, then leave it alone.
        </GuideP>
        <GuideP>
          Expect the timeline to be honest but slow: indexing in days,
          movement on long-tail queries in weeks, competitive head terms in
          months. The pipeline&apos;s job is to make the waiting cheap; your
          per-article cost stays flat while the compounding does its work.
        </GuideP>
      </>
    ),
  },
  {
    id: "measuring",
    heading: "What to measure, and when to intervene",
    body: (
      <>
        <GuideP>
          Weekly, not daily: impressions by cluster, average position on the
          queries each hub targets, and which spokes earn links or
          completions. Feed what you learn back as topic decisions, double
          down on clusters that move, prune pillars that stay flat for a
          quarter.
        </GuideP>
        <GuideP>
          Intervene on inputs, not outputs. Editing one article by hand fixes
          one article; tightening a pillar, a policy line, or the intent mix
          fixes every article the niche writes from then on. That is the
          entire trick of running an editorial machine: push your judgment up
          a level and let the pipeline propagate it.
        </GuideP>
      </>
    ),
  },
];

export default function SeoArticlesGuidePage() {
  return (
    <main>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        type="application/ld+json"
      />
      <GuideLayout
        lede="The article pipeline researches the SERP, outlines, writes in parallel, QA-checks, and ships metadata with every draft. This guide covers the part that is still yours: setting editorial policy, structuring clusters, and choosing a cadence that compounds."
        readingTime="5 min read"
        sections={SECTIONS}
        title={TITLE}
        updated="Jul 10, 2026"
      />
      <SectionCta
        className="mt-6"
        headline="Publish articles that earn their keep."
        kicker="Try it"
        primaryHref="/sign-up"
        primaryLabel="Generate your first article"
        secondaryHref="/resources/api"
        secondaryLabel="Automate it via API"
        sub="Every draft arrives with metadata, JSON-LD, and a hero image, and waits for your approval until you say otherwise."
      />
    </main>
  );
}
