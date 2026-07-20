"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "./motion";
import { Marquee } from "./gsap-fx";

/* ------------------------------------------------------------------ */
/* Sitemap data (URLs are canonical, see DESIGN_SPEC.md)               */
/* ------------------------------------------------------------------ */

type MenuKey = "suite" | "product" | "solutions" | "resources";

type PanelItem = {
  title: string;
  href: string;
  desc?: string;
  icon?: IconKind;
};

type PanelColumn = {
  heading: string;
  items: PanelItem[];
  plain?: boolean;
};

/** Columned mega-panel content, reference-style: kicker heading per
 *  column, icon-tile rows on the left columns, plain links on the right. */
const PANELS: Record<MenuKey, PanelColumn[]> = {
  suite: [
    {
      heading: "AI platform",
      items: [
        {
          title: "Platform overview",
          href: "/features",
          desc: "The converged marketing workspace",
          icon: "platform",
        },
        {
          title: "Agents",
          href: "/features/automation",
          desc: "Delegate your marketing entirely",
          icon: "agents",
        },
        {
          title: "Autopilot",
          href: "/resources/guides/agent-driven-marketing",
          desc: "One system that plans, ships, and learns",
          icon: "autopilot",
        },
      ],
    },
    {
      heading: "AI features",
      items: [
        {
          title: "Studio video",
          href: "/features/video",
          desc: "Short-form video from a single brief",
          icon: "video",
        },
        {
          title: "Press articles",
          href: "/features/articles",
          desc: "SEO articles built from live research",
          icon: "articles",
        },
        {
          title: "Performance loop",
          href: "/features/analytics",
          desc: "Learn from every post, cap every dollar",
          icon: "analytics",
        },
      ],
    },
    {
      heading: "AI resources",
      plain: true,
      items: [
        { title: "Pricing", href: "/pricing" },
        { title: "API & MCP", href: "/resources/api" },
        { title: "Changelog", href: "/resources/changelog" },
      ],
    },
  ],
  product: [
    {
      heading: "Create",
      items: [
        {
          title: "Studio",
          href: "/features/video",
          desc: "TikTok, Reels, and Shorts on schedule",
          icon: "video",
        },
        {
          title: "Press",
          href: "/features/articles",
          desc: "Long-form articles that rank",
          icon: "articles",
        },
      ],
    },
    {
      heading: "Run",
      items: [
        {
          title: "Automation & agents",
          href: "/features/automation",
          desc: "REST API, SDK, CLI, and MCP surfaces",
          icon: "agents",
        },
        {
          title: "Analytics & spend",
          href: "/features/analytics",
          desc: "The performance loop, hard caps included",
          icon: "analytics",
        },
      ],
    },
    {
      heading: "More",
      plain: true,
      items: [
        { title: "All features", href: "/features" },
        { title: "Pricing", href: "/pricing" },
        { title: "Company", href: "/company" },
      ],
    },
  ],
  solutions: [
    {
      heading: "By team",
      items: [
        {
          title: "Creators",
          href: "/use-cases/creators",
          desc: "A daily channel without the daily grind",
          icon: "video",
        },
        {
          title: "Ecommerce",
          href: "/use-cases/ecommerce",
          desc: "Product videos and buying guides",
          icon: "cart",
        },
        {
          title: "SaaS",
          href: "/use-cases/saas",
          desc: "Launch videos and evergreen SEO",
          icon: "platform",
        },
      ],
    },
    {
      heading: "By scale",
      items: [
        {
          title: "Agencies",
          href: "/use-cases/agencies",
          desc: "Many brands, one pipeline, per-client caps",
          icon: "grid",
        },
        {
          title: "Local business",
          href: "/use-cases/local-business",
          desc: "Show up in local search every week",
          icon: "pin",
        },
        {
          title: "AI agents",
          href: "/use-cases/ai-agents",
          desc: "Give your agent a marketing department",
          icon: "agents",
        },
      ],
    },
    {
      heading: "Explore",
      plain: true,
      items: [
        { title: "All use cases", href: "/use-cases" },
        { title: "Quickstart", href: "/resources/quickstart" },
      ],
    },
  ],
  resources: [
    {
      heading: "Learn",
      items: [
        {
          title: "Quickstart",
          href: "/resources/quickstart",
          desc: "First video out the door in ten minutes",
          icon: "autopilot",
        },
        {
          title: "API & MCP",
          href: "/resources/api",
          desc: "REST API, SDK, CLI, and the MCP server",
          icon: "code",
        },
      ],
    },
    {
      heading: "Guides",
      items: [
        {
          title: "Launch your first channel",
          href: "/resources/guides/first-channel",
          desc: "Zero to a posting channel in one sitting",
          icon: "video",
        },
        {
          title: "SEO articles that rank",
          href: "/resources/guides/seo-articles",
          desc: "Research, outline, publish, measure",
          icon: "articles",
        },
        {
          title: "Agent-driven marketing",
          href: "/resources/guides/agent-driven-marketing",
          desc: "Wire your agent into the pipeline",
          icon: "agents",
        },
      ],
    },
    {
      heading: "Reference",
      plain: true,
      items: [
        { title: "All resources", href: "/resources" },
        { title: "Changelog", href: "/resources/changelog" },
        { title: "FAQ", href: "/resources/faq" },
      ],
    },
  ],
};

