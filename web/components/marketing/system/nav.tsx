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
  {
    title: "Launch your first channel",
    href: "/resources/guides/first-channel",
    desc: "Zero to a posting channel in one sitting.",
  },
  {
    title: "SEO articles that rank",
    href: "/resources/guides/seo-articles",
    desc: "Research, outline, publish, and measure.",
  },
  {
    title: "Agent-driven marketing",
    href: "/resources/guides/agent-driven-marketing",
    desc: "Wire your agent into the whole pipeline.",
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
          Per-channel autopilot caps
        </span>
        <span className="mt-1 text-[12.5px] leading-snug text-zinc-500">
          Set a daily budget per channel. The agent plans the queue around it.
        </span>
        {/* Mini spend-cap sketch fills the card between copy and link. */}
        <span
          aria-hidden
          className="relative mt-4 flex min-h-14 flex-1 items-end gap-1.5 px-0.5 pt-5"
        >
          <span className="absolute inset-x-0.5 top-2 border-t border-dashed border-zinc-900/20" />
          <span className="absolute right-0.5 top-2 size-1.5 -translate-y-1/2 rounded-full bg-brand" />
          {[14, 22, 18, 28, 36].map((h, i) => (
            <span
              className={cn(
                "w-full rounded-t-[3px]",
                i === 4 ? "bg-zinc-900/20" : "bg-zinc-900/10",
              )}
              key={i}
              style={{ height: h }}
            />
          ))}
        </span>
        <span className="inline-flex items-center gap-1 pt-4 text-[13px] font-medium text-zinc-900">
          Read the changelog
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
              desc={g.desc}
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
    hubDesc: "Everything the platform produces.",
    links: FEATURES.map((f) => ({
      title: f.title,
      href: f.href,
      desc: f.desc,
    })),
  },
  {
    key: "use-cases",
    label: "Use cases",
    hubHref: "/use-cases",
    hubDesc: "Who runs marketer.sh, and how.",
    links: USE_CASES.map((u) => ({
      title: u.title,
      href: u.href,
      desc: u.desc,
    })),
  },
  {
    key: "resources",
    label: "Resources",
    hubHref: "/resources",
    hubDesc: "Docs, guides, and what shipped.",
    links: [
      ...RESOURCES.map((r) => ({ title: r.title, href: r.href, desc: r.desc })),
      ...GUIDES.map((g) => ({ title: g.title, href: g.href, desc: g.desc })),
    ],
  },
];

/** Tiny SVG noise for the mobile aurora, tiled at very low opacity. */
const MOBILE_GRAIN =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

