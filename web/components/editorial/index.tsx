"use client";

/**
 * Editorial primitives — the product's own vocabulary.
 *
 * The app used to render every surface as cards-in-a-column, because that
 * is what the vendored dashboard template did. But a beat timeline, a
 * 0-100 audit score, a spend ledger and an ad gallery are different
 * information shapes, and flattening them into one shape is precisely
 * what made the product look generic.
 *
 * These are the nouns this product actually has and no template ships:
 *
 *   PageTitle    display-serif page opening — no card, no icon
 *   Figure       an artifact as the substrate, with its caption
 *   Provenance   which model made it, what it cost, how long it took
 *   Stages       where a piece of staged work has got to
 *   Metric       one quantity, set large in mono
 *   SpendMeter   money against a cap
 *
 * Rules the whole system follows:
 *   - Quantities are ALWAYS mono + tabular-nums, so columns align and a
 *     changing value doesn't reflow its neighbours.
 *   - Serif is display only. It is never used below ~20px.
 *   - Colour carries meaning, not decoration. Status has a palette;
 *     nothing else does.
 *   - No icon stands in for a word that would fit.
 */

import * as React from "react";

import { AgentMark } from "@/components/orb";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ layout

/**
 * A page opening. Display serif, generous space beneath, optional lede
 * clamped to a readable measure. Deliberately not a Card — an editorial
 * page starts with type, not with chrome.
 */
