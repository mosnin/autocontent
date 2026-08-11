import type { Metadata } from "next";

import { PageHero } from "@/components/marketing/resources/page-hero";
import { QuickstartSteps } from "@/components/marketing/resources/quickstart-steps";
import { SectionCta } from "@/components/marketing/system";
import { MediaCard, Section } from "@/components/site/sections";

const DESCRIPTION =
  "Get from sign-up to a running channel in six steps: describe your channel in one sentence, review voice and caps, approve your first video, and turn on autopilot.";

export const metadata: Metadata = {
  title: "Quickstart — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Quickstart — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/resources/quickstart" },
};

export default function QuickstartPage() {
  return (
    <main>
      <PageHero
        headline="Twenty minutes to a running channel."
        highlight="a running channel."
        kicker="Quickstart"
        sub="Six steps, no configuration files, and the first thing you produce is a real video. Here is the whole path."
        variant="pearl"
      />

      <Section label="Quickstart preview" size="tight">
        <MediaCard
          kind="video"
          label="Quickstart — first short in 10 minutes"
          ratio="16/9"
        />
      </Section>

      <Section label="Setup steps">
        <QuickstartSteps />
      </Section>

      <SectionCta
        headline="Your first video costs about fifty cents."
        kicker="Get started"
        primaryHref="/sign-up"
        primaryLabel="Start step one"
        secondaryHref="/resources/guides/first-channel"
        secondaryLabel="Read the full guide"
        sub="No subscription, no trial clock. If the first render isn't good, that is all you spent, and you approved nothing."
      />
    </main>
  );
}
