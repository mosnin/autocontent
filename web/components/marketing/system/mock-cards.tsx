"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { GlassPanel } from "./glass-panel";
import { EASE } from "./motion";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

/** The recording light: a small pulsing brand-orange dot. */
function RecordingDot({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <span className={cn("relative flex size-2", className)}>
      {!reduced && (
        <motion.span
          animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
          className="absolute inline-flex h-full w-full rounded-full bg-brand"
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className="relative inline-flex size-2 rounded-full bg-brand" />
    </span>
  );
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "recording" | "scheduled" | "published" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        tone === "recording" && "border-brand/20 bg-brand/[0.07] text-zinc-700",
        tone === "scheduled" && "border-zinc-900/10 bg-white/80 text-zinc-500",
        tone === "published" &&
          "border-emerald-600/15 bg-emerald-50/80 text-emerald-700",
        tone === "neutral" && "border-zinc-900/10 bg-white/80 text-zinc-500",
      )}
    >
      {tone === "recording" && <RecordingDot />}
      {tone === "published" && (
        <svg
          aria-hidden
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
        >
          <path d="m5 13 4 4L19 7" />
        </svg>
      )}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* MockChat — the agent conversation card (reference #3 bubbles)       */
/* ------------------------------------------------------------------ */

const CHAT: Array<{ from: "agent" | "user"; text: string }> = [
  { from: "user", text: "Morning. Where's the espresso campaign?" },
  {
    from: "agent",
    text: "Drafted 4 videos and 2 articles for review. $3.80 of $10 cap used.",
  },
  { from: "user", text: "Approve the top two videos." },
  {
    from: "agent",
    text: "Scheduled for 9:00 and 12:30. I'll report back with retention.",
  },
];

/**
 * Floating glass chat card: an agent status conversation in soft
 * iMessage-style bubbles. Bubbles stagger in on view.
 */
export function MockChat({ className }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <GlassPanel
      className={cn(
        "w-full max-w-sm p-5 ring-1 ring-inset ring-white/50",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-zinc-900/[0.06] pb-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="rounded-full bg-gradient-to-br from-sky-300 via-indigo-200 to-rose-200 p-[2px]"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 ring-2 ring-white/90">
              <span className="size-2 rounded-full bg-zinc-900/70" />
            </span>
          </span>
          <div>
            <p className="text-[13px] font-semibold text-zinc-900">
              marketer.sh agent
            </p>
            <p className="text-[11px] text-zinc-400">home-espresso channel</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-900/10 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          online now
        </span>
      </div>

      <p className="mt-3 text-center text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-300">
        Today 9:02 AM
      </p>

      <motion.ul
        className="mt-2 space-y-2.5"
        initial={reduced ? false : "hidden"}
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.35, delayChildren: 0.3 } },
        }}
        viewport={{ once: true, margin: "-40px" }}
        whileInView="show"
      >
        {CHAT.map((m, i) => (
          <motion.li
            className={cn("flex", m.from === "user" && "justify-end")}
            key={i}
            variants={{
              hidden: { opacity: 0, y: 10, scale: 0.98 },
              show: {
                opacity: 1,
                y: 0,
                scale: 1,
                transition: { duration: 0.45, ease: EASE },
              },
            }}
          >
            <p
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug",
                m.from === "agent"
                  ? "rounded-bl-md border border-zinc-900/[0.06] bg-white text-zinc-700 shadow-sm"
                  : "rounded-br-md bg-zinc-900 text-white",
              )}
            >
              {m.text}
            </p>
          </motion.li>
        ))}
      </motion.ul>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/* MockDashboard — queue + article product-UI cards                    */
/* ------------------------------------------------------------------ */

const QUEUE_ROWS = [
  {
    title: "3 grinder mistakes ruining your shots",
    channel: "YouTube Shorts",
    tone: "recording" as const,
    status: "Rendering",
  },
  {
    title: "Dial in espresso in 60 seconds",
    channel: "TikTok",
    tone: "scheduled" as const,
    status: "Today, 12:30",
  },
  {
    title: "Why your milk won't stretch",
    channel: "Reels",
    tone: "published" as const,
    status: "Published",
  },
];

function QueueCard({ className }: { className?: string }) {
  return (
    <GlassPanel
      className={cn(
        "w-full max-w-sm p-5 ring-1 ring-inset ring-white/50",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-zinc-900">
            Publish queue
          </p>
          <p className="text-[11px] text-zinc-400">updated 2 min ago</p>
        </div>
        <span className="rounded-full bg-zinc-900/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-500">
          home-espresso
        </span>
      </div>
      <ul className="mt-4 space-y-2">
        {QUEUE_ROWS.map((row) => (
          <li
            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
            key={row.title}
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-zinc-800">
                {row.title}
              </p>
              <p className="text-[11px] text-zinc-400">{row.channel}</p>
            </div>
            <StatusPill tone={row.tone}>{row.status}</StatusPill>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}

function ArticleCard({ className }: { className?: string }) {
  return (
    <GlassPanel
      className={cn(
        "w-full max-w-sm p-5 ring-1 ring-inset ring-white/50",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-zinc-900">SEO article</p>
          <p className="text-[11px] text-zinc-400">drafted 8:41 AM</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/15 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          Score 94
        </span>
      </div>
      <div className="mt-4 rounded-xl border border-zinc-900/[0.05] bg-white/80 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
        <p className="text-[11px] text-emerald-700">
          marketer.sh/blog/best-home-espresso-machines
        </p>
        <p className="mt-1 text-[13px] font-medium leading-snug text-sky-800">
          Best home espresso machines in 2026, tested by baristas
        </p>
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-zinc-500">
          We pulled 400 shots on 9 machines under $800. Three are worth your
          counter space, and one beats machines twice its price.
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["best espresso machine", "under $800", "beginner"].map((kw) => (
          <span
            className="rounded-full bg-zinc-900/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-500"
            key={kw}
          >
            {kw}
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}

/**
 * Hand-built glass product-UI cards. `variant="queue"` is the publish
 * queue with pulsing recording-dot statuses; `variant="article"` is the
 * SEO article card with a search-result preview.
 */
export function MockDashboard({
  variant = "queue",
  className,
}: {
  variant?: "queue" | "article";
  className?: string;
}) {
  return variant === "queue" ? (
    <QueueCard className={className} />
  ) : (
    <ArticleCard className={className} />
  );
}
