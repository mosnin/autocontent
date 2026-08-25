/**
 * Section primitives in the transcribed export's design language.
 *
 * The homepage body (`components/site/page-full.tsx`) is generated from the
 * Framer export and can't be hand-edited, so its vocabulary is re-expressed
 * here as small composable pieces: a ruled section shell, the mono uppercase
 * eyebrow chip, the heavy display heading with a teal-highlighted phrase,
 * hairline cards on the #0F1514 surface, corner-ticked frames.
 *
 * Every inner marketing page is built from these instead of Tailwind colour
 * utilities, so the whole site shares one source of truth for the language.
 * All styling lives in `sections.css`; these components only compose class
 * names, which keeps them server components.
 */
import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import "./sections.css";

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

/**
 * A full-bleed band: page gutter outside, 1px vertical rules at the
 * container edges, the export's vertical rhythm inside. `inset` adds the
 * inner 62px content gutter the homepage's section headers sit in.
 */
export function Section({
  children,
  label,
  id,
  size = "default",
  flush = false,
  inset = true,
  className,
  innerClassName,
}: {
  children: React.ReactNode;
  /** aria-label for the landmark. */
  label?: string;
  id?: string;
  size?: "default" | "tight" | "top";
  /** Drop the side rules so two stacked bands read as one column. */
  flush?: boolean;
  inset?: boolean;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "os-section",
        size === "tight" && "os-section--tight",
        size === "top" && "os-section--top",
        flush && "os-section--flush",
        className,
      )}
      id={id}
    >
      <div className={cn("os-section__inner", innerClassName)}>
        <div className={cn(inset && "os-inset")}>{children}</div>
      </div>
    </section>
  );
}

/** Hairline with a tick at each end - the export's section divider. */
export function Rule({ className }: { className?: string }) {
  return <div aria-hidden className={cn("os-rule", className)} />;
}

