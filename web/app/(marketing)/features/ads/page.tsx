import type { Metadata } from "next";

import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionHeading } from "@/components/marketing/section-heading";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "Paid ads on Google and Meta. Your agent drafts the campaigns. You set the budget and approve the spend.";

export const metadata: Metadata = {
  title: "Ads · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Ads · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/ads" },
};

const POINTS = [
  {
    title: "Draft, do not spend",
    body: "Connecting an ad account lets the agent write campaigns. It cannot spend until you set a budget and say yes.",
  },
  {
    title: "You keep the wallet",
    body: "Pick a daily limit. If a change would go over, it waits for you. Nothing extra gets charged.",
  },
  {
    title: "A record of every try",
    body: "Allowed, blocked, and waiting actions are written down. You can see what the agent asked for, and what actually ran.",
  },
];

export default function AdsServicePage() {
  return (
    <main>
      <FeatureHero
        kicker="Ads"
        lede={DESCRIPTION}
        primary={{ label: "Start creating", href: "/sign-up" }}
        secondary={{ label: "See pricing", href: "/pricing" }}
        titleText="Ads the agent can draft. Money it cannot move."
      />
      <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10">
        <SectionHeading
          description="Paid ads on Google and Meta, with a budget you control."
          title="What the ads service does"
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
        headline="Add content and SEO when you want them."
        sub="Same login. Same prepaid balance. No extra subscription."
      />
    </main>
  );
}
