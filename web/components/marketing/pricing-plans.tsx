import Link from "next/link";
import { PROPOSED_PLANS } from "./pricing-data";
import { Reveal } from "./system";
export function PricingPlans() {
  return (
    <section
      id="monthly-plans"
      className="mx-auto max-w-[1440px] scroll-mt-28 px-5 py-20 sm:px-8 lg:px-10"
    >
      <div className="max-w-2xl">
        <h2 className="text-3xl font-medium tracking-tight sm:text-5xl">
          A monthly plan for the way you work.
        </h2>
        <p className="text-muted-foreground mt-6 leading-relaxed">
          We’re developing plans that combine platform access with a monthly
          generation allowance. These proposed plans are not available to
          purchase yet. Prepaid credits remain available today.
        </p>
      </div>
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {PROPOSED_PLANS.map((plan) => (
          <Reveal key={plan.name} className="h-full">
            <article
              className="border-border flex h-full flex-col rounded-3xl border p-7 sm:p-8"
              style={
                plan.name === "Grow"
                  ? {
                      backgroundColor: "var(--surface)",
                      color: "var(--surface-foreground)",
                    }
                  : undefined
              }
            >
              <h3 className="text-xl font-medium">{plan.name}</h3>
              <p className="mt-3 text-sm leading-relaxed opacity-75">
                {plan.audience}
              </p>
              <p className="mt-8">
                <span className="text-5xl font-medium tracking-tight">
                  ${plan.price}
                </span>
                <span className="ml-2 text-sm opacity-75">USD / month</span>
              </p>
              <p className="mt-4 text-lg font-medium">
                ${plan.credit} in generation credits included
              </p>
              <p className="mt-2 text-sm opacity-75">
                {plan.channels} active content{" "}
                {plan.channels === 1 ? "channel" : "channels"}
              </p>
              <ul className="mt-8 flex-1 space-y-3 text-sm leading-relaxed">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link
                href={`/demo?plan=${plan.name.toLowerCase()}`}
                className="focus-ring mt-9 inline-flex min-h-12 items-center justify-center rounded-full border border-current/30 px-5 text-sm font-medium"
              >
                Discuss {plan.name}
              </Link>
            </article>
          </Reveal>
        ))}
      </div>
      <div className="mt-10 grid gap-8 border-t border-border pt-8 md:grid-cols-3">
        <div>
          <h3 className="font-medium">Understand your credits</h3>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            $1 of credit covers $1 of metered generation charges. A channel is a
            saved content brief with its own voice and schedule, not a separate
            team workspace.
          </p>
        </div>
        <div>
          <h3 className="font-medium">Control additional usage</h3>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            The proposed model uses optional prepaid top-ups after the allowance
            runs out. No automatic overage charges. Advertising spend stays with
            your ad platform.
          </p>
        </div>
        <div>
          <h3 className="font-medium">Know the proposed terms</h3>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Monthly billing. Included credits reset each billing month;
            purchased top-ups keep their existing terms. Cancel renewal for the
            next period. Taxes, if applicable, are additional. Final terms will
            be shown before purchase.
          </p>
        </div>
      </div>
    </section>
  );
}
