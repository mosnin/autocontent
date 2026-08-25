import type { Metadata } from "next";

import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionHeading } from "@/components/marketing/section-heading";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "SEO articles from live search research, and an audit that scores the pages you already have.";

export const metadata: Metadata = {
  title: "SEO — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "SEO — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/seo" },
};

const POINTS = [
  {
    title: "Research, then write",
    body: "The outline is built from what already ranks. Sections draft in parallel. QA scores the page before you see it.",
  },
  {
    title: "Ship-ready pages",
    body: "Title, description, Article JSON-LD, and a hero image come with the draft — not as a second project.",
  },
  {
    title: "Audit what is live",
    body: "Point the audit at a URL. You get a weighted score, the evidence, and a recommendation behind every rule.",
  },
];

export default function SeoServicePage() {
  return (
    <main>
      <FeatureHero
        kicker="SEO"
        lede={DESCRIPTION}
        primary={{ label: "Start creating", href: "/sign-up" }}
        secondary={{ label: "See pricing", href: "/pricing" }}
        titleText="Articles that start from the SERP."
      />
      <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10">
        <SectionHeading
          description="This is the SEO line of the business — long-form that can compound while content and ads run beside it."
          title="What the SEO service does"
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
        headline="Run SEO next to content and ads."
        sub="Same login. Same prepaid balance. No extra subscription."
      />
    </main>
  );
}
