import * as React from "react";

import { CtaPill } from "@/components/marketing/system";
import { SectionHeading } from "@/components/marketing/section-heading";

type Service = {
  title: string;
  href: string;
  lede: string;
  points: string[];
};

const SERVICES: Service[] = [
  {
    title: "Content",
    href: "/features/content",
    lede: "Short-form video for TikTok, Reels, and Shorts. One brief in: script, frames, voice, captions, QA, publish.",
    points: [
      "Vertical video from a brief, not a timeline",
      "Publish on a calendar you set",
      "Every render metered against your cap",
    ],
  },
  {
    title: "SEO",
    href: "/features/seo",
    lede: "Long-form articles from live search research, plus an audit that scores the pages you already have.",
    points: [
      "Outline from what already ranks",
      "Metadata, JSON-LD, and a hero with every draft",
      "Audit a URL and feed the next article",
    ],
  },
  {
    title: "Ads",
    href: "/features/ads",
    lede: "Paid campaigns on Google and Meta. Agents can draft and adjust. Hard budgets refuse spend that would overrun.",
    points: [
      "Connect the ad accounts you already have",
      "Approvals before money moves",
      "Same prepaid balance as content and SEO",
    ],
  },
];

export function FeatureIndex() {
  return (
    <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10">
      <SectionHeading
        description="Three products. One login, one ledger, one prepaid balance."
        title="The business"
      />
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {SERVICES.map((service) => (
          <article
            className="border-border flex flex-col rounded-3xl border p-7 sm:p-8"
            key={service.href}
          >
            <h3 className="text-foreground text-2xl font-medium tracking-tight">
              {service.title}
            </h3>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              {service.lede}
            </p>
            <ul className="text-foreground mt-8 flex-1 space-y-3 text-sm leading-relaxed">
              {service.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <CtaPill className="mt-8 self-start" href={service.href}>
              See {service.title}
            </CtaPill>
          </article>
        ))}
      </div>
    </section>
  );
}

export function SharedSpine() {
  return (
    <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10">
      <SectionHeading
        description="Content and SEO share a cap, a review gate, and a prepaid balance. Turning on another line does not add a subscription."
        title="One system underneath"
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "One ledger",
            copy: "Every render and every article is metered as it happens. You see the cost before and after.",
          },
          {
            title: "One set of caps",
            copy: "A daily cap per niche and a global cap over everything. Work that would cross a limit is refused, not billed.",
          },
          {
            title: "One balance",
            copy: "Prepaid credit from $5. No seats, no renewal. Credits do not expire.",
          },
        ].map((item) => (
          <article
            className="border-border rounded-3xl border p-7"
            key={item.title}
          >
            <h3 className="text-foreground text-lg font-medium tracking-tight">
              {item.title}
            </h3>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              {item.copy}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function HubStats() {
  return (
    <section className="mx-auto max-w-[1440px] px-5 pb-16 sm:px-8 lg:px-10">
      <dl className="border-border grid gap-6 rounded-3xl border px-8 py-10 sm:grid-cols-3">
        {[
          { value: "3", label: "services: content, SEO, ads" },
          { value: "$5", label: "smallest prepaid pack" },
          { value: "$0", label: "allowed past a tripped cap" },
        ].map((stat) => (
          <div key={stat.label}>
            <dt className="text-muted-foreground text-sm">{stat.label}</dt>
            <dd className="text-foreground mt-2 text-4xl font-medium tracking-tight">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