const MENUS: Array<{ key: MenuKey; label: string; chip?: boolean }> = [
  { key: "suite", label: "Suite AI", chip: true },
  { key: "product", label: "Product" },
  { key: "solutions", label: "Solutions" },
  { key: "resources", label: "Resources" },
];

const PLAIN_LINKS = [
  { label: "Pricing", href: "/pricing" },
  { label: "Company", href: "/company" },
];

/* ------------------------------------------------------------------ */
/* Icon tiles                                                          */
/* ------------------------------------------------------------------ */

type IconKind =
  | "platform"
  | "agents"
  | "autopilot"
  | "video"
  | "articles"
  | "analytics"
  | "cart"
  | "pin"
  | "grid"
  | "code";

/** Soft pastel tile per icon, like the reference's colorful menu icons. */
const TILE_BG: Record<IconKind, string> = {
  platform: "bg-indigo-50 text-indigo-500",
  agents: "bg-rose-50 text-rose-500",
  autopilot: "bg-amber-50 text-amber-500",
  video: "bg-sky-50 text-sky-500",
  articles: "bg-violet-50 text-violet-500",
  analytics: "bg-orange-50 text-orange-500",
  cart: "bg-pink-50 text-pink-500",
  pin: "bg-cyan-50 text-cyan-600",
  grid: "bg-fuchsia-50 text-fuchsia-500",
  code: "bg-slate-100 text-slate-500",
};

function IconTile({ kind }: { kind: IconKind }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl",
        TILE_BG[kind],
      )}
    >
      <svg
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
        viewBox="0 0 24 24"
      >
        {kind === "platform" && (
          <>
            <rect height="7" rx="1.5" width="7" x="3.5" y="3.5" />
            <rect height="7" rx="1.5" width="7" x="13.5" y="3.5" />
            <rect height="7" rx="1.5" width="7" x="3.5" y="13.5" />
            <path d="M17 14v6M14 17h6" />
          </>
        )}
        {kind === "agents" && (
          <>
            <rect height="10" rx="3" width="14" x="5" y="8" />
            <path d="M12 8V5M9.5 12.5v1M14.5 12.5v1" />
            <circle cx="12" cy="4" r="1" />
          </>
        )}
        {kind === "autopilot" && (
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
        )}
        {kind === "video" && (
          <>
            <rect height="14" rx="3" width="18" x="3" y="5" />
            <path className="fill-current" d="m10.5 9.5 4.5 2.5-4.5 2.5Z" />
          </>
        )}
        {kind === "articles" && (
          <>
            <rect height="18" rx="2.5" width="15" x="4.5" y="3" />
            <path d="M8 8h8M8 12h8M8 16h5" />
          </>
        )}
        {kind === "analytics" && (
          <>
            <path d="M4 20h16" />
            <path d="M6 16v-4M11 16V8M16 16v-6M21 16v-9" />
          </>
        )}
        {kind === "cart" && (
          <>
            <path d="M3 4h2l2.4 11.2A2 2 0 0 0 9.36 17H18a2 2 0 0 0 1.95-1.55L21.5 9H6" />
            <circle cx="9.5" cy="20" r="1.25" />
            <circle cx="17.5" cy="20" r="1.25" />
          </>
        )}
        {kind === "pin" && (
          <>
            <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
            <circle cx="12" cy="10" r="2.5" />
          </>
        )}
        {kind === "grid" && (
          <>
            <circle cx="7" cy="7" r="2.5" />
            <circle cx="17" cy="7" r="2.5" />
            <circle cx="7" cy="17" r="2.5" />
            <circle cx="17" cy="17" r="2.5" />
          </>
        )}
        {kind === "code" && <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" />}
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      className={cn(
        "flex items-center gap-2 rounded-full py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
        className,
      )}
      href="/"
    >
      {/* Mark: a closed loop — literally the product. */}
      <svg
        aria-hidden
        className="size-5 text-zinc-900"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.25"
        viewBox="0 0 24 24"
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
      <span className="font-display text-[17px] font-semibold tracking-tight text-zinc-900">
        marketer.sh
      </span>
    </Link>
  );
}

