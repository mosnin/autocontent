import * as React from "react";

import {
  Actions,
  Btn,
  Card,
  CardGrid,
  MediaSlot,
  Section,
  SectionHead,
  Stage,
  Stats,
  Title,
  Body,
} from "@/components/site/sections";
import { type Stat } from "@/components/marketing/system";

import { type SceneName } from "./scene";

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

/** The last two words of a line — what the accent lands on by default. */
function lastWords(line: string, count = 2) {
  const words = line.split(" ");
  return words.slice(Math.max(0, words.length - count)).join(" ");
}

/**
 * Use-case page hero: centred eyebrow → headline → lede → CTAs inside the
 * ruled section container, with an optional staged still underneath.
 * Exactly one per page (it owns the h1).
 */
export function UseCaseHero({
  kicker,
  headline,
  lede,
  scene: _scene,
  primaryLabel = "Start creating",
  primaryHref = "/sign-up",
  secondaryLabel = "See pricing",
  secondaryHref = "/pricing",
  placeholderLabel,
  placeholderTone: _placeholderTone = "slate",
  highlight,
}: {
  kicker: string;
  /** Headline lines; joined into the single display heading. */
  headline: string[];
  lede: string;
  scene: SceneName;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  /** When set, renders a tagged image placeholder under the hero copy. */
  placeholderLabel?: string;
  placeholderTone?: "warm" | "sky" | "violet" | "slate" | "rose";
  /** Phrase of the headline to paint in the accent. */
  highlight?: string;
}) {
  return (
    <Section label="Introduction" size="top">
      <SectionHead
        align="center"
        eyebrow={kicker}
        heading={headline.join(" ")}
        highlight={highlight ?? lastWords(headline[headline.length - 1] ?? "")}
        lede={lede}
        level={1}
        size="xl"
      >
        <Actions align="center" className="os-mt-16">
          <Btn href={primaryHref} size="lg">
            {primaryLabel}
          </Btn>
          <Btn href={secondaryHref} size="lg" variant="secondary">
            {secondaryLabel}
          </Btn>
        </Actions>
      </SectionHead>
      {placeholderLabel ? (
        <Stage className="os-mt-64">
          <MediaSlot
            className="os-aspect-168"
            kind="image"
            label={placeholderLabel}
          />
        </Stage>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* "The grind today" — short pain framing                              */
/* ------------------------------------------------------------------ */

export function PainBand({
  heading,
  lede,
  pains,
}: {
  heading: string;
  lede?: string;
  pains: Array<{ title: string; copy: string }>;
}) {
  return (
    <Section label="The grind today">
      <SectionHead eyebrow="The grind today" heading={heading} lede={lede} />
      <CardGrid className="os-mt-48">
        {pains.map((p) => (
          <Card key={p.title}>
            <span aria-hidden className="os-dot" />
            <Title className="os-mt-20" size="sm">
              {p.title}
            </Title>
            <Body className="os-mt-8">{p.copy}</Body>
          </Card>
        ))}
      </CardGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* "With marketer.sh" — the 3-step band                                */
/* ------------------------------------------------------------------ */

export function StepsBand({
  heading,
  lede,
  steps,
}: {
  heading: string;
  lede?: string;
  steps: Array<{ title: string; copy: string }>;
}) {
  return (
    <Section label="With marketer.sh">
      <SectionHead eyebrow="With marketer.sh" heading={heading} lede={lede} />
      <CardGrid className="os-mt-48">
        {steps.map((s, i) => (
          <Card key={s.title}>
            <span className="os-step__n">{String(i + 1).padStart(2, "0")}</span>
            <Title className="os-mt-20" size="sm">
              {s.title}
            </Title>
            <Body className="os-mt-8">{s.copy}</Body>
          </Card>
        ))}
      </CardGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Product-moment band — copy beside a staged mock                     */
/* ------------------------------------------------------------------ */

export function MockBand({
  kicker,
  heading,
  lede,
  bullets,
  scene: _scene,
  children,
  flip = false,
  highlight,
}: {
  kicker: string;
  heading: string;
  lede: string;
  bullets?: string[];
  scene: SceneName;
  /** The staged product-moment mock. */
  children: React.ReactNode;
  /** Put the mock on the left on desktop. */
  flip?: boolean;
  highlight?: string;
}) {
  return (
    <Section label="Product moment">
      <div className="os-split">
        <div className={flip ? "os-order-2" : undefined}>
          <SectionHead
            eyebrow={kicker}
            heading={heading}
            highlight={highlight}
            lede={lede}
          />
          {bullets && bullets.length > 0 ? (
            <ul className="os-bullets os-mt-32">
              {bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className={flip ? "os-order-1" : undefined}>
          <Stage>{children}</Stage>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

export function OutcomesBand({
  heading = "What changes",
  stats,
}: {
  heading?: string;
  stats: Stat[];
}) {
  return (
    <Section label="Outcomes" size="tight">
      <SectionHead
        align="center"
        eyebrow="Outcomes"
        heading={heading}
        size="md"
      />
      <Stats
        className="os-mt-48"
        items={stats.map((s) => ({
          value: `${s.prefix ?? ""}${s.value.toFixed(s.decimals ?? 0)}${s.suffix ?? ""}`,
          label: s.label,
        }))}
      />
    </Section>
  );
}