function MobileOverlay({ onClose }: { onClose: () => void }) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Escape dismisses the overlay.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const subItem = reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, x: -14 },
        show: {
          opacity: 1,
          x: 0,
          transition: { duration: 0.35, ease: EASE },
        },
      };

  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-label="Menu"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[#f5f6f8] md:hidden"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      role="dialog"
      transition={{ duration: reduced ? 0.15 : 0.3, ease: "easeOut" }}
    >
      {/* Aurora wash + grain behind everything */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(130%_100%_at_85%_-10%,#dbeafe_0%,#eff6ff_50%,rgba(239,246,255,0)_78%)]" />
        <div className="absolute -left-1/4 top-1/3 h-[46vh] w-[85vw] rounded-full bg-indigo-200/45 blur-3xl" />
        <div className="absolute -right-1/4 bottom-[-12%] h-[42vh] w-[80vw] rounded-full bg-rose-200/40 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{ backgroundImage: MOBILE_GRAIN }}
        />
      </div>

      <div className="relative flex items-center justify-between px-5 pt-5">
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
        className="relative flex-1 overflow-y-auto px-6 pt-8 pb-6"
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
                  className="flex w-full items-center justify-between rounded-2xl px-1 py-2.5 text-left font-display text-[clamp(2.5rem,9vw,3rem)] font-semibold leading-[1.08] tracking-tight text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
                  onClick={() => setExpanded(isOpen ? null : group.key)}
                  type="button"
                >
                  {group.label}
                  <svg
                    aria-hidden
                    className={cn(
                      "size-6 shrink-0 text-zinc-400 transition-transform duration-200",
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
                      <motion.ul
                        animate="show"
                        className="space-y-0.5 px-1 pb-4 pt-1"
                        initial={reduced ? false : "hidden"}
                        variants={{
                          hidden: {},
                          show: {
                            transition: {
                              staggerChildren: reduced ? 0 : 0.045,
                              delayChildren: reduced ? 0 : 0.08,
                            },
                          },
                        }}
                      >
                        <motion.li variants={subItem}>
                          <Link
                            className="block rounded-xl py-2"
                            href={group.hubHref}
                            onClick={onClose}
                          >
                            <span className="block text-[17px] font-medium text-zinc-900">
                              Overview
                            </span>
                            <span className="mt-0.5 block text-[13px] leading-snug text-zinc-500">
                              {group.hubDesc}
                            </span>
                          </Link>
                        </motion.li>
                        {group.links.map((l) => (
                          <motion.li key={l.href} variants={subItem}>
                            <Link
                              className="block rounded-xl py-2"
                              href={l.href}
                              onClick={onClose}
                            >
                              <span className="block text-[17px] font-medium text-zinc-800">
                                {l.title}
                              </span>
                              <span className="mt-0.5 block text-[13px] leading-snug text-zinc-500">
                                {l.desc}
                              </span>
                            </Link>
                          </motion.li>
                        ))}
                      </motion.ul>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
          {PLAIN_LINKS.map((l) => (
            <motion.li key={l.href} variants={item}>
              <Link
                className="block rounded-2xl px-1 py-2.5 font-display text-[clamp(2.5rem,9vw,3rem)] font-semibold leading-[1.08] tracking-tight text-zinc-900"
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
        className="relative border-t border-zinc-900/[0.06] bg-white/60 px-6 py-4 backdrop-blur-xl"
        initial={reduced ? { opacity: 0, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.4, ease: EASE, delay: 0.2 }}
      >
        {/* Meta row: the space reads composed, not abandoned. */}
        <div className="mb-3.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400">
            <svg
              aria-hidden
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.25"
              viewBox="0 0 24 24"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            marketer.sh
          </span>
          <span className="flex items-center gap-4 text-[12px] font-medium text-zinc-500">
            <Link href="/resources/changelog" onClick={onClose}>
              Changelog
            </Link>
            <Link href="/resources/api" onClick={onClose}>
              API
            </Link>
            <Link href="/resources/faq" onClick={onClose}>
              FAQ
            </Link>
          </span>
        </div>
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
              paddingTop: condensed ? 6 : 9,
              paddingBottom: condensed ? 6 : 9,
              paddingLeft: condensed ? 10 : 14,
              paddingRight: condensed ? 5 : 8,
              backgroundColor: condensed
                ? "rgba(255,255,255,0.85)"
                : "rgba(255,255,255,0.7)",
              boxShadow: condensed
                ? "0 12px 32px rgba(15,23,42,0.12)"
                : "0 2px 16px rgba(15,23,42,0.05)",
            }}
            aria-label="Primary"
            className="flex items-center gap-0.5 rounded-full border border-white/40 backdrop-blur-xl"
            initial={false}
            transition={spring}
          >
            <motion.div
              animate={{ scale: condensed ? 0.9 : 1 }}
              className="-ml-1 mr-1.5 origin-left"
              transition={spring}
            >
              <Wordmark />
            </motion.div>

            {/* Desktop items */}
            <div className="hidden items-center gap-0.5 md:flex">
              {MENUS.map((m) => (
                <button
                  aria-controls={`nav-panel-${m.key}`}
                  aria-expanded={open === m.key}
                  aria-haspopup="true"
                  className={cn(
                    "rounded-full px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-900/[0.05] hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900",
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
                  className="rounded-full px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-900/[0.05] hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
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
            <div className="ml-1.5 hidden items-center gap-1 md:flex">
              <Link
                className="rounded-full px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
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
                    "origin-top overflow-hidden rounded-3xl border border-white/50 bg-white/[0.68] shadow-[0_24px_60px_rgba(15,23,42,0.14)] backdrop-blur-2xl backdrop-saturate-150",
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
