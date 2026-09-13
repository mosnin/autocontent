import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { FeatureHero } from "./features/feature-hero";
import { SectionHeading } from "./section-heading";
import { Reveal, SectionCta } from "./system";
import { CAMPAIGN_IMAGES } from "@/lib/marketing/campaign-media";

export type Story = {
  title: string;
  description: string;
  image: number;
  problem: string;
  context: string;
  benefits: { title: string; body: string }[];
  steps: { title: string; body: string }[];
  fit: string;
  check: string;
  links: { title: string; href: string; body: string }[];
};
export function storyMetadata(story: Story, route: string): Metadata {
  return {
    title: `${story.title} · marketer.sh`,
    description: story.description,
    alternates: { canonical: `https://marketer.sh${route}` },
    openGraph: { title: story.title, description: story.description },
  };
}
export function StoryPage({ story }: { story: Story }) {
  const art = CAMPAIGN_IMAGES[story.image % CAMPAIGN_IMAGES.length];
  return (
    <main>
      <FeatureHero
        kicker="Marketer"
        titleText={story.title}
        lede={story.description}
        illustration={
          art && (
            <figure>
              <Image
                src={art.src}
                alt={art.alt}
                width={900}
                height={1000}
                priority
                unoptimized
                className="aspect-[5/4] w-full object-cover"
              />
              <figcaption className="bg-background px-5 py-3 text-xs text-muted-foreground">
                Illustrative campaign artwork from the Marketer collection.
              </figcaption>
            </figure>
          )
        }
      />
      <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10">
        <SectionHeading title={story.problem} description={story.context} />
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {story.benefits.map((item) => (
            <Reveal key={item.title}>
              <div className="border-border border-t pt-6">
                <h3 className="text-xl font-medium tracking-tight">
                  {item.title}
                </h3>
                <p className="text-muted-foreground mt-4 text-base leading-relaxed">
                  {item.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
      <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 lg:px-10">
        <div className="rounded-[40px] bg-muted px-6 py-14 sm:px-12 sm:py-20">
          <h2 className="max-w-2xl text-3xl font-medium tracking-tight sm:text-5xl">
            What the work looks like.
          </h2>
          <ol className="mt-12 grid gap-10 md:grid-cols-3">
            {story.steps.map((step, i) => (
              <li key={step.title}>
                <span className="text-foreground/75 font-mono text-xs">
                  0{i + 1}
                </span>
                <h3 className="mt-5 text-xl font-medium">{step.title}</h3>
                <p className="text-foreground/75 mt-4 leading-relaxed">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="mx-auto grid max-w-[1440px] gap-12 px-5 pb-24 sm:px-8 lg:grid-cols-2 lg:px-10">
        <div>
          <h2 className="text-2xl font-medium tracking-tight">
            When this is a good fit.
          </h2>
          <p className="text-muted-foreground mt-5 max-w-xl leading-relaxed">
            {story.fit}
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-medium tracking-tight">
            What to check before you start.
          </h2>
          <p className="text-muted-foreground mt-5 max-w-xl leading-relaxed">
            {story.check}
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 lg:px-10">
        <h2 className="text-2xl font-medium tracking-tight">
          Plan your next step.
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {story.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="focus-ring border-border rounded-3xl border p-7 transition-colors hover:bg-muted"
            >
              <h3 className="font-medium">{link.title}</h3>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {link.body}
              </p>
            </Link>
          ))}
        </div>
      </section>
      <SectionCta
        headline="Bring one brief. See what you can make."
        sub="Start with a piece of content you need, review the estimate, and judge the result against your own standards."
      />
    </main>
  );
}