function Caret({ open }: { open?: boolean }) {
  return (
    <svg
      aria-hidden
      className={cn(
        "size-3.5 text-zinc-400 transition-transform duration-200",
        open && "rotate-180",
      )}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Announcement banner                                                 */
/* ------------------------------------------------------------------ */

const BANNER_SEGMENTS = [
  "Meet the marketer.sh suite: Studio, Press, and Ads",
  "One brief, every format",
  "Hard caps on every dollar",
  "Your agents ship the campaign",
  "See what shipped this week",
];

function AnnouncementBanner() {
  return (
    <Link
      aria-label="Announcement: Meet the marketer.sh suite — see what shipped"
      className="block bg-zinc-950 text-[13px] text-zinc-300 transition-colors hover:text-white"
      href="/resources/changelog"
    >
      <Marquee ariaLabel={undefined} className="min-h-10 items-center" seconds={36}>
        {BANNER_SEGMENTS.map((seg, i) => (
          <span className="flex items-center" key={i}>
            <span className={cn("whitespace-nowrap px-5", i === 0 && "font-semibold text-white")}>
              {seg}
            </span>
            <span
              aria-hidden
              className="size-1 rounded-full bg-[linear-gradient(135deg,#f59e0b,#f43f5e)]"
            />
          </span>
        ))}
      </Marquee>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop mega panel                                                  */
/* ------------------------------------------------------------------ */

function MegaPanel({
  panelKey,
  onNavigate,
}: {
  panelKey: MenuKey;
  onNavigate: () => void;
}) {
  const columns = PANELS[panelKey];
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[1.2fr_1.2fr_0.8fr] gap-10 px-8 py-9">
      {columns.map((col) => (
        <div key={col.heading}>
          <p className="pb-4 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
            {col.heading}
          </p>
          <ul className={cn(col.plain ? "space-y-3.5" : "space-y-1.5")}>
            {col.items.map((item) =>
              col.plain ? (
                <li key={item.href}>
                  <Link
                    className="text-[15px] font-medium text-zinc-700 transition-colors hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                    href={item.href}
                    onClick={onNavigate}
                  >
                    {item.title}
                  </Link>
                </li>
              ) : (
                <li key={item.href}>
                  <Link
                    className="group -mx-2.5 flex items-center gap-3.5 rounded-2xl p-2.5 transition-colors hover:bg-zinc-900/[0.04] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
                    href={item.href}
                    onClick={onNavigate}
                  >
                    {item.icon ? <IconTile kind={item.icon} /> : null}
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-zinc-900">
                        {item.title}
                      </span>
                      {item.desc ? (
                        <span className="mt-0.5 block text-[13px] leading-snug text-zinc-500">
                          {item.desc}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile overlay                                                      */
/* ------------------------------------------------------------------ */

function MobileOverlay({ onClose }: { onClose: () => void }) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = React.useState<MenuKey | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    closeRef.current?.focus();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-label="Menu"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-white lg:hidden"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      role="dialog"
      transition={{ duration: reduced ? 0.15 : 0.25, ease: "easeOut" }}
    >
      <div className="flex items-center justify-between border-b border-zinc-900/[0.06] px-5 py-3">
        <Wordmark />
        <button
          aria-label="Close menu"
          className="flex size-11 items-center justify-center rounded-full border border-zinc-900/10 text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
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

      <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-5 py-4">
        <ul className="divide-y divide-zinc-900/[0.06]">
          {MENUS.map((m) => {
            const isOpen = expanded === m.key;
            return (
              <li key={m.key}>
                <button
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between py-4 text-left text-[17px] font-semibold text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
                  onClick={() => setExpanded(isOpen ? null : m.key)}
                  type="button"
                >
                  {m.label}
                  <Caret open={isOpen} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      animate={{ height: "auto", opacity: 1 }}
                      className="overflow-hidden"
                      exit={{ height: 0, opacity: 0 }}
                      initial={
                        reduced
                          ? { height: "auto", opacity: 0 }
                          : { height: 0, opacity: 0 }
                      }
                      transition={{ duration: reduced ? 0.15 : 0.3, ease: EASE }}
                    >
                      <ul className="space-y-1 pb-4">
                        {PANELS[m.key].flatMap((col) => col.items).map((item) => (
                          <li key={item.href}>
                            <Link
                              className="flex items-center gap-3 rounded-xl px-1 py-2"
                              href={item.href}
                              onClick={onClose}
                            >
                              {item.icon ? <IconTile kind={item.icon} /> : null}
                              <span className="min-w-0">
                                <span className="block text-[15px] font-medium text-zinc-800">
                                  {item.title}
                                </span>
                                {item.desc ? (
                                  <span className="mt-0.5 block text-[12.5px] leading-snug text-zinc-500">
                                    {item.desc}
                                  </span>
                                ) : null}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
          {PLAIN_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                className="block py-4 text-[17px] font-semibold text-zinc-900"
                href={l.href}
                onClick={onClose}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid grid-cols-2 gap-3 border-t border-zinc-900/[0.06] px-5 py-4">
        <Link
          className="flex min-h-11 items-center justify-center rounded-lg bg-zinc-100 text-sm font-semibold text-zinc-900"
          href="/sign-in"
          onClick={onClose}
        >
          Login
        </Link>
        <Link
          className="flex min-h-11 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white"
          href="/sign-up"
          onClick={onClose}
        >
          Sign up
        </Link>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* The nav                                                             */
/* ------------------------------------------------------------------ */

export function MarketingNav() {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState<MenuKey | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const triggerRefs = React.useRef<Partial<Record<MenuKey, HTMLButtonElement>>>(
    {},
  );

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

  return (
    <>
      <AnnouncementBanner />
      <header className="sticky top-0 z-50">
        <div
          className="relative border-b border-zinc-900/[0.06] bg-white/90 backdrop-blur-xl"
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onMouseLeave={close}
          ref={wrapperRef}
        >
          <nav
            aria-label="Primary"
            className="mx-auto flex h-16 max-w-7xl items-center gap-1 px-5"
          >
            <Wordmark className="mr-4" />

            {/* Desktop items */}
            <div className="hidden items-center gap-0.5 lg:flex">
              {MENUS.map((m) => (
                <button
                  aria-controls={`nav-panel-${m.key}`}
                  aria-expanded={open === m.key}
                  aria-haspopup="true"
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-900/[0.05] hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900",
                    open === m.key && "bg-zinc-900/[0.05] text-zinc-950",
                    // The flagship chip, like the reference's highlighted AI item.
                    m.chip &&
                      "border border-zinc-900/10 bg-zinc-50 pl-2.5 hover:bg-zinc-100",
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
                  {m.chip ? (
                    <span
                      aria-hidden
                      className="size-2 rounded-full bg-[linear-gradient(135deg,#f59e0b,#f43f5e)]"
                    />
                  ) : null}
                  {m.label}
                  <Caret open={open === m.key} />
                </button>
              ))}
              {PLAIN_LINKS.map((l) => (
                <Link
                  className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-900/[0.05] hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
                  href={l.href}
                  key={l.href}
                  onFocus={close}
                  onMouseEnter={close}
                >
                  {l.label}
                </Link>
              ))}
            </div>

            <div className="flex-1" />

            {/* Desktop auth */}
            <div className="hidden items-center gap-2.5 lg:flex">
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
                href="/company"
              >
                Contact sales
              </Link>
              <Link
                className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
                href="/sign-in"
              >
                Login
              </Link>
              <Link
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                href="/sign-up"
              >
                Sign up
              </Link>
            </div>

            {/* Mobile hamburger */}
            <button
              aria-expanded={mobileOpen}
              aria-label="Open menu"
              className="flex size-11 items-center justify-center rounded-lg text-zinc-900 lg:hidden"
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
          </nav>

          {/* Full-width mega panel, reference-style: drops from the bar edge. */}
          <AnimatePresence>
            {open && (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="absolute inset-x-0 top-full hidden border-b border-zinc-900/[0.08] bg-white shadow-[0_32px_64px_rgba(15,23,42,0.10)] lg:block"
                exit={{ opacity: 0, y: -8 }}
                id={`nav-panel-${open}`}
                initial={
                  reduced ? { opacity: 0, y: 0 } : { opacity: 0, y: -8 }
                }
                key={open}
                transition={{ duration: reduced ? 0.12 : 0.22, ease: EASE }}
              >
                <MegaPanel onNavigate={close} panelKey={open} />
              </motion.div>
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
