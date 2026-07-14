"use client";

import * as React from "react";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "./motion";

/* ------------------------------------------------------------------ */
/* Sitemap data (URLs are canonical, see DESIGN_SPEC.md)               */
/* ------------------------------------------------------------------ */

type MenuKey = "features" | "use-cases" | "resources";

const FEATURES = [
  {
    title: "Video",
    href: "/features/video",
    desc: "Short-form video from one brief, scripted to published.",
    thumb: "video" as const,
  },
  {
    title: "Articles & SEO",
    href: "/features/articles",
    desc: "Long-form articles built from live search research.",
    thumb: "articles" as const,
  },
  {
    title: "Automation & Agents",
    href: "/features/automation",
    desc: "API, SDK, CLI, and MCP surfaces for your agents.",
    thumb: "automation" as const,
  },
  {
    title: "Analytics & Spend",
    href: "/features/analytics",
    desc: "The performance loop, plus hard spend caps.",
    thumb: "analytics" as const,
  },
];

const USE_CASES = [
  {
    title: "Creators",
    href: "/use-cases/creators",
    desc: "A daily channel without the daily grind.",
  },
  {
    title: "Ecommerce",
    href: "/use-cases/ecommerce",
    desc: "Product videos and buying-guide articles.",
  },
  {
    title: "SaaS",
    href: "/use-cases/saas",
    desc: "Launch videos and evergreen SEO, on schedule.",
  },
  {
    title: "Agencies",
    href: "/use-cases/agencies",
    desc: "Many brands, one pipeline, per-client caps.",
  },
  {
    title: "Local business",
    href: "/use-cases/local-business",
    desc: "Show up in local search every week.",
  },
  {
    title: "AI agents",
    href: "/use-cases/ai-agents",
    desc: "Give your agent a marketing department.",
  },
];

const RESOURCES = [
  {
    title: "Quickstart",
    href: "/resources/quickstart",
    desc: "First video out the door in about ten minutes.",
  },
  {
    title: "API & MCP",
    href: "/resources/api",
    desc: "REST API, SDK, CLI, and the MCP server.",
  },
  {
    title: "Changelog",
    href: "/resources/changelog",
    desc: "What shipped this week.",
  },
  {
    title: "FAQ",
    href: "/resources/faq",
    desc: "Billing, caps, approvals, publishing.",
  },
];

const GUIDES = [
  { title: "Launch your first channel", href: "/resources/guides/first-channel" },
  { title: "SEO articles that rank", href: "/resources/guides/seo-articles" },
  {
    title: "Agent-driven marketing",
    href: "/resources/guides/agent-driven-marketing",
  },
];

const MENUS: Array<{ key: MenuKey; label: string; hubHref: string }> = [
  { key: "features", label: "Features", hubHref: "/features" },
  { key: "use-cases", label: "Use cases", hubHref: "/use-cases" },
  { key: "resources", label: "Resources", hubHref: "/resources" },
];

const PLAIN_LINKS = [
  { label: "Pricing", href: "/pricing" },
  { label: "Company", href: "/company" },
];

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      className={cn(
        "flex items-center gap-2 rounded-full px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
        className,
      )}
      href="/"
    >
      {/* Mark: a closed loop — literally the product. */}
      <svg
        aria-hidden
        className="size-[18px] text-zinc-900"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.25"
        viewBox="0 0 24 24"
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
      <span className="font-display text-[15px] font-semibold tracking-tight text-zinc-900">
        marketer.sh
      </span>
    </Link>
  );
}

/** Mini line-art thumbnail tiles for the Features panel. */
function Thumb({ kind }: { kind: (typeof FEATURES)[number]["thumb"] }) {
  return (
    <span
      aria-hidden
      className="flex h-12 w-16 shrink-0 items-center justify-center rounded-xl border border-zinc-900/[0.06] bg-[linear-gradient(135deg,#eff6ff,#eef2ff)]"
    >
      <svg
        className="h-7 w-9 stroke-zinc-500"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 36 28"
      >
        {kind === "video" && (
          <>
            <rect height="18" rx="4" width="26" x="5" y="5" />
            <path className="fill-zinc-500" d="M16 10.5 21.5 14 16 17.5Z" />
          </>
        )}
        {kind === "articles" && (
          <>
            <rect height="20" rx="3" width="20" x="8" y="4" />
            <path d="M12 10h12M12 14h12M12 18h7" />
          </>
        )}
        {kind === "automation" && (
          <>
            <ellipse cx="18" cy="14" rx="13" ry="9" strokeDasharray="2 3" />
            <rect height="9" rx="2.5" width="9" x="13.5" y="9.5" />
            <circle className="fill-zinc-500" cx="31" cy="14" r="2" stroke="none" />
          </>
        )}
        {kind === "analytics" && (
          <>
            <path d="M6 22 13 15l5 4 12-11" />
            <circle className="fill-zinc-500" cx="30" cy="8" r="2" stroke="none" />
          </>
        )}
      </svg>
    </span>
  );
}

