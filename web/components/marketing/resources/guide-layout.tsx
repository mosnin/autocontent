"use client";

import * as React from "react";
import Link from "next/link";

import { Kicker, Reveal, TextReveal } from "@/components/marketing/system";
import { cn } from "@/lib/utils";

export type GuideSection = {
  id: string;
  heading: string;
  body: React.ReactNode;
};

/* ------------------------------------------------------------------ */
/* Prose primitives (guides can't touch globals.css, so styling lives  */
/* in these small components)                                          */
/* ------------------------------------------------------------------ */

export function GuideP({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 text-[16px] leading-[1.75] text-zinc-600 first:mt-0 md:text-[17px]">
      {children}
    </p>
  );
}

export function GuideStrong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-zinc-900">{children}</strong>;
}

export function GuideCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md border border-zinc-900/[0.08] bg-zinc-900/[0.04] px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800">
      {children}
    </code>
  );
}

export function GuideList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-4 space-y-2.5">
      {items.map((item, i) => (
        <li
          className="flex gap-3 text-[16px] leading-[1.7] text-zinc-600 md:text-[17px]"
          key={i}
        >
          <span
            aria-hidden
            className="mt-[0.65em] size-1.5 shrink-0 rounded-full bg-zinc-900/30"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function GuideQuote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="mt-6 border-l-2 border-zinc-900/20 pl-5 font-display text-xl font-medium leading-snug tracking-tight text-zinc-800 md:text-2xl">
      {children}
    </blockquote>
  );
}

export function GuideCallout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-zinc-900/[0.06] bg-[radial-gradient(110%_110%_at_50%_-10%,#f0f4ff_0%,#fafafa_70%)] p-5">
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      <div className="mt-1.5 text-[15px] leading-relaxed text-zinc-600">
        {children}
      </div>
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
 * Long-form guide shell: white article panel with a reading-time chip, the
 * page h1, a sticky mini-TOC on desktop (scrollspy highlights the section
 * in view), and Reveal-wrapped prose sections.
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
    <article className="px-4 pt-24 md:px-6 md:pt-28">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto max-w-5xl px-6 py-16 md:py-24">
          {/* Header */}
          <header className="max-w-2xl">
            <Reveal>
              <div className="flex flex-wrap items-center gap-3">
                <Kicker>{kicker}</Kicker>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-900/10 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                  {readingTime}
                </span>
                <span className="text-[11px] font-medium text-zinc-400">
                  Updated {updated}
                </span>
              </div>
              <TextReveal
                as="h1"
                className="mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
              >
                {title}
              </TextReveal>
              <p className="mt-5 text-[17px] leading-relaxed text-zinc-600">
                {lede}
              </p>
            </Reveal>
          </header>

          {/* Body + TOC */}
          <div className="mt-14 grid gap-12 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <nav
              aria-label="On this page"
              className="hidden lg:block"
            >
              <div className="sticky top-28">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
                  On this page
                </p>
                <ul className="mt-4 space-y-1 border-l border-zinc-900/[0.08]">
                  {sections.map((s) => (
                    <li key={s.id}>
                      <a
                        className={cn(
                          "-ml-px block border-l py-1 pl-4 text-[13px] leading-snug transition-colors",
                          active === s.id
                            ? "border-zinc-900 font-medium text-zinc-900"
                            : "border-transparent text-zinc-500 hover:text-zinc-900",
                        )}
                        href={`#${s.id}`}
                      >
                        {s.heading}
                      </a>
                    </li>
                  ))}
                </ul>
                <Link
                  className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 transition-colors hover:text-zinc-900"
                  href="/resources"
                >
                  <svg
                    aria-hidden
                    className="size-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M19 12H5" />
                    <path d="m11 18-6-6 6-6" />
                  </svg>
                  All resources
                </Link>
              </div>
            </nav>

            <div className="max-w-2xl">
              {sections.map((s) => (
                <Reveal key={s.id}>
                  <section
                    aria-label={s.heading}
                    className="scroll-mt-28 pt-10 first:pt-0"
                    id={s.id}
                  >
                    <h2 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 md:text-[1.75rem]">
                      {s.heading}
                    </h2>
                    <div className="mt-4">{s.body}</div>
                  </section>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
