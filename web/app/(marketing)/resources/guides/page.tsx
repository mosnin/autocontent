import Link from "next/link";
import guides from "@/lib/marketing/guides.json";
import { PageHero } from "@/components/marketing/resources/page-hero";
export const metadata = {
  title: "Content production guides · marketer.sh",
  description:
    "Prepare a brief, review a draft, plan usage, and build a publishing routine.",
  alternates: { canonical: "https://marketer.sh/resources/guides" },
};
export default function Page() {
  return (
    <main>
      <PageHero
        kicker="Guides"
        headline="Make the next piece easier to get right."
        sub="Practical guidance for the work before generation and the decisions after it."
      />
      <section className="mx-auto grid max-w-[1440px] gap-5 px-5 pb-24 sm:grid-cols-2 sm:px-8 lg:grid-cols-3 lg:px-10">
        {Object.entries(guides).map(([slug, g]) => (
          <Link
            key={slug}
            href={`/resources/guides/${slug}`}
            className="focus-ring border-border rounded-3xl border p-8 transition-colors hover:bg-muted"
          >
            <h2 className="text-2xl font-medium tracking-tight">{g.title}</h2>
            <p className="text-muted-foreground mt-5 leading-relaxed">
              {g.description}
            </p>
            <p className="mt-8 text-sm underline underline-offset-4">
              Read guide
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}
