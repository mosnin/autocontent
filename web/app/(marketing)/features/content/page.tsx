import type { Metadata } from "next";

import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionHeading } from "@/components/marketing/section-heading";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "Short-form video for TikTok, Reels, and Shorts. One brief in: script, frames, voice, captions, QA, publish.";

export const metadata: Metadata = {
  title: "Content · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Content · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/content" },
};

const POINTS = [
  {
    title: "Brief to publish",
    body: "Hook, script, keyframes, voice, music, captions, QA, then the file goes out. You review the output, not a timeline.",
  },
  {
    title: "The platforms you already post on",
    body: "TikTok, Reels, and Shorts. Scheduling windows sit on the niche so posts go out when you said they should.",
  },
  {
    title: "Capped like everything else",
    body: "Each render is metered. If the next stage would cross a daily cap, the job stops.",
  },
];

export default function ContentServicePage() {
  return (
    <main>
      <FeatureHero
        kicker="Content"
        lede={DESCRIPTION}
        primary={{ label: "Start creating", href: "/sign-up" }}
        secondary={{ label: "See pricing", href: "/pricing" }}
        titleText="Short-form that ships itself."
      />
      <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10">
        <SectionHeading
          description="Short videos that can go out every day, without hiring an editor."
          title="What the content service does"
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {POINTS.map((point) => (
            <article
              className="border-border rounded-3xl border p-7"
              key={point.title}
            >
              <h3 className="text-foreground text-lg font-medium tracking-tight">
                {point.title}
              </h3>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {point.body}
              </p>
            </article>
          ))}
        </div>
      </section>
      <SectionCta
        headline="Add SEO and ads when you want them."
        sub="Same login. Same prepaid balance. No extra subscription."
      />
    </main>
  );
}
