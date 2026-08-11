"use client";

import * as React from "react";
import Link from "next/link";

import { Chip, Eyebrow, Heading, Lede } from "@/components/site/sections";
import { cn } from "@/lib/utils";

export type GuideSection = {
  id: string;
  heading: string;
  body: React.ReactNode;
};

/* ------------------------------------------------------------------ */
/* Prose primitives (guides can't touch globals.css, so the styling    */
/* lives in these small components and in sections.css)                */
/* ------------------------------------------------------------------ */

export function GuideP({ children }: { children: React.ReactNode }) {
  return <p className="os-guide__p">{children}</p>;
}

export function GuideStrong({ children }: { children: React.ReactNode }) {
  return <strong className="os-guide__strong">{children}</strong>;
}

export function GuideCode({ children }: { children: React.ReactNode }) {
  return <code className="os-code">{children}</code>;
}

export function GuideList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="os-bullets os-mt-20">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function GuideQuote({ children }: { children: React.ReactNode }) {
  return <blockquote className="os-quote">{children}</blockquote>;
}

export function GuideCallout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="os-callout">
      <p className="os-label">{title}</p>
      <div className="os-body os-mt-8">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

function useActiveSection(ids: string[]) {
  const [active, setActive] = React.useState(ids[0] ?? "");

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-25% 0px -65% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

/**
 * Long-form guide shell: the ruled section container with a reading-time
 * chip, the page h1, a sticky mini-TOC on desktop (scrollspy highlights the
 * section in view), and the prose sections.
 */
export function GuideLayout({
  kicker = "Guide",
  title,
  lede,
  readingTime,
  updated,
  sections,
}: {
  kicker?: string;
  title: string;
  lede: string;
  readingTime: string;
  updated: string;
  sections: GuideSection[];
}) {
  const ids = React.useMemo(() => sections.map((s) => s.id), [sections]);
  const active = useActiveSection(ids);

  return (
    <article className="os-section os-section--top">
      <div className="os-section__inner">
        <div className="os-inset">
          <header className="os-guide__header">
            <div className="os-actions">
              <Eyebrow>{kicker}</Eyebrow>
              <Chip>{readingTime}</Chip>
              <span className="os-meta">Updated {updated}</span>
            </div>
            <Heading className="os-mt-24" level={1} size="lg">
              {title}
            </Heading>
            <Lede className="os-mt-20">{lede}</Lede>
          </header>

          <div className="os-guide os-mt-64">
            <nav aria-label="On this page" className="os-guide__nav">
              <div className="os-guide__sticky">
                <p className="os-label">On this page</p>
                <ul className="os-toc">
                  {sections.map((s) => (
                    <li key={s.id}>
                      <a
                        className={cn("os-toc__link", active === s.id && "os-toc__link--on")}
                        href={`#${s.id}`}
                      >
                        {s.heading}
                      </a>
                    </li>
                  ))}
                </ul>
                <Link className="os-guide__back" href="/resources">
                  <svg
                    aria-hidden
                    fill="none"
                    height="13"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="13"
                  >
                    <path d="M19 12H5" />
                    <path d="m11 18-6-6 6-6" />
                  </svg>
                  All resources
                </Link>
              </div>
            </nav>

            <div className="os-guide__body">
              {sections.map((s) => (
                <section
                  aria-label={s.heading}
                  className="os-guide__section"
                  id={s.id}
                  key={s.id}
                >
                  <Heading level={2} size="md">
                    {s.heading}
                  </Heading>
                  <div className="os-mt-20">{s.body}</div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
