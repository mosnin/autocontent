import type { Metadata } from "next";

import { FaqAccordion } from "@/components/marketing/resources/faq-accordion";
import { FAQ_ITEMS } from "@/components/marketing/resources/faq-data";
import { PageHero } from "@/components/marketing/resources/page-hero";
import { SectionCta } from "@/components/marketing/system";

const DESCRIPTION =
  "Straight answers about marketer.sh: how spend caps work, what happens at the limit, approval gates, supported platforms, content ownership, refunds, and data handling.";

export const metadata: Metadata = {
  title: "FAQ — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "FAQ — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/resources/faq" },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function FaqPage() {
  return (
    <main>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        type="application/ld+json"
      />
      <PageHero
        headline="Questions, answered plainly."
        kicker="FAQ"
        sub="The things people actually ask before handing marketing to a machine: money, control, ownership, and what happens at the limits."
        variant="pearl"
      />

      <section
        aria-label="Frequently asked questions"
        className="mx-auto max-w-3xl px-6 py-24 md:py-32"
      >
        <FaqAccordion items={FAQ_ITEMS} />
      </section>

      <SectionCta
        headline="Still curious? Run it on five dollars."
        kicker="Get started"
        primaryHref="/sign-up"
        primaryLabel="Start creating"
        secondaryHref="/pricing"
        secondaryLabel="See pricing"
        sub="The Starter pack answers most questions better than we can: roughly 8 to 12 videos, every feature included, nothing publishes without you."
      />
    </main>
  );
}
