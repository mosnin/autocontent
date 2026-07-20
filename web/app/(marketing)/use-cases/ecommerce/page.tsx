import type { Metadata } from "next";

import { SectionCta } from "@/components/marketing/system";
import { EcommerceArticleMock } from "@/components/marketing/use-cases/mocks/ecommerce-article";
import {
  MockBand,
  OutcomesBand,
  PainBand,
  StepsBand,
  UseCaseHero,
} from "@/components/marketing/use-cases/template";

const DESCRIPTION =
  "Give every product line its own channel: hook-driven demo shorts plus SEO buying guides that rank, produced from one brief under hard daily spend caps.";

export const metadata: Metadata = {
  title: "Ecommerce — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Ecommerce — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/use-cases/ecommerce" },
};

export default function EcommercePage() {
  return (
    <main>
      <UseCaseHero
        headline={["Every product,", "its own channel."]}
        kicker="For ecommerce"
        lede="One niche per product line. Hook-driven demo shorts for the feed, buying guides that rank for the search, both from the brief you already wrote for the listing."
        placeholderLabel="Ecommerce teams in the product — hero still"
        placeholderTone="rose"
        scene="mint"
      />
      <PainBand
        heading="Product pages don't sell themselves."
        lede="The listing is live. The traffic isn't coming."
        pains={[
          {
            title: "Rankings go to publishers",
            copy: "The buying-guide results for your own category belong to affiliate sites. Your product page alone will not outrank them.",
          },
          {
            title: "Every demo is a shoot",
            copy: "Short-form product video works, but a shoot per SKU per week doesn't survive contact with a real catalog.",
          },
          {
            title: "Content stops after launch",
            copy: "Week one gets the push. By week four the product line is invisible again, and the next launch takes the budget.",
          },
        ]}
      />
      <StepsBand
        heading="One brief per line. Both formats, weekly."
        steps={[
          {
            title: "Brief the product line",
            copy: "What it is, who buys it, what beats it. Each line gets its own niche with its own daily cap.",
          },
          {
            title: "Demos and guides ship together",
            copy: "Hook-first demo shorts for TikTok and Reels. SERP-researched buying guides with clean metadata, JSON-LD, and a hero image.",
          },
          {
            title: "Winners get siblings",
            copy: "Performance feeds the next ideation round. The hook that held attention becomes a family of variants, not a lucky one-off.",
          },
        ]}
      />
      <MockBand
        bullets={[
          "SERP research first, so the outline matches what ranks",
          "Sections written in parallel, then a QA pass",
          "Slug, title, meta, and Product JSON-LD handled",
        ]}
        flip
        heading="A buying guide, built to rank."
        kicker="The product moment"
        lede="This is a finished article for a grinder line: search preview, metadata within limits, structured data attached. Ready when you are."
        scene="mint"
      >
        <EcommerceArticleMock />
      </MockBand>
      <OutcomesBand
        heading="A catalog that markets itself."
        stats={[
          { value: 2, label: "formats from every product brief" },
          { value: 1, label: "niche and daily cap per product line" },
          {
            value: 0,
            prefix: "$",
            label: "spent past the cap you set, ever",
          },
        ]}
      />
      <SectionCta
        headline="Point it at your best seller first."
        kicker="Get started"
        sub="Brief one product line, cap it at a few dollars a day, and watch a week of demos and guides show up for review."
      />
    </main>
  );
}