function PanelLink({
  href,
  title,
  desc,
  thumb,
  onNavigate,
}: {
  href: string;
  title: string;
  desc?: string;
  thumb?: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      className="group flex items-center gap-3.5 rounded-2xl p-2.5 transition-colors hover:bg-zinc-900/[0.04] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
      href={href}
      onClick={onNavigate}
    >
      {thumb}
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-zinc-900">
          {title}
        </span>
        {desc ? (
          <span className="mt-0.5 block text-[12.5px] leading-snug text-zinc-500">
            {desc}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function HubLink({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      className="inline-flex items-center gap-1 rounded-full text-[13px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      href={href}
      onClick={onNavigate}
    >
      {label}
      <svg
        aria-hidden
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop mega panels                                                 */
/* ------------------------------------------------------------------ */

function FeaturesPanel({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex gap-5 p-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between px-2.5 pb-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
            Features
          </p>
          <HubLink href="/features" label="All features" onNavigate={onNavigate} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          {FEATURES.map((f) => (
            <PanelLink
              desc={f.desc}
              href={f.href}
              key={f.href}
              onNavigate={onNavigate}
              thumb={<Thumb kind={f.thumb} />}
              title={f.title}
            />
          ))}
        </div>
      </div>
      {/* Right rail: What's new */}
      <Link
        className="flex w-56 shrink-0 flex-col rounded-2xl border border-zinc-900/[0.06] bg-[radial-gradient(120%_120%_at_80%_-10%,#dbeafe_0%,#eff6ff_60%,#fafafa_100%)] p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
        href="/resources/changelog"
        onClick={onNavigate}
      >
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-zinc-900/10 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
          <span className="size-1.5 rounded-full bg-brand" />
          What&apos;s new
        </span>
        <span className="mt-3 text-[14px] font-medium leading-snug text-zinc-900">
          Per-niche autopilot caps
        </span>
        <span className="mt-1 text-[12.5px] leading-snug text-zinc-500">
          Set a daily budget per channel. The agent plans the queue around it.
        </span>
        <span className="mt-auto pt-4 text-[13px] font-medium text-zinc-900">
          Read the changelog
        </span>
      </Link>
    </div>
  );
}

function UseCasesPanel({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="p-5">
      <div className="flex items-center justify-between px-2.5 pb-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
          Use cases
        </p>
        <HubLink href="/use-cases" label="All use cases" onNavigate={onNavigate} />
      </div>
      <div className="grid grid-cols-2 gap-1">
        {USE_CASES.map((u) => (
          <PanelLink
            desc={u.desc}
            href={u.href}
            key={u.href}
            onNavigate={onNavigate}
            title={u.title}
          />
        ))}
      </div>
    </div>
  );
}

function ResourcesPanel({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex gap-5 p-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between px-2.5 pb-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
            Resources
          </p>
          <HubLink href="/resources" label="All resources" onNavigate={onNavigate} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          {RESOURCES.map((r) => (
            <PanelLink
              desc={r.desc}
              href={r.href}
              key={r.href}
              onNavigate={onNavigate}
              title={r.title}
            />
          ))}
        </div>
      </div>
      <div className="w-52 shrink-0 border-l border-zinc-900/[0.06] pl-5">
        <p className="px-2.5 pb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
          Guides
        </p>
        <div className="grid gap-1">
          {GUIDES.map((g) => (
            <PanelLink
              href={g.href}
              key={g.href}
              onNavigate={onNavigate}
              title={g.title}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile overlay                                                      */
/* ------------------------------------------------------------------ */

const MOBILE_GROUPS = [
  {
    key: "features",
    label: "Features",
    hubHref: "/features",
    links: FEATURES.map((f) => ({ title: f.title, href: f.href })),
  },
  {
    key: "use-cases",
    label: "Use cases",
    hubHref: "/use-cases",
    links: USE_CASES.map((u) => ({ title: u.title, href: u.href })),
  },
  {
    key: "resources",
    label: "Resources",
    hubHref: "/resources",
    links: [
      ...RESOURCES.map((r) => ({ title: r.title, href: r.href })),
      ...GUIDES.map((g) => ({ title: g.title, href: g.href })),
    ],
  },
];

function MobileOverlay({ onClose }: { onClose: () => void }) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const item = reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 20 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.5, ease: EASE },
        },
      };

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] flex flex-col bg-[radial-gradient(130%_130%_at_85%_-10%,#dbeafe_0%,#eff6ff_45%,#f5f6f8_100%)] md:hidden"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.3, ease: "easeOut" }}
    >
      <div className="flex items-center justify-between px-5 pt-5">
        <Wordmark />
        <button
          aria-label="Close menu"
          className="flex size-11 items-center justify-center rounded-full border border-zinc-900/10 bg-white/70 text-zinc-900 backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          <svg
            aria-hidden
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <motion.nav
        animate="show"
        aria-label="Mobile"
        className="flex-1 overflow-y-auto px-5 pt-8 pb-6"
        initial="hidden"
        variants={{
          hidden: {},
          show: {
            transition: { staggerChildren: reduced ? 0 : 0.06, delayChildren: 0.1 },
          },
        }}
      >
        <ul className="space-y-1">
          {MOBILE_GROUPS.map((group) => {
            const isOpen = expanded === group.key;
            return (
              <motion.li key={group.key} variants={item}>
                <button
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between rounded-2xl px-2 py-3 text-left font-display text-3xl font-semibold tracking-tight text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
                  onClick={() => setExpanded(isOpen ? null : group.key)}
                  type="button"
                >
                  {group.label}
                  <svg
                    aria-hidden
                    className={cn(
                      "size-5 text-zinc-400 transition-transform duration-200",
                      isOpen && "rotate-45",
                    )}
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      animate={{ height: "auto", opacity: 1 }}
                      className="overflow-hidden"
                      exit={{ height: 0, opacity: 0 }}
                      initial={
                        reduced ? { height: "auto", opacity: 0 } : { height: 0, opacity: 0 }
                      }
                      transition={{ duration: reduced ? 0.15 : 0.35, ease: EASE }}
                    >
                      <ul className="space-y-0.5 px-2 pb-3">
                        <li>
                          <Link
                            className="block rounded-xl py-2 text-[17px] font-medium text-zinc-900"
                            href={group.hubHref}
                            onClick={onClose}
                          >
                            Overview
                          </Link>
                        </li>
                        {group.links.map((l) => (
                          <li key={l.href}>
                            <Link
                              className="block rounded-xl py-2 text-[17px] text-zinc-600"
                              href={l.href}
                              onClick={onClose}
                            >
                              {l.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
          {PLAIN_LINKS.map((l) => (
            <motion.li key={l.href} variants={item}>
              <Link
                className="block rounded-2xl px-2 py-3 font-display text-3xl font-semibold tracking-tight text-zinc-900"
                href={l.href}
                onClick={onClose}
              >
                {l.label}
              </Link>
            </motion.li>
          ))}
        </ul>
      </motion.nav>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="border-t border-zinc-900/[0.06] bg-white/60 px-5 py-4 backdrop-blur-xl"
        initial={reduced ? { opacity: 0, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.4, ease: EASE, delay: 0.2 }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Link
            className="flex min-h-11 items-center justify-center rounded-full border border-zinc-900/10 bg-white text-sm font-medium text-zinc-900"
            href="/sign-in"
            onClick={onClose}
          >
            Log in
          </Link>
          <Link
            className="flex min-h-11 items-center justify-center rounded-full bg-zinc-900 text-sm font-medium text-white"
            href="/sign-up"
            onClick={onClose}
          >
            Get started
          </Link>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* The nav                                                             */
/* ------------------------------------------------------------------ */

export function MarketingNav() {
  const reduced = useReducedMotion();
  const [condensed, setCondensed] = React.useState(false);
  const [open, setOpen] = React.useState<MenuKey | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const triggerRefs = React.useRef<Partial<Record<MenuKey, HTMLButtonElement>>>(
    {},
  );

  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (v) => setCondensed(v > 80));

  // Lock body scroll while the mobile overlay is up.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const close = React.useCallback(() => setOpen(null), []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      const trigger = triggerRefs.current[open];
      setOpen(null);
      trigger?.focus();
    }
  };

  // Close the desktop panel when focus leaves nav + panel entirely.
  const handleBlur = (e: React.FocusEvent) => {
    if (!wrapperRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(null);
    }
  };

  const spring = reduced
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 320, damping: 34 } as const);

  return (
    <>
      <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        <div
          className="relative"
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onMouseLeave={close}
          ref={wrapperRef}
        >
          <motion.nav
            animate={{
              paddingTop: condensed ? 5 : 9,
              paddingBottom: condensed ? 5 : 9,
              paddingLeft: condensed ? 12 : 18,
              paddingRight: condensed ? 6 : 10,
              backgroundColor: condensed
                ? "rgba(255,255,255,0.88)"
                : "rgba(255,255,255,0.7)",
              boxShadow: condensed
                ? "0 12px 32px rgba(15,23,42,0.12)"
                : "0 2px 16px rgba(15,23,42,0.05)",
            }}
            aria-label="Primary"
            className="flex items-center gap-1 rounded-full border border-white/40 backdrop-blur-xl"
            initial={false}
            transition={spring}
          >
            <Wordmark className="-ml-1 mr-2" />

            {/* Desktop items */}
            <div className="hidden items-center gap-0.5 md:flex">
              {MENUS.map((m) => (
                <button
                  aria-controls={`nav-panel-${m.key}`}
                  aria-expanded={open === m.key}
                  aria-haspopup="true"
                  className={cn(
                    "rounded-full px-3.5 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-900/[0.05] hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900",
                    open === m.key && "bg-zinc-900/[0.05] text-zinc-900",
                  )}
                  key={m.key}
                  onClick={() => setOpen(open === m.key ? null : m.key)}
                  onFocus={() => setOpen(m.key)}
                  onMouseEnter={() => setOpen(m.key)}
                  ref={(el) => {
                    if (el) triggerRefs.current[m.key] = el;
                  }}
                  type="button"
                >
                  {m.label}
                </button>
              ))}
              {PLAIN_LINKS.map((l) => (
                <Link
                  className="rounded-full px-3.5 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-900/[0.05] hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
                  href={l.href}
                  key={l.href}
                  onFocus={close}
                  onMouseEnter={close}
                >
                  {l.label}
                </Link>
              ))}
            </div>

            {/* Desktop auth */}
            <div className="ml-2 hidden items-center gap-1.5 md:flex">
              <Link
                className="rounded-full px-3.5 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
                href="/sign-in"
              >
                Log in
              </Link>
              <Link
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                href="/sign-up"
              >
                Get started
              </Link>
            </div>

            {/* Mobile hamburger */}
            <button
              aria-expanded={mobileOpen}
              aria-label="Open menu"
              className="flex size-10 items-center justify-center rounded-full text-zinc-900 md:hidden"
              onClick={() => setMobileOpen(true)}
              type="button"
            >
              <svg
                aria-hidden
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </motion.nav>

          {/* Desktop mega panel */}
          <AnimatePresence>
            {open && (
              <div className="absolute left-1/2 top-full hidden -translate-x-1/2 pt-3 md:block">
                <motion.div
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className={cn(
                    "origin-top overflow-hidden rounded-3xl border border-white/50 bg-white/85 shadow-[0_24px_60px_rgba(15,23,42,0.14)] backdrop-blur-xl",
                    open === "features" && "w-[680px]",
                    open === "use-cases" && "w-[560px]",
                    open === "resources" && "w-[620px]",
                  )}
                  exit={{ opacity: 0, scale: 0.98, y: -6 }}
                  id={`nav-panel-${open}`}
                  initial={
                    reduced
                      ? { opacity: 0, scale: 1, y: 0 }
                      : { opacity: 0, scale: 0.98, y: -6 }
                  }
                  key={open}
                  transition={{ duration: reduced ? 0.12 : 0.24, ease: EASE }}
                >
                  {open === "features" && <FeaturesPanel onNavigate={close} />}
                  {open === "use-cases" && <UseCasesPanel onNavigate={close} />}
                  {open === "resources" && <ResourcesPanel onNavigate={close} />}
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <AnimatePresence>
        {mobileOpen && <MobileOverlay onClose={() => setMobileOpen(false)} />}
      </AnimatePresence>
    </>
  );
}
