import type { Metadata } from "next";

import { SectionCta } from "@/components/marketing/system";
import { LocalWeekMock } from "@/components/marketing/use-cases/mocks/local-week";
import {
  MockBand,
  OutcomesBand,
  PainBand,
  StepsBand,
  UseCaseHero,
} from "@/components/marketing/use-cases/template";

const DESCRIPTION =
  "Show up in local search and on social every week without a marketing hire. A plain-language brief, one weekly review, and spend capped in plain dollars.";

export const metadata: Metadata = {
  title: "Local business — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Local business — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/use-cases/local-business" },
};

export default function LocalBusinessPage() {
  return (
    <main>
      <UseCaseHero
        headline={["Show up every week.", "Stay behind the counter."]}
        kicker="For local businesses"
        lede="A few good posts a week and an article people find when they search your town. Written from a brief in your own words, reviewed by you in minutes."
        scene="daylight"
      />
      <PainBand
        heading="Marketing happens after close."
        lede="You already have a full-time job. It's the business."
        pains={[
          {
            title: "The 9 p.m. posting shift",
            copy: "Content gets made after the doors lock, which means it gets made until the first busy week, then never again.",
          },
          {
            title: "Agencies cost like payroll",
            copy: "A retainer that rivals a part-time wage, for posts that could be about any shop in any town.",
          },
          {
            title: "Invisible in your own zip code",
            copy: "Someone two streets over searches for what you sell and finds a chain, a directory, and a competitor.",
          },
        ]}
      />
      <StepsBand
        heading="Describe the shop. Approve the week."
        steps={[
          {
            title: "Say it in your words",
            copy: "What you sell, who walks in, what makes you the good one on the block. No marketing speak required.",
          },
          {
            title: "The week gets built",
            copy: "A few shorts for social and a search-friendly article about your specialty, scheduled across the week, capped in dollars a day.",
          },
          {
            title: "Glance, approve, done",
            copy: "Everything waits for your okay. One look on Sunday evening covers the whole week.",
          },
        ]}
      />
      <MockBand
        bullets={[
          "A weekly cadence that holds through busy season",
          "Posts about your shop, not a generic template",
          "One approval covers the week ahead",
        ]}
        heading="The week, at a glance."
        kicker="The product moment"
        lede="Harbor Coffee's week: two shorts, one article for people searching nearby, all approved in a single Sunday review."
        scene="daylight"
      >
        <LocalWeekMock />
      </MockBand>
      <OutcomesBand
        heading="Present all week, for pocket change."
        stats={[
          { value: 7, label: "days covered by one Sunday review" },
          { value: 1, label: "brief, written in plain language" },
          {
            value: 5,
            prefix: "$",
            label: "where prepaid credit packs start",
          },
        ]}
      />
      <SectionCta
        headline="Be findable by Friday."
        kicker="Get started"
        primaryLabel="Start creating"
        sub="Describe your shop tonight, cap it at a couple dollars a day, and approve your first week this weekend."
      />
    </main>
  );
}
