import { PageHero } from "@/components/marketing/resources/page-hero";
import { ContactForm } from "@/components/marketing/contact-form";
export const metadata = {
  title: "Request a demo · marketer.sh",
  description:
    "Discuss your content workflow and request a Marketer walkthrough.",
  alternates: { canonical: "https://marketer.sh/demo" },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  const selected = ["launch", "grow", "scale"].includes(plan || "")
    ? plan
    : undefined;
  return (
    <main>
      <PageHero
        kicker="Demo"
        headline="See how your workflow would fit."
        sub="Tell us what you want to create and where the work gets stuck. Request a walkthrough around your use case."
      />
      <section className="mx-auto grid max-w-[1440px] gap-12 px-5 pb-24 sm:px-8 lg:grid-cols-2 lg:px-10">
        <div>
          <h2 className="text-2xl font-medium tracking-tight">
            Bring a real content task.
          </h2>
          <p className="text-muted-foreground mt-5 max-w-lg leading-relaxed">
            We can discuss your brief, the formats you need, the review process,
            and the cost considerations. Include the product and the first piece
            you want to make.
          </p>
          <p className="text-muted-foreground mt-5 max-w-lg leading-relaxed">
            This form prepares a message in your email app. You still need to
            send it. A demo time is confirmed separately; submitting a request
            does not book a calendar slot.
          </p>
          {selected && (
            <p className="mt-5 font-medium">
              You’re asking about the proposed{" "}
              {selected.charAt(0).toUpperCase() + selected.slice(1)} plan.
            </p>
          )}
        </div>
        <ContactForm
          initialReason="Demo request"
          initialMessage={
            selected
              ? `I would like to discuss the proposed ${selected} plan. My content workflow is: `
              : ""
          }
        />
      </section>
    </main>
  );
}
