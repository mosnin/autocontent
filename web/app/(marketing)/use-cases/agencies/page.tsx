import type { Metadata } from "next";

import { SectionCta, TaggedPlaceholder } from "@/components/marketing/system";
import {
  MockBand,
  OutcomesBand,
  PainBand,
  StepsBand,
  UseCaseHero,
} from "@/components/marketing/use-cases/template";

const DESCRIPTION =
  "Run every client as its own niche, with per-niche daily caps, approval gates per client, and a spend ledger that turns month-end billing into an export.";

export const metadata: Metadata = {
  title: "Agencies — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Agencies — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/use-cases/agencies" },
};

export default function AgenciesPage() {
  return (
    <main>
      <UseCaseHero
        headline={["Every client, run like", "your only client."]}
        kicker="For agencies"
        lede="One niche per client. Its own brief, its own daily cap, its own approval gate, its own line in the ledger. Ten accounts feel like one."
        placeholderLabel="Agencies in the product — hero still"
        placeholderTone="violet"
        scene="steel"
      />
      <PainBand
        heading="Ten clients, ten fires."
        lede="The work scales linearly. The margin doesn't."
        pains={[
          {
            title: "A tool stack per client",
            copy: "Scheduler here, writer there, editor somewhere else, per account. Onboarding a client means onboarding five logins.",
          },
          {
            title: "Budgets bleed sideways",
            copy: "One client's overrun quietly eats another's retainer, and you find out during the month-end scramble.",
          },
          {
            title: "Billing is archaeology",
            copy: "Reconstructing who spent what across tools and cards takes a day you don't bill for.",
          },
        ]}
      />
      <StepsBand
        heading="One niche per client. Walls included."
        steps={[
          {
            title: "Spin up a niche per client",
            copy: "Brief, voice, and channels per account. Clients stay cleanly separated by construction, not by discipline.",
          },
          {
            title: "Cap and gate each one",
            copy: "A daily cap per niche and a global cap over everything. Approval gates per client, strict for new ones, open for trusted ones.",
          },
          {
            title: "Bill from the ledger",
            copy: "Every render and post is logged against its niche. Month-end is an export, not an investigation.",
          },
        ]}
      />
      <MockBand
        bullets={[
          "Per-niche daily caps, so budgets cannot bleed across clients",
          "A global cap over the whole book of business",
          "Per-client spend ledger, exportable for billing",
        ]}
        flip
        heading="The whole book, one card."
        kicker="The product moment"
        lede="Three clients, three caps, three gates. The dental account runs strict, the yoga studio earned autopilot, and nothing can pass its cap."
        scene="steel"
      >
        <div className="aspect-[4/3] w-full max-w-md overflow-hidden rounded-[1.75rem] border border-zinc-900/[0.06] shadow-[0_16px_50px_rgba(15,23,42,0.10)]">
          <TaggedPlaceholder
            kind="image"
            label="Agencies workflow — screenshot"
            tone="violet"
          />
        </div>
      </MockBand>
      <OutcomesBand
        heading="Margin that survives client ten."
        stats={[
          { value: 2, label: "cap layers: per niche and global" },
          { value: 1, label: "ledger line per client, export-ready" },
          {
            value: 0,
            prefix: "$",
            label: "of one client's budget spendable on another",
          },
        ]}
      />
      <SectionCta
        headline="Onboard the next client in an afternoon."
        kicker="Get started"
        sub="Create a niche, paste the brief, set the cap and the gate. That's the whole setup."
      />
    </main>
  );
}
