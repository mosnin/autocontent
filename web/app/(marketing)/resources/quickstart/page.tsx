import type { Metadata } from "next";

import { PageHero } from "@/components/marketing/resources/page-hero";
import { QuickstartSteps } from "@/components/marketing/resources/quickstart-steps";
import { SectionCta, TaggedPlaceholder } from "@/components/marketing/system";

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
        kicker="Quickstart"
        sub="Six steps, no configuration files, and the first thing you produce is a real video. Here is the whole path."
        variant="pearl"
      />

      <section aria-label="Quickstart preview" className="mx-auto max-w-4xl px-6 pt-16 md:pt-20">
        <div className="aspect-video overflow-hidden rounded-[2rem] border border-zinc-900/[0.06] shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
          <TaggedPlaceholder
            className="h-full w-full"
            kind="video"
            label="Quickstart — first short in 10 minutes"
            tone="sky"
          />
        </div>
      </section>

      <section
        aria-label="Setup steps"
        className="mx-auto max-w-6xl px-6 py-24 md:py-32"
      >
        <QuickstartSteps />
      </section>

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