/** Bordered box with a cross at each corner. */
export function Frame({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "figure";
}) {
  return (
    <Tag className={cn("os-frame", className)}>
      <span aria-hidden className="os-tick os-tick--tl" />
      <span aria-hidden className="os-tick os-tick--tr" />
      <span aria-hidden className="os-tick os-tick--bl" />
      <span aria-hidden className="os-tick os-tick--br" />
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Type                                                                */
/* ------------------------------------------------------------------ */

function EyebrowMark() {
  return (
    <span aria-hidden className="os-eyebrow__mark">
      <svg
        fill="none"
        height="12"
        stroke="currentColor"
        strokeLinecap="square"
        strokeWidth="1.6"
        viewBox="0 0 12 12"
        width="12"
      >
        <path d="M2 6h8M6 2v8" />
      </svg>
    </span>
  );
}

/** The mono uppercase chip that opens every section on the homepage. */
export function Eyebrow({
  children,
  className,
  plain = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Render as a bare label instead of the chip. */
  plain?: boolean;
}) {
  if (plain) {
    return <p className={cn("os-label", className)}>{children}</p>;
  }
  return (
    <p className={cn("os-eyebrow", className)}>
      <EyebrowMark />
      {children}
    </p>
  );
}

/**
 * The display heading. `highlight` paints one phrase of `children` in the
 * teal accent, the way the homepage highlights a phrase per section.
 */
export function Heading({
  children,
  level = 2,
  size = "lg",
  highlight,
  className,
}: {
  children: React.ReactNode;
  level?: 1 | 2 | 3;
  size?: "xl" | "lg" | "md" | "sm";
  /** Substring of `children` (when it is a plain string) to accent. */
  highlight?: string;
  className?: string;
}) {
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  const cls = cn("os-h", `os-h--${size}`, className);

  if (highlight && typeof children === "string") {
    const at = children.toLowerCase().indexOf(highlight.toLowerCase());
    if (at >= 0) {
      return (
        <Tag className={cls}>
          {children.slice(0, at)}
          <em className="os-hl">{children.slice(at, at + highlight.length)}</em>
          {children.slice(at + highlight.length)}
        </Tag>
      );
    }
  }

  return <Tag className={cls}>{children}</Tag>;
}

/** Card / block title in the lighter Inter Display face. */
export function Title({
  children,
  level = 3,
  size = "md",
  className,
}: {
  children: React.ReactNode;
  level?: 2 | 3 | 4;
  size?: "md" | "sm";
  className?: string;
}) {
  const Tag = `h${level}` as "h2" | "h3" | "h4";
  return (
    <Tag className={cn("os-title", size === "sm" && "os-title--sm", className)}>
      {children}
    </Tag>
  );
}

export function Lede({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={cn("os-lede", className)}>{children}</p>;
}

export function Body({
  children,
  className,
  bright = false,
}: {
  children: React.ReactNode;
  className?: string;
  bright?: boolean;
}) {
  return (
    <p className={cn("os-body", bright && "os-body--bright", className)}>
      {children}
    </p>
  );
}

/** eyebrow → heading → lede, the standard opening of a band. */
export function SectionHead({
  eyebrow,
  heading,
  highlight,
  lede,
  level = 2,
  size = "lg",
  align = "left",
  children,
  className,
}: {
  eyebrow?: string;
  heading: React.ReactNode;
  highlight?: string;
  lede?: React.ReactNode;
  level?: 1 | 2 | 3;
  size?: "xl" | "lg" | "md" | "sm";
  align?: "left" | "center";
  /** Extra row under the lede (CTAs, chips). */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("os-head", align === "center" && "os-head--center", className)}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Heading highlight={highlight} level={level} size={size}>
        {heading}
      </Heading>
      {lede ? <Lede>{lede}</Lede> : null}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

export function CardGrid({
  children,
  cols = 3,
  className,
}: {
  children: React.ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div className={cn("os-grid", `os-grid--${cols}`, className)}>{children}</div>
  );
}

export function Card({
  children,
  href,
  className,
  padding = "default",
  tone = "surface",
}: {
  children: React.ReactNode;
  href?: string;
  className?: string;
  padding?: "default" | "lg";
  tone?: "surface" | "raised" | "accent";
}) {
  const cls = cn(
    "os-card",
    padding === "lg" && "os-card--pad-lg",
    tone === "raised" && "os-card--raised",
    tone === "accent" && "os-card--accent",
    className,
  );

  if (href) {
    return (
      <Link className={cls} href={href}>
        {children}
      </Link>
    );
  }
  return <div className={cls}>{children}</div>;
}

/** The quiet arrow row pinned to a card's bottom edge. */
export function CardLink({ children }: { children: React.ReactNode }) {
  return (
    <span className="os-cardlink">
      {children}
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
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export function Btn({
  href,
  children,
  variant = "primary",
  size = "md",
  block = false,
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "accent";
  size?: "md" | "lg";
  block?: boolean;
  className?: string;
}) {
  const cls = cn(
    "os-btn",
    `os-btn--${variant}`,
    size === "lg" && "os-btn--lg",
    block && "os-btn--block",
    className,
  );
  const external = href.startsWith("http") || href.startsWith("mailto:");

  if (external) {
    return (
      <a className={cls} href={href}>
        {children}
      </a>
    );
  }
  return (
    <Link className={cls} href={href}>
      {children}
    </Link>
  );
}

export function Actions({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn("os-actions", align === "center" && "os-actions--center", className)}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lists, stats, media                                                 */
/* ------------------------------------------------------------------ */

export function Bullets({
  items,
  className,
}: {
  items: React.ReactNode[];
  className?: string;
}) {
  return (
    <ul className={cn("os-bullets", className)}>
      {items.map((item, i) => (
        <li key={i}>
          {/* One flex child, so multi-element bullets (a <strong> lead-in
              plus its sentence) stay on one text flow instead of becoming
              two columns. */}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Stats({
  items,
  className,
}: {
  items: Array<{ value: React.ReactNode; label: string }>;
  className?: string;
}) {
  return (
    <div className={cn("os-stats", className)}>
      {items.map((s) => (
        <div className="os-stat" key={s.label}>
          <p className="os-stat__value">{s.value}</p>
          <p className="os-stat__label">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Where a screenshot, render, or diagram goes. Dark ground, a whisper of
 * the accent dot-matrix, one mono tag naming the asset - the dark-mode
 * twin of the old `TaggedPlaceholder`.
 */
export function MediaSlot({
  kind,
  label,
  className,
}: {
  kind: "video" | "image" | "illustration";
  label: string;
  className?: string;
}) {
  return (
    <div
      aria-label={`Placeholder ${kind}: ${label}`}
      className={cn("os-media", className)}
      data-placeholder={kind}
      role="img"
    >
      <span className="os-media__tag">
        {kind}: {label}
      </span>
    </div>
  );
}

/** Frames a media slot the way the homepage stages its product shots. */
export function Stage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("os-stage", className)}>{children}</div>;
}

export function Chip({
  children,
  accent = false,
  className,
}: {
  children: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("os-chip", accent && "os-chip--accent", className)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Two-column band                                                     */
/* ------------------------------------------------------------------ */

/**
 * The workhorse of the inner pages: copy on one side (eyebrow → heading →
 * lede → bullets → CTA), a staged product shot on the other. `flip` puts
 * the media first on desktop; both columns stack copy-first on mobile.
 */
export function Band({
  eyebrow,
  heading,
  highlight,
  lede,
  extraCopy,
  bullets,
  cta,
  media,
  flip = false,
  label,
  id,
  children,
}: {
  eyebrow?: string;
  heading: string;
  highlight?: string;
  lede?: React.ReactNode;
  /** A second paragraph under the lede. */
  extraCopy?: React.ReactNode;
  bullets?: React.ReactNode[];
  cta?: { label: string; href: string };
  media?: React.ReactNode;
  flip?: boolean;
  label?: string;
  id?: string;
  /** Extra content between the lede and the bullets. */
  children?: React.ReactNode;
}) {
  return (
    <Section id={id} label={label ?? eyebrow}>
      <div className={cn(media ? "os-split" : undefined)}>
        <div className={cn(flip && "os-split__flip", flip && "os-order-2")}>
          <SectionHead
            eyebrow={eyebrow}
            heading={heading}
            highlight={highlight}
            lede={lede}
          />
          {children}
          {extraCopy ? <Lede className="os-mt-16">{extraCopy}</Lede> : null}
          {bullets && bullets.length > 0 ? (
            <Bullets className="os-mt-32" items={bullets} />
          ) : null}
          {cta ? (
            <Actions className="os-mt-32">
              <Btn href={cta.href} variant="secondary">
                {cta.label}
              </Btn>
            </Actions>
          ) : null}
        </div>
        {media ? (
          <div className={cn(flip && "os-split__flip", flip && "os-order-1")}>
            {media}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/** A staged media slot at a fixed aspect - the band's right-hand column. */
export function MediaCard({
  kind,
  label,
  ratio = "4/3",
  className,
}: {
  kind: "video" | "image" | "illustration";
  label: string;
  ratio?: "4/3" | "16/9" | "16/8";
  className?: string;
}) {
  const aspect =
    ratio === "16/9"
      ? "os-aspect-169"
      : ratio === "16/8"
        ? "os-aspect-168"
        : "os-aspect-43";
  return (
    <Stage className={className}>
      <MediaSlot className={aspect} kind={kind} label={label} />
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* Closing CTA                                                         */
/* ------------------------------------------------------------------ */

/**
 * The band every marketing page ends with: centred heading, one line of
 * standfirst, two CTAs, inside a corner-ticked frame.
 */
export function CtaBand({
  eyebrow = "Get started",
  heading,
  highlight,
  sub,
  primary = { label: "Start free", href: "/sign-up" },
  secondary = { label: "See pricing", href: "/pricing" },
}: {
  eyebrow?: string;
  heading: string;
  highlight?: string;
  sub?: string;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
}) {
  return (
    <Section inset={false} label="Get started" size="tight">
      <div className="os-inset">
        <Frame className="os-cta">
          <div className="os-cta__body">
            <SectionHead
              align="center"
              eyebrow={eyebrow}
              heading={heading}
              highlight={highlight}
              lede={sub}
            >
              <Actions align="center" className="os-mt-16">
                <Btn href={primary.href} size="lg">
                  {primary.label}
                </Btn>
                <Btn href={secondary.href} size="lg" variant="secondary">
                  {secondary.label}
                </Btn>
              </Actions>
            </SectionHead>
          </div>
        </Frame>
      </div>
    </Section>
  );
}
