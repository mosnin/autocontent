import type { Metadata } from "next";

import {
  ChangelogTimeline,
  type ChangelogEntry,
} from "@/components/marketing/resources/changelog-timeline";
import { PageHero } from "@/components/marketing/resources/page-hero";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "What shipped in marketer.sh and when: the articles pipeline, agent surfaces, prepaid credits, approval gates, performance-fed ideation, and more, newest first.";

export const metadata: Metadata = {
  title: "Changelog — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Changelog — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/resources/changelog" },
};

const ENTRIES: ChangelogEntry[] = [
  {
    date: "Jul 8, 2026",
    title: "Articles & SEO pipeline",
    body: "marketer.sh now writes long-form too. A second pipeline runs SERP research, drafts an outline, writes sections in parallel, QA-checks the result, and ships every draft with metadata, Article JSON-LD, and a generated hero image. Articles share your niche's voice, caps, and approval gates.",
    tags: ["Articles", "Pipeline"],
  },
  {
    date: "Jun 22, 2026",
    title: "Voice previews and pre-warmed renders",
    body: "Audition narration voices right in niche settings before committing, and the render path now pre-warms your chosen voice so first jobs start faster. Render-complete emails link straight to the approval queue.",
    tags: ["Video", "Quality of life"],
  },
  {
    date: "Jun 9, 2026",
    title: "Prepaid credits",
    body: "Billing moved to prepaid credit packs through Stripe: buy once, draw down as work renders, no subscription. Your balance and today's spend sit at the top of the dashboard, and jobs your balance can't cover are refused up front.",
    tags: ["Billing"],
  },
  {
    date: "May 27, 2026",
    title: "One-sentence onboarding",
    body: "Describe your channel in a single sentence and the AI drafts the entire niche: audience, tone, topic pillars, voice, visual style, and a starting posting plan. Everything is editable before the first render.",
    tags: ["Onboarding"],
  },
  {
    date: "May 13, 2026",
    title: "Approval gates & the trust ramp",
    body: "Every niche now starts in review-before-post mode. Approve or reject each draft with one click, then widen autonomy per niche and per format once the output earns it. Tighten back anytime.",
    tags: ["Trust", "Publishing"],
  },
  {
    date: "Apr 24, 2026",
    title: "Performance-fed ideation",
    body: "The loop closed: ideation now reads your last 30 days of results and briefs itself on your top and bottom performers. Topics that worked spawn neighbors; topics that flopped stop coming back.",
    tags: ["Ideation", "Analytics"],
  },
  {
    date: "Apr 8, 2026",
    title: "Post analytics & niche attribution",
    body: "Views, watch time, and engagement flow back from TikTok, Reels, and Shorts into per-post metrics, with cost attributed per job and per niche. Every niche page gets a performance card with its best and worst recent posts.",
    tags: ["Analytics"],
  },
  {
    date: "Mar 25, 2026",
    title: "Global daily cap",
    body: "A second, account-wide cap on top of per-niche budgets. Run as many niches as you like; total daily spend stays under one number you set. Like all caps, it fails closed.",
    tags: ["Spend controls"],
  },
  {
    date: "Mar 10, 2026",
    title: "Agent surfaces: MCP, CLI, and Python SDK",
    body: "The whole platform became callable. A REST API, a Python SDK (MarketerClient), a CLI (marketer niches, jobs, articles), and an MCP server whose tool descriptions state costs before an agent spends. Authentication via mkt_ personal access tokens, hashed at rest.",
    tags: ["Agents", "Developers"],
  },
  {
    date: "Feb 18, 2026",
    title: "Spend guardrails",
    body: "Every provider call now runs a pre-flight cap check, and pipeline fan-out is bounded so a runaway job can't multiply costs. A job that would cross a cap is refused before any money moves, and shows exactly which cap stopped it.",
    tags: ["Spend controls", "Pipeline"],
  },
];

export default function ChangelogPage() {
  return (
    <main>
      <PageHero
        headline="Shipped, dated, and honest."
        kicker="Changelog"
        sub="What changed in marketer.sh, newest first. Product releases only, no 'various improvements'."
        variant="pearl"
      />

      <section
        aria-label="Release history"
        className="mx-auto max-w-4xl px-6 py-24 md:py-32"
      >
        <ChangelogTimeline entries={ENTRIES} />
      </section>

      <SectionCta
        headline="Use what shipped this month."
        kicker="Get started"
        primaryHref="/sign-up"
        primaryLabel="Start creating"
        secondaryHref="/resources/quickstart"
        secondaryLabel="Open the quickstart"
        sub="Every entry above is live for every account. There are no tiers to unlock, only credit packs."
      />
    </main>
  );
}
