import Link from "next/link";
import stories from "@/lib/marketing/stories.json";
import { PageHero } from "@/components/marketing/resources/page-hero";
import { SectionCta } from "@/components/marketing/system";
export const metadata = {
  title: "Features · marketer.sh",
  description:
    "Explore the production workflows, review tools, and publishing steps that connect a brief to a finished piece.",
  alternates: { canonical: "https://marketer.sh/features" },
};
export default function Page() {
  return (
    <main>
      <PageHero
        kicker="Marketer"
        headline="Choose the content your audience needs."
        sub="Explore the production workflows, review tools, and publishing steps that connect a brief to a finished piece."
      />
      <section className="mx-auto grid max-w-[1440px] gap-5 px-5 pb-24 sm:grid-cols-2 sm:px-8 lg:grid-cols-3 lg:px-10">
        {Object.entries(stories)
          .filter(([route]) => route.startsWith("/features/"))
          .map(([route, s]) => (
            <Link
              key={route}
              href={route}
              className="focus-ring border-border rounded-3xl border p-8 transition-colors hover:bg-muted"
            >
              <h2 className="text-2xl font-medium tracking-tight">{s.title}</h2>
              <p className="text-muted-foreground mt-5 leading-relaxed">
                {s.description}
              </p>
              <p className="mt-8 text-sm underline underline-offset-4">
                Explore workflow
              </p>
            </Link>
          ))}
      </section>
      <SectionCta />
    </main>
  );
}
