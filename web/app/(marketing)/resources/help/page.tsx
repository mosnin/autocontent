import Link from "next/link";
import { PageHero } from "@/components/marketing/resources/page-hero";
export const metadata = {
  title: "Help center · marketer.sh",
  description:
    "Find help with setup, credits, review, publishing, and connected agents.",
  alternates: { canonical: "https://marketer.sh/resources/help" },
};
const help = [
  [
    "Set up a channel",
    "Define a brief, choose settings, and review the first run.",
    "/resources/guides/first-channel",
  ],
  [
    "Understand a charge",
    "Review estimates, generation usage, and current credit terms.",
    "/pricing",
  ],
  [
    "Review before publishing",
    "Check facts, creative details, and the destination.",
    "/resources/guides/review-checklist",
  ],
  [
    "Connect an agent",
    "Plan credentials, permissions, budgets, and job recovery.",
    "/resources/api",
  ],
  [
    "Read common questions",
    "Learn what is included and what you need to provide.",
    "/resources/faq",
  ],
  [
    "Get help with a problem",
    "Include the job ID and the error. Never send passwords or API keys.",
    "/contact",
  ],
];
export default function Page() {
  return (
    <main>
      <PageHero
        kicker="Help"
        headline="Find the next step when you need it."
        sub="Start with the task you are trying to complete. If a job stops, read its status and billing history before retrying."
      />
      <section className="mx-auto grid max-w-[1440px] gap-5 px-5 pb-24 sm:grid-cols-2 sm:px-8 lg:grid-cols-3 lg:px-10">
        {help.map(([title, body, href]) => (
          <Link
            href={href}
            key={href}
            className="focus-ring border-border rounded-3xl border p-8 hover:bg-muted"
          >
            <h2 className="text-xl font-medium">{title}</h2>
            <p className="text-muted-foreground mt-4 leading-relaxed">{body}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
