"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Reveal, TextReveal } from "@/components/marketing/system";
import { EASE } from "@/components/marketing/system/motion";
import { cn } from "@/lib/utils";

type Team = {
  key: string;
  label: string;
  href: string;
  headline: string;
  desc: string;
  checks: string[];
  cards: Array<{ title: string; desc: string; href: string }>;
};

const TEAMS: Team[] = [
  {
    key: "creators",
    label: "Creators",
    href: "/use-cases/creators",
    headline: "A daily channel, without the daily grind.",
    desc: "Keep the ideas and the voice. Hand the production line — scripting, rendering, captioning, posting — to the pipeline.",
    checks: [
      "One brief becomes a week of shorts",
      "Your recurring characters, your art style",
      "Posting slots you set once and forget",
    ],
    cards: [
      { title: "Launch your first channel", desc: "Zero to posting in one sitting.", href: "/resources/guides/first-channel" },
      { title: "Studio video", desc: "Hook-driven shorts for every feed.", href: "/features/video" },
    ],
  },
  {
    key: "ecommerce",
    label: "Ecommerce",
    href: "/use-cases/ecommerce",
    headline: "Product videos and buying guides, on repeat.",
    desc: "Every SKU gets a short and every category gets an article, priced per asset and capped per day.",
    checks: [
      "Product shorts from a catalog brief",
      "Buying-guide articles that rank",
      "Per-store spend caps",
    ],
    cards: [
      { title: "Ecommerce playbook", desc: "How stores run the pipeline.", href: "/use-cases/ecommerce" },
      { title: "Press articles", desc: "SEO built from live research.", href: "/features/articles" },
    ],
  },
  {
    key: "saas",
    label: "SaaS",
    href: "/use-cases/saas",
    headline: "Launch videos and evergreen SEO, on schedule.",
    desc: "Ship the launch clip the day the feature ships, and let the article engine compound organic traffic behind it.",
    checks: [
      "Feature-launch shorts in hours",
      "Evergreen article clusters",
      "Changelog-to-content automation",
    ],
    cards: [
      { title: "SaaS playbook", desc: "Marketing that tracks your roadmap.", href: "/use-cases/saas" },
      { title: "SEO articles guide", desc: "Research, outline, publish, measure.", href: "/resources/guides/seo-articles" },
    ],
  },
  {
    key: "agencies",
    label: "Agencies",
    href: "/use-cases/agencies",
    headline: "Many brands. One pipeline. Per-client caps.",
    desc: "Every client is a niche with its own brand kit, budget, and approval gate. Your team reviews, the system produces.",
    checks: [
      "Isolated brand kits per client",
      "Client-level spend caps and reports",
      "Approval gates before anything ships",
    ],
    cards: [
      { title: "Agency playbook", desc: "Scale accounts, not headcount.", href: "/use-cases/agencies" },
      { title: "Analytics & spend", desc: "Caps, gates, and the audit trail.", href: "/features/analytics" },
    ],
  },
  {
    key: "local",
    label: "Local business",
    href: "/use-cases/local-business",
    headline: "Show up in local search every single week.",
    desc: "A steady drum of neighborhood-relevant videos and articles, produced while you run the actual business.",
    checks: [
      "Weekly local-topic articles",
      "Shorts for the feeds your customers scroll",
      "A budget that fits a small business",
    ],
    cards: [
      { title: "Local playbook", desc: "Marketing between customers.", href: "/use-cases/local-business" },
      { title: "Pricing", desc: "Prepaid credits from $5.", href: "/pricing" },
    ],
  },
  {
    key: "agents",
    label: "AI agents",
    href: "/use-cases/ai-agents",
    headline: "Give your agent a marketing department.",
    desc: "Everything a human can click, an agent can call. The MCP server and API expose the whole pipeline, caps included.",
    checks: [
      "MCP server for tool-using agents",
      "REST API, Python SDK, and CLI",
      "Fail-closed budget guardrails",
    ],
    cards: [
      { title: "Agent-driven marketing", desc: "Wire an agent into the pipeline.", href: "/resources/guides/agent-driven-marketing" },
      { title: "API & MCP reference", desc: "Every surface, documented.", href: "/resources/api" },
    ],
  },
];

function Check() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f59e0b,#f43f5e)]"
    >
      <svg
        className="size-3 text-white"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
      >
        <path d="m5 13 4 4L19 7" />
      </svg>
    </span>
  );
}

export function Teams() {
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState(TEAMS[0].key);
  const team = TEAMS.find((t) => t.key === active) ?? TEAMS[0];

  return (
    <section aria-label="Solutions for every team" className="bg-[#f5f6f8] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-3xl text-center">
          <TextReveal className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
            AI marketing for every team.
          </TextReveal>
          <p className="mt-5 text-lg leading-relaxed text-zinc-600">
            The same pipeline, tuned to how your business ships.
          </p>
        </Reveal>

        {/* Tab pills */}
        <Reveal className="mt-10 flex flex-wrap justify-center gap-2.5" delay={0.05}>
          {TEAMS.map((t) => (
            <button
              aria-pressed={active === t.key}
              className={cn(
                "rounded-full border px-5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
                active === t.key
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-900/10 bg-white text-zinc-700 hover:border-zinc-900/30",
              )}
              key={t.key}
              onClick={() => setActive(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </Reveal>

        {/* Panel */}
        <div className="mx-auto mt-10 max-w-6xl">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="grid gap-8 rounded-[2rem] border border-zinc-900/[0.06] bg-white p-8 shadow-[0_8px_40px_rgba(15,23,42,0.06)] md:grid-cols-[1.2fr_1fr] md:p-12"
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
              key={team.key}
              transition={{ duration: reduced ? 0.12 : 0.35, ease: EASE }}
            >
              <div>
                <h3 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 md:text-3xl">
                  {team.headline}
                </h3>
                <p className="mt-4 max-w-[48ch] text-[15px] leading-relaxed text-zinc-600">
                  {team.desc}
                </p>
                <ul className="mt-6 space-y-3">
                  {team.checks.map((c) => (
                    <li className="flex items-start gap-3 text-[15px] text-zinc-800" key={c}>
                      <Check />
                      {c}
                    </li>
                  ))}
                </ul>
                <Link
                  className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-900 hover:underline"
                  href={team.href}
                >
                  Explore the {team.label.toLowerCase()} playbook
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
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </div>

              <div className="grid content-start gap-4">
                {team.cards.map((card) => (
                  <Link
                    className="group rounded-2xl border border-zinc-900/[0.06] bg-[#fafbfc] p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
                    href={card.href}
                    key={card.title}
                  >
                    <p className="text-[15px] font-semibold text-zinc-900">
                      {card.title}
                    </p>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-zinc-500">
                      {card.desc}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-zinc-700 group-hover:text-zinc-950">
                      Learn more
                      <svg
                        aria-hidden
                        className="size-3 transition-transform group-hover:translate-x-0.5"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </Link>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
