import type { Metadata } from "next";
import Link from "next/link";

const DESCRIPTION =
  "Documentation for marketer.sh. How to start, how credits work, and how to call the API.";

export const metadata: Metadata = {
  title: "Documentation · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Documentation · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/docs" },
};

const DOCS = [
  {
    group: "Start here",
    items: [
      {
        title: "Quickstart",
        href: "/resources/quickstart",
        copy: "Create an account, write one sentence, and see the first draft.",
      },
      {
        title: "Launch a channel",
        href: "/resources/guides/first-channel",
        copy: "Pick a niche, set a voice, and decide what you want to approve.",
      },
    ],
  },
  {
    group: "How the work gets made",
    items: [
      {
        title: "Content",
        href: "/features/content",
        copy: "Short videos from a brief. Script, pictures, voice, captions, post.",
      },
      {
        title: "SEO articles",
        href: "/resources/guides/seo-articles",
        copy: "How articles get researched, written, and checked before you see them.",
      },
      {
        title: "Ads",
        href: "/features/ads",
        copy: "Draft Google and Meta ads with a budget you set.",
      },
      {
        title: "Let an agent run it",
        href: "/resources/guides/agent-driven-marketing",
        copy: "Hand the work to an agent, with a spend cap so it cannot run wild.",
      },
    ],
  },
  {
    group: "For developers",
    items: [
      {
        title: "API",
        href: "/resources/api",
        copy: "REST, Python SDK, CLI, and MCP. Same rules as the dashboard.",
      },
    ],
  },
  {
    group: "Also useful",
    items: [
      {
        title: "FAQ",
        href: "/resources/faq",
        copy: "Credits, approvals, platforms, and who owns the work.",
      },
      {
        title: "Changelog",
        href: "/resources/changelog",
        copy: "What shipped, newest first.",
      },
      {
        title: "Pricing",
        href: "/pricing",
        copy: "Prepaid packs from five dollars. No subscription.",
      },
    ],
  },
];

export default function DocsPage() {
  let number = 0;

  return (
    <main>
      <section className="border-border border-b">
        <div className="mx-auto max-w-[1440px] px-5 pt-28 pb-16 sm:px-8 sm:pt-36 lg:px-10">
          <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
            Documentation
          </p>
          <h1 className="text-foreground mt-5 max-w-2xl text-[clamp(40px,6vw,72px)] leading-[1.02] font-medium tracking-tight">
            How to use marketer.sh.
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed">
            Short pages. No jargon if we can help it. Start with the
            quickstart, then pick the job you want: videos, articles, or ads.
          </p>
        </div>
      </section>

      {DOCS.map((section) => (
        <section
          key={section.group}
          className="border-border border-b last:border-b-0"
        >
          <div className="mx-auto grid max-w-[1440px] gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-10">
            <h2 className="text-muted-foreground pt-2 text-[11px] font-medium tracking-wider uppercase">
              {section.group}
            </h2>
            <ul className="divide-border divide-y">
              {section.items.map((item) => {
                number += 1;
                const n = String(number).padStart(2, "0");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="focus-ring hover:bg-muted -mx-4 flex items-baseline gap-6 rounded-2xl px-4 py-6 transition-colors"
                    >
                      <span className="text-muted-foreground w-8 shrink-0 font-mono text-xs">
                        {n}
                      </span>
                      <span>
                        <span className="text-foreground block text-xl font-medium tracking-tight">
                          {item.title}
                        </span>
                        <span className="text-muted-foreground mt-2 block max-w-xl text-sm leading-relaxed">
                          {item.copy}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ))}
    </main>
  );
}
