import type { Metadata } from "next";

import {
  GuideCallout,
  GuideLayout,
  GuideList,
  GuideP,
  GuideQuote,
  GuideStrong,
  type GuideSection,
} from "@/components/marketing/resources/guide-layout";
import { SectionCta } from "@/components/marketing/system";

const TITLE = "Launch your first channel in an afternoon";
const DESCRIPTION =
  "A practical guide to your first marketer.sh channel: framing a niche, writing the one-sentence brief, choosing voice and style, and building trust with approval mode.";
const URL = "https://marketer.sh/resources/guides/first-channel";

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
  datePublished: "2026-05-18",
  dateModified: "2026-07-02",
  author: { "@type": "Organization", name: "marketer.sh", url: "https://marketer.sh" },
  publisher: { "@type": "Organization", name: "marketer.sh", url: "https://marketer.sh" },
};

const SECTIONS: GuideSection[] = [
  {
    id: "frame-the-niche",
    heading: "Frame the niche, not the brand",
    body: (
      <>
        <GuideP>
          The most common first-channel mistake is briefing the system on your
          company instead of your audience. A niche in marketer.sh is not
          &ldquo;our brand&rsquo;s social presence.&rdquo; It is a{" "}
          <GuideStrong>repeatable editorial beat</GuideStrong>: one audience,
          one promise, one recognizable angle, delivered daily.
        </GuideP>
        <GuideP>
          &ldquo;Content about our productivity app&rdquo; is a brand. &ldquo;Two-minute
          fixes for people who abandon their to-do lists by Thursday&rdquo; is a
          niche. The second version tells the ideation engine who it is talking
          to, what problem recurs, and what a good topic looks like. It also
          tells the viewer, in the first second, whether this video is for
          them.
        </GuideP>
        <GuideP>
          Pick something narrow enough that you could name twenty topics
          yourself in ten minutes. If you can, the ideation engine can name two
          hundred, and rank them by what actually performed.
        </GuideP>
      </>
    ),
  },
  {
    id: "one-sentence-brief",
    heading: "Write the one-sentence brief",
    body: (
      <>
        <GuideP>
          Onboarding asks for a single sentence, and the AI drafts the full
          niche from it: audience, tone, topic pillars, posting plan. The
          sentence is doing a lot of work, so make it concrete. A useful
          template:
        </GuideP>
        <GuideQuote>
          &ldquo;[Kind of content] for [specific person] who [tension or
          desire].&rdquo;
        </GuideQuote>
        <GuideList
          items={[
            <>
              <GuideStrong>Name the person, not the demographic.</GuideStrong>{" "}
              &ldquo;Home cooks who meal-prep on Sundays&rdquo; beats
              &ldquo;25 to 40 year olds interested in food.&rdquo;
            </>,
            <>
              <GuideStrong>Include the tension.</GuideStrong> The clause after
              &ldquo;who&rdquo; is where hooks come from. &ldquo;...who
              don&apos;t want to spend $2,000&rdquo; generates a hundred videos.
            </>,
            <>
              <GuideStrong>Skip adjectives about yourself.</GuideStrong>{" "}
              &ldquo;High-quality engaging content&rdquo; adds nothing. The
              system already tries to be good.
            </>,
          ]}
        />
        <GuideP>
          You will get to edit everything the draft proposes, so do not agonize.
          A specific, slightly wrong sentence produces a better draft than a
          vague, safe one.
        </GuideP>
      </>
    ),
  },
  {
    id: "voice-and-style",
    heading: "Choose voice and style deliberately",
    body: (
      <>
        <GuideP>
          The niche draft comes with a proposed narration voice and visual
          style. Preview the voice before accepting it; you can audition
          options right in the review screen. Two rules of thumb serve most
          channels well.
        </GuideP>
        <GuideP>
          First, <GuideStrong>match energy to platform norms in your
          topic</GuideStrong>, not to your own taste. Finance and how-to
          content sustains a calm, mid-pace voice. Fitness and food reward
          brighter, faster reads. Watch three top posts in your niche and pick
          the voice that would not feel out of place among them.
        </GuideP>
        <GuideP>
          Second, <GuideStrong>commit for at least two weeks</GuideStrong>.
          Voice and style are how a feed learns to recognize you. Changing them
          every few days resets that recognition and muddies your early
          metrics, because you can no longer tell whether a dip came from the
          topic or the switch.
        </GuideP>
      </>
    ),
  },
  {
    id: "caps-first",
    heading: "Set the cap before the first render",
    body: (
      <>
        <GuideP>
          Before anything renders, set the niche&apos;s daily cap. For a first
          channel, $5 to $10 a day is plenty: enough for a daily video, an
          article, and some ideation, with room to spare. The cap is a hard
          limit, not a target. A job that would pass it is refused before any
          money moves.
        </GuideP>
        <GuideCallout title="Why set a cap you won't hit?">
          Because it converts anxiety into a number. With a cap in place you
          can stop watching the meter and start watching the content, which is
          the part that needs your judgment.
        </GuideCallout>
      </>
    ),
  },
  {
    id: "trust-ramp",
    heading: "Run the trust ramp",
    body: (
      <>
        <GuideP>
          Every niche starts in <GuideStrong>review-before-post</GuideStrong>{" "}
          mode: the pipeline produces, you approve, then it publishes. Treat
          the first two weeks as a deliberate ramp rather than a chore.
        </GuideP>
        <GuideList
          items={[
            <>
              <GuideStrong>Days 1 to 3:</GuideStrong> review everything.
              Reject freely and note why. Rejections teach you what to fix in
              the niche settings, usually the tone or the topic pillars.
            </>,
            <>
              <GuideStrong>Days 4 to 10:</GuideStrong> your approval rate
              should climb past 80 percent. If it does not, tighten the brief
              instead of grinding through reviews.
            </>,
            <>
              <GuideStrong>After two weeks:</GuideStrong> widen autonomy for
              the formats you trust. Many people keep articles on review and
              let video publish on schedule, or the reverse. Autonomy is per
              niche and reversible.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "early-metrics",
    heading: "Read early metrics without fooling yourself",
    body: (
      <>
        <GuideP>
          Performance data flows back into ideation automatically, but the
          first days of a channel are noisy and small. Resist the urge to
          steer on day three. What is worth watching early:
        </GuideP>
        <GuideList
          items={[
            <>
              <GuideStrong>Completion rate over views.</GuideStrong> A video
              that 200 people finish beats one that 2,000 people skip after a
              second. Completion is the earliest honest signal.
            </>,
            <>
              <GuideStrong>Spread between your best and worst
              post.</GuideStrong> A wide spread means the niche has a hit
              pattern to find. A flat, low spread usually means the framing is
              too broad.
            </>,
            <>
              <GuideStrong>The 30-day view, weekly.</GuideStrong> The niche
              performance card ranks top and bottom performers; ideation reads
              the same list. Check it weekly, not hourly.
            </>,
          ]}
        />
        <GuideP>
          By week three the loop is doing its job: topics that worked spawn
          neighbors, topics that flopped stop appearing, and your role shrinks
          to the two things a human is genuinely best at, taste and veto.
        </GuideP>
      </>
    ),
  },
];

export default function FirstChannelGuidePage() {
  return (
    <main>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        type="application/ld+json"
      />
      <GuideLayout
        lede="You need one honest sentence, a spending cap, and an afternoon. This guide covers the judgment calls the quickstart skips: how to frame a niche, what makes a brief generative, and how to ramp from reviewing everything to approving almost nothing."
        readingTime="5 min read"
        sections={SECTIONS}
        title={TITLE}
        updated="Jul 2, 2026"
      />
      <SectionCta
        className="mt-6"
        headline="One sentence. One afternoon."
        kicker="Try it"
        primaryHref="/sign-up"
        primaryLabel="Launch a channel"
        secondaryHref="/resources/quickstart"
        secondaryLabel="See the quickstart"
        sub="The first render is on a cap you set, and nothing publishes until you approve it."
      />
    </main>
  );
}
