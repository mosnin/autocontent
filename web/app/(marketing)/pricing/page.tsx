import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/marketing/resources/page-hero";
import { PricingTiles } from "@/components/marketing/resources/pricing-tiles";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { SectionCta } from "@/components/marketing/system";
const description =
  "Start with prepaid generation credits from $5. Explore proposed monthly plans with included credits for a growing content program.";
export const metadata: Metadata = {
  title: "Pricing · marketer.sh",
  description,
  alternates: { canonical: "https://marketer.sh/pricing" },
  openGraph: { title: "Pricing · marketer.sh", description },
};
const questions = [
  [
    "What can I buy today?",
    "Prepaid credit packs of $5, $20, or $50. They differ in balance, not feature access. The monthly plans below are a proposal and cannot be purchased yet.",
  ],
  [
    "How much does a video cost?",
    "The estimate depends on the model, number of scenes, duration, image quality, voice, and music. Check the estimate in the app before starting. A credit pack does not promise a fixed number of videos.",
  ],
  [
    "Am I charged only when I publish?",
    "No. Generation uses paid services and consumes credit, including drafts you reject. A failed run may have completed paid steps. Review the usage history for actual charges.",
  ],
  [
    "What happens if I run out?",
    "You need enough balance for the next estimated operation. Add credit when you choose to continue. Check your channel and account budgets if a job is paused or refused.",
  ],
  [
    "Does this include my ad budget?",
    "No. Google and Meta media spend is separate from Marketer generation credits. Review both budgets before authorizing a campaign.",
  ],
  [
    "Will existing customers lose access?",
    "The current prepaid catalog and feature access are unchanged. Any future subscription migration needs separate notice and terms; the proposed limits do not apply to your current account.",
  ],
];
export default function PricingPage() {
  return (
    <main>
      <PageHero
        headline="Choose a budget before you create."
        kicker="Pricing"
        size="xl"
        sub="Start with prepaid credits today. Explore monthly plans for a more regular publishing routine."
      />
      <section
        id="prepaid"
        className="mx-auto max-w-[1440px] px-5 pb-20 sm:px-8 lg:px-10"
      >
        <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h2 className="text-3xl font-medium tracking-tight">
              Prepaid credits. Available now.
            </h2>
            <p className="text-muted-foreground mt-4 max-w-xl leading-relaxed">
              One-time USD purchases with no subscription. Create an account,
              then choose your pack in Billing.
            </p>
          </div>
          <Link
            href="#monthly-plans"
            className="focus-ring underline underline-offset-4"
          >
            Explore monthly plans
          </Link>
        </div>
        <PricingTiles />
        <p className="text-muted-foreground mt-6 max-w-3xl text-sm leading-relaxed">
          Generation charges use your balance as work runs. Credits do not
          promise a particular output count. Review the estimate before
          generating and the actual cost afterward. Purchased credits do not
          expire under the current terms.
        </p>
      </section>
      <PricingPlans />
      <section className="mx-auto grid max-w-[1440px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:px-10">
        <h2 className="text-3xl font-medium tracking-tight sm:text-5xl">
          Know what you’re paying for.
        </h2>
        <div>
          {questions.map(([q, a]) => (
            <details
              key={q}
              className="border-border border-t py-6 last:border-b"
            >
              <summary className="focus-ring cursor-pointer text-lg font-medium">
                {q}
              </summary>
              <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
                {a}
              </p>
            </details>
          ))}
          <p className="text-muted-foreground mt-8 text-sm">
            Read the{" "}
            <Link className="underline underline-offset-4" href="/legal/refund">
              refund policy
            </Link>{" "}
            and{" "}
            <Link className="underline underline-offset-4" href="/legal/terms">
              current terms
            </Link>{" "}
            before purchasing.
          </p>
        </div>
      </section>
      <SectionCta
        headline="Start with one piece of content."
        sub="Use a small prepaid balance to evaluate the workflow and the result before committing to a larger program."
      />
    </main>
  );
}
