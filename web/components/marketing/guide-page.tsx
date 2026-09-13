import Link from "next/link";
import { PageHero } from "./resources/page-hero";
import { SectionCta } from "./system";
export type Guide = {
  title: string;
  description: string;
  sections: { title: string; body: string[] }[];
};
export function GuidePage({ guide }: { guide: Guide }) {
  return (
    <main>
      <PageHero kicker="Guide" headline={guide.title} sub={guide.description} />
      <div className="mx-auto grid max-w-[1440px] gap-12 px-5 pb-24 sm:px-8 lg:grid-cols-[240px_1fr] lg:px-10">
        <aside>
          <nav aria-label="On this page" className="lg:sticky lg:top-28">
            <p className="font-medium">On this page</p>
            <ul className="mt-5 space-y-3">
              {guide.sections.map((s, i) => (
                <li key={s.title}>
                  <a
                    href={`#section-${i}`}
                    className="focus-ring text-muted-foreground text-sm underline-offset-4 hover:underline"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
            <Link
              href="/resources/guides"
              className="focus-ring mt-8 inline-block text-sm underline underline-offset-4"
            >
              All guides
            </Link>
          </nav>
        </aside>
        <article className="max-w-3xl">
          {guide.sections.map((s, i) => (
            <section
              key={s.title}
              id={`section-${i}`}
              className="mb-12 scroll-mt-28"
            >
              <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
                {s.title}
              </h2>
              {s.body.map((p) => (
                <p
                  key={p}
                  className="text-muted-foreground mt-5 text-base leading-8"
                >
                  {p}
                </p>
              ))}
            </section>
          ))}
        </article>
      </div>
      <SectionCta
        headline="Put the next step into practice."
        sub="Start with a focused brief and one piece of content you can evaluate."
      />
    </main>
  );
}
