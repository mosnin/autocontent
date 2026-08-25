import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionHeading } from "@/components/marketing/section-heading";
import { SectionCta } from "@/components/marketing/system";
import { getService, type Service } from "@/lib/marketing/services";

export function serviceMetadata(slug: string): Metadata {
  const service = getService(slug);
  if (!service) return {};
  return {
    title: `${service.metaTitle} — marketer.sh`,
    description: service.description,
    openGraph: {
      title: `${service.metaTitle} — marketer.sh`,
      description: service.description,
      type: "website",
    },
    alternates: { canonical: `https://marketer.sh/features/${service.slug}` },
  };
}

export function ServicePage({
  slug,
  service,
}: {
  slug?: string;
  service?: Service;
}) {
  const resolved = service ?? (slug ? getService(slug) : undefined);
  if (!resolved) notFound();

  return (
    <main>
      <FeatureHero
        kicker={resolved.metaTitle}
        lede={resolved.lede}
        primary={{ label: "Start creating", href: "/sign-up" }}
        secondary={{ label: "Open in the app", href: resolved.appHref }}
        titleText={resolved.title}
      />

      <section className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10">
        <SectionHeading
          description={resolved.description}
          title="What you get"
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {resolved.points.map((point) => (
            <article
              className="border-border rounded-3xl border p-7"
              key={point.title}
            >
              <h3 className="text-foreground text-lg font-medium tracking-tight">
                {point.title}
              </h3>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {point.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <SectionCta
        headline="Turn it on with the rest of the suite."
        sub="Every surface shares one ledger, one set of caps, and one prepaid balance. No extra subscription."
      />
    </main>
  );
}