export function PageTitle({
  title,
  lede,
  actions,
  className,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-10 flex items-start justify-between gap-8", className)}>
      <div className="min-w-0">
        <h1 className="font-editorial text-4xl leading-[1.05] tracking-tight text-foreground md:text-5xl">
          {title}
        </h1>
        {lede ? (
          <p className="mt-3 max-w-(--measure) text-[15px] leading-relaxed text-muted-foreground">
            {lede}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A titled band of content. The editorial answer to a Card: a rule and a
 * small caps label instead of a box, so nesting never produces the
 * box-inside-a-box-inside-a-box look.
 */
export function Section({
  label,
  aside,
  children,
  className,
}: {
  label?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-12", className)}>
      {label ? (
        <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-border pb-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </h2>
          {aside ? <div className="text-xs text-muted-foreground">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ------------------------------------------------------------------- media

/**
 * An artifact and its caption. The image/video is the substrate — it sits
 * flush at full width with no padding around it, and the caption hangs
 * beneath in small type. This is the inversion the redesign is about:
 * previously media was a thumbnail inside chrome.
 *
 * `ratio` keeps the frame reserved before the asset loads, so a gallery
 * doesn't reflow as images arrive.
 */
export function Figure({
  ratio = "1 / 1",
  caption,
  aside,
  children,
  className,
}: {
  ratio?: string;
  caption?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("group min-w-0", className)}>
      <div
        className="relative overflow-hidden bg-muted"
        style={{ aspectRatio: ratio }}
      >
        {children}
      </div>
      {caption || aside ? (
        <figcaption className="mt-2.5 flex items-baseline justify-between gap-3">
          {caption ? (
            <span className="min-w-0 truncate font-editorial text-[17px] leading-snug text-foreground">
              {caption}
            </span>
          ) : (
            <span />
          )}
          {aside ? (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {aside}
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A gallery grid sized by the artifact, not by a fixed column count. */
export function Gallery({
  min = "260px",
  children,
  className,
}: {
  min?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-x-5 gap-y-8", className)}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))` }}
    >
      {children}
    </div>
  );
}

// -------------------------------------------------------------- provenance

export interface ProvenanceItem {
  label: string;
  value: React.ReactNode;
  /** Renders in mono + tabular-nums. Use for anything countable. */
  numeric?: boolean;
}

/**
 * Where an artifact came from: model, cost, duration, prompt.
 *
 * This exists because the product's defining fact is that an agent spent
 * the user's money to produce something. Previously that was a badge in a
 * table, if it was shown at all. Here it is a first-class object and it
 * sits with the artifact it describes.
 */
export function Provenance({
  items,
  className,
}: {
  items: ProvenanceItem[];
  className?: string;
}) {
  const shown = items.filter((i) => i.value !== null && i.value !== undefined && i.value !== "");
  if (shown.length === 0) return null;
  return (
    <dl className={cn("flex flex-wrap items-baseline gap-x-5 gap-y-1.5", className)}>
      {shown.map((item) => (
        <div className="flex items-baseline gap-1.5" key={item.label}>
          <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {item.label}
          </dt>
          <dd
            className={cn(
              "text-xs text-foreground",
              item.numeric && "font-mono tabular-nums",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ status

export type StageState = "pending" | "active" | "done" | "failed" | "skipped";

const STAGE_MARK: Record<StageState, string> = {
  // Marks, not icons: they read at any size, need no colour to be
  // distinguishable, and survive a screenshot or a colourblind viewer.
  pending: "○",
  active: "◐",
  done: "●",
  failed: "×",
  skipped: "–",
};

const STAGE_TONE: Record<StageState, string> = {
  pending: "text-muted-foreground/60",
  active: "text-accent-blue",
  done: "text-foreground",
  failed: "text-destructive",
  skipped: "text-muted-foreground/40",
};

/**
 * Where staged work has got to. A status badge says "generating"; this
 * says which of nine stages ran, which is where it stopped, and what
 * remains — the difference between a label and an explanation.
 */
export function Stages({
  stages,
  className,
}: {
  stages: { key: string; label: string; state: StageState; detail?: React.ReactNode }[];
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-1 gap-y-2", className)}>
      {stages.map((stage, index) => (
        <li className="flex items-center gap-1" key={stage.key}>
          {index > 0 ? (
            <span aria-hidden className="mr-1 text-border">
              /
            </span>
          ) : null}
          <span
            aria-hidden
            className={cn("font-mono text-[11px] leading-none", STAGE_TONE[stage.state])}
          >
            {STAGE_MARK[stage.state]}
          </span>
          <span
            className={cn(
              "text-xs",
              stage.state === "done" || stage.state === "active"
                ? "text-foreground"
                : "text-muted-foreground",
              stage.state === "failed" && "text-destructive",
            )}
            title={stage.detail ? String(stage.detail) : undefined}
          >
            {stage.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ numbers

/**
 * One quantity, set large. Mono and tabular so a row of these aligns and
 * a live-updating value never reflows what sits beside it.
 */
export function Metric({
  label,
  value,
  unit,
  hint,
  tone = "default",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "positive" | "negative" | "muted";
  className?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-[hsl(var(--cat-green))]",
    negative: "text-destructive",
    muted: "text-muted-foreground",
  }[tone];

  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cn("font-mono text-2xl tabular-nums leading-none", toneClass)}>
          {value}
        </span>
        {unit ? (
          <span className="font-mono text-xs text-muted-foreground">{unit}</span>
        ) : null}
      </div>
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/**
 * Money against a cap.
 *
 * Spend is the one number in this product that can stop work happening,
 * so it gets a dedicated primitive rather than a generic progress bar:
 * it always states the cap, and it changes tone before the cap is hit
 * rather than at the moment it is — a bar that only turns red on failure
 * tells you something you already found out.
 */
export function SpendMeter({
  spent,
  cap,
  label = "Spend today",
  className,
}: {
  spent: number;
  cap?: number | null;
  label?: React.ReactNode;
  className?: string;
}) {
  const usd = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!cap || cap <= 0) {
    return <Metric className={className} label={label} value={usd(spent)} />;
  }

  const ratio = Math.min(spent / cap, 1);
  const pct = Math.round(ratio * 100);
  // Warn at 80%: the point of a cap is to change behaviour before it bites.
  const tone = ratio >= 1 ? "negative" : ratio >= 0.8 ? "negative" : "default";
  const barTone =
    ratio >= 1
      ? "bg-destructive"
      : ratio >= 0.8
        ? "bg-[hsl(var(--cat-orange))]"
        : "bg-foreground";

  return (
    <div className={cn("min-w-0", className)}>
      <Metric
        hint={`${pct}% of ${usd(cap)} cap`}
        label={label}
        tone={tone}
        value={usd(spent)}
      />
      <div
        aria-label={`${pct}% of daily cap used`}
        className="mt-2 h-px w-full bg-border"
        role="img"
      >
        <div className={cn("h-px transition-all", barTone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ agent

/**
 * An agent is working on this.
 *
 * Distinct from a spinner on purpose: a spinner means "the page is
 * fetching", this means "an autonomous agent is spending your money and
 * producing something". Those are different promises and they should not
 * look alike, which is why the mark appears here and nowhere generic.
 */
export function AgentWorking({
  title,
  children,
  size = 72,
  className,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-5 border-t border-border py-12", className)}>
      <div className="grid shrink-0 place-items-center rounded-full bg-black" style={{ width: size, height: size }}>
        <AgentMark size={Math.round(size * 0.86)} />
      </div>
      <div className="min-w-0">
        <h3 className="font-editorial text-2xl text-foreground">{title}</h3>
        {children ? (
          <p className="mt-1 max-w-(--measure-narrow) text-sm leading-relaxed text-muted-foreground">
            {children}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- empty

/**
 * Nothing here yet. Type-led, no illustration, no icon — an empty state
 * should explain, and an illustration is one more thing that makes every
 * product look like every other product.
 */
export function Empty({
  title,
  children,
  action,
  className,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-t border-border py-16", className)}>
      <h3 className="font-editorial text-2xl text-foreground">{title}</h3>
      {children ? (
        <p className="mt-2 max-w-(--measure-narrow) text-sm leading-relaxed text-muted-foreground">
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
