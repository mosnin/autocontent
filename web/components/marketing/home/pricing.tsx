import Link from "next/link";
import { SectionHeading } from "@/components/marketing/section-heading";
import { PricingTiles } from "@/components/marketing/resources/pricing-tiles";

export function Pricing() {
  return (
    <section
      id="pricing"
      className="mx-auto max-w-[1440px] scroll-mt-24 px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10"
    >
      <SectionHeading
        title="Start with the work you need to make."
        description="Prepaid credits are available today. Choose a balance, check the estimate before generating, and top up when you need more."
      />
      <div className="mt-14">
        <PricingTiles />
      </div>
      <p className="text-muted-foreground mt-6 max-w-2xl text-sm leading-relaxed">
        Credits pay for generation, including work you choose not to publish.
        Output costs vary by format, model, and length. Ad-platform spend is
        separate.
      </p>
      <Link
        href="/pricing"
        className="focus-ring mt-6 inline-flex underline underline-offset-4"
      >
        Compare credits and upcoming monthly plans
      </Link>
    </section>
  );
}
