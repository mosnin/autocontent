"use client";

import { animate, inView } from "motion";
import type { AnimationOptions, DOMKeyframesDefinition } from "motion";

/**
 * Scroll reveals - a transcription of the Framer appear effects the stripped
 * runtime used to run.
 *
 * The values below are not tuned by eye. They are lifted from the site's own
 * page bundle (`opsra/js/ta7db_…Dx_-JPiG.mjs`), where every revealed node is
 * rendered through Framer's `withFX` wrapper:
 *
 *   __framer__enter:      {opacity: 0, y: 50, scale: 1, rotate: 0, …}
 *   __framer__animate:    {transition: {bounce: 0, delay: .2, duration: 1, type: "spring"}}
 *   __framer__animateOnce: true
 *   __framer__threshold:  0
 *
 * and were then confirmed against the live export (Framer runtime intact) by
 * sampling `getComputedStyle` frame by frame: motion starts at t≈200ms /
 * t≈300ms and lands exactly 1000ms later, with the non-overshooting spring
 * curve a `bounce: 0` duration spring produces.
 *
 * Three distinct configs exist on this page:
 *   A  spring, bounce 0, duration 1s, delay 200ms  - 10 nodes (headings, hero)
 *   B  spring, bounce 0, duration 1s, delay 300ms  -  9 nodes (the body/media
 *      block that follows each heading, hence the 100ms offset)
 *   C  tween, 700ms, cubic-bezier(.21,.99,.33,1.04), delay 200ms, threshold .5
 *      - 1 node (the tall "Line" column in Features)
 *
 * Trigger: Framer's own predicate is
 *   height === 0 ? isIntersecting
 *                : isIntersecting &&
 *                  intersectionRect.height / min(rect.height, innerHeight) >= threshold
 * observed with `threshold: [0, .01, … .99]` and no root margin - reproduced
 * verbatim in `observeAppear` below. With threshold 0 that means "the moment
 * one pixel crosses the viewport edge"; `animateOnce` means it never reverses.
 *
 * The split headline is Framer's text appear effect:
 *
 *   {effect: {opacity: .001, y: 10}, startDelay: .4, threshold: .5,
 *    tokenization: "line",
 *    transition: {bounce: 0, delay: .075, duration: .6, type: "spring"},
 *    trigger: "onInView", type: "appear"}
 *
 * `tokenization: "line"` splits the copy per character for layout (that is why
 * the DOM holds one `<span>` per glyph inside per-word `white-space: nowrap`
 * wrappers) but animates them grouped by rendered line: the runtime buckets the
 * spans by `offsetTop` and staggers 75ms per *line*, not per character, after a
 * 400ms start delay. `groupIntoLines` is a port of that bucketing, so a reflow
 * at any breakpoint re-derives the same groups the original would have.
 */

/** A: 10 nodes. */
const SPRING_DELAY_200: AnimationOptions = {
  type: "spring",
  bounce: 0,
  duration: 1,
  delay: 0.2,
};

/** B: 9 nodes - the same spring, offset 100ms behind its heading. */
const SPRING_DELAY_300: AnimationOptions = {
  type: "spring",
  bounce: 0,
  duration: 1,
  delay: 0.3,
};

/** C: the one tween on the page. */
const TWEEN_DELAY_200: AnimationOptions = {
  type: "tween",
  duration: 0.7,
  ease: [0.21, 0.99, 0.33, 1.04],
  delay: 0.2,
};

/** Split-text: spring per line, 400ms in, 75ms between lines. */
const TEXT_TRANSITION: AnimationOptions = {
  type: "spring",
  bounce: 0,
  duration: 0.6,
  restDelta: 0.001,
};
const TEXT_START_DELAY = 0.4;
const TEXT_LINE_STAGGER = 0.075;
const TEXT_THRESHOLD = 0.5;

type AppearConfig = { transition: AnimationOptions; threshold: number };

/**
 * Framer's class hashes are stable per element, and page-full.tsx reproduces
 * them, so they are the join key between the bundle's config and the DOM.
 * Classes listed twice in the markup (responsive ssr-variants) are covered by
 * `querySelectorAll` - the hidden variants never intersect, so they never play.
 */
const APPEAR_BY_CLASS: Record<string, AppearConfig> = {
  // Hero
  "framer-1f53k36": { transition: SPRING_DELAY_200, threshold: 0 }, // Content Wrap
  "framer-7plajh": { transition: SPRING_DELAY_300, threshold: 0 }, // Content Wrap
  // Intro
  "framer-1ak1bcg": { transition: SPRING_DELAY_200, threshold: 0 }, // Heading Wrapper
  "framer-1x5bets": { transition: SPRING_DELAY_300, threshold: 0 }, // Content Wrapper
  // Features
  "framer-wilejv": { transition: SPRING_DELAY_200, threshold: 0 }, // Heading Wrapper
  "framer-6fkdqd": { transition: SPRING_DELAY_300, threshold: 0 }, // Feature Card Wrapper
  "framer-1p5cla2": { transition: TWEEN_DELAY_200, threshold: 0.5 }, // Line
  // Tabs
  "framer-1ugr84h": { transition: SPRING_DELAY_200, threshold: 0 }, // Heading Wrapper
  "framer-1bdcjyl": { transition: SPRING_DELAY_300, threshold: 0 }, // Tabs Wrapper
  // Cards
  "framer-1ook02j": { transition: SPRING_DELAY_200, threshold: 0 }, // Heading Wrapper
  "framer-bj1thg": { transition: SPRING_DELAY_300, threshold: 0 }, // Card Wrapper
  // Chat
  "framer-1yisqsj": { transition: SPRING_DELAY_200, threshold: 0 }, // Heading Wrapper
  "framer-1gpvua6": { transition: SPRING_DELAY_300, threshold: 0 }, // Animation and Chat Box
  // Comparison
  "framer-wgf2np": { transition: SPRING_DELAY_200, threshold: 0 }, // Heading Wrapper
  "framer-15r11w4": { transition: SPRING_DELAY_300, threshold: 0 }, // Comparision Wrapper
  // Pricing
  "framer-1ultfa9": { transition: SPRING_DELAY_200, threshold: 0 }, // Heading Wrapper
  "framer-r2pjmy": { transition: SPRING_DELAY_300, threshold: 0 }, // Card Container
  // FAQ
  "framer-1eqpxtg": { transition: SPRING_DELAY_200, threshold: 0 }, // Heading Wrapper
  "framer-73uhe3": { transition: SPRING_DELAY_300, threshold: 0 }, // Card Container
  // CTA
  "framer-gzpni7": { transition: SPRING_DELAY_200, threshold: 0 }, // CTA Banner Container
};

/** The unmapped-node fallback: the majority config. */
const DEFAULT_APPEAR: AppearConfig = { transition: SPRING_DELAY_200, threshold: 0 };

/** Framer observes with 100 thresholds so its own ratio test can resolve. */
const OBSERVER_THRESHOLDS = Array.from({ length: 100 }, (_, i) => i * 0.01);

const BOUND = "revealBound";

type Stoppable = { stop: () => void };

function parseTranslate(transform: string): { x: number; y: number } {
  const x = /translateX\((-?[\d.]+)px\)/.exec(transform);
  const y = /translateY\((-?[\d.]+)px\)/.exec(transform);
  return { x: x ? Number(x[1]) : 0, y: y ? Number(y[1]) : 0 };
}

/** The end state, applied with no animation (reduced motion, or teardown). */
function settle(el: HTMLElement) {
  el.style.opacity = "1";
  el.style.transform = "none";
  el.style.willChange = "";
}

/**
 * Framer's in-view predicate. Note the denominator: an element taller than the
 * viewport is measured against the viewport, otherwise a 2000px column could
 * never reach a 0.5 threshold.
 */
function isVisibleEnough(entry: IntersectionObserverEntry, threshold: number) {
  const height = entry.boundingClientRect.height;
  if (height === 0) return entry.isIntersecting;
  const ratio =
    entry.intersectionRect.height / Math.min(height, window.innerHeight);
  return entry.isIntersecting && ratio >= threshold;
}

/** Bucket tokens into rendered lines the way Framer's runtime does. */
function groupIntoLines(tokens: HTMLElement[]): HTMLElement[][] {
  const lines: HTMLElement[][] = [];
  let previousTop: number | null = null;

  for (const token of tokens) {
    const top = token.offsetTop;
    const height = token.offsetHeight;
    if (height === 0 || previousTop === null || top === previousTop) {
      if (lines.length === 0) lines.push([]);
      lines[lines.length - 1].push(token);
    } else {
      lines.push([token]);
    }
    if (height) previousTop = top;
  }

  return lines;
}

export function initReveal(root: HTMLElement): (() => void) | void {
  if (typeof window === "undefined") return;

  const revealNodes = Array.from(
    root.querySelectorAll<HTMLElement>('[style*="will-change"]'),
  ).filter(
    (el) =>
      el.style.willChange === "transform" &&
      Number.parseFloat(el.style.opacity) === 0 &&
      el.style.transform.includes("translate"),
  );

  const splitTexts = new Map<HTMLElement, HTMLElement[]>();
  for (const span of Array.from(
    root.querySelectorAll<HTMLElement>('span[style*="inline-block"]'),
  )) {
    if (Number.parseFloat(span.style.opacity) !== 0.001) continue;
    const container =
      span.closest<HTMLElement>('[data-framer-component-type="RichTextContainer"]') ??
      span.parentElement?.parentElement;
    if (!container) continue;
    const group = splitTexts.get(container);
    if (group) group.push(span);
    else splitTexts.set(container, [span]);
  }

  // Idempotent: a second call finds every node already claimed and does nothing.
  const unclaimed = <T extends HTMLElement>(el: T) => !(BOUND in el.dataset);
  const claim = (el: HTMLElement) => {
    el.dataset[BOUND] = "1";
  };

  const pendingNodes = revealNodes.filter(unclaimed);
  const pendingTexts = Array.from(splitTexts).filter(([container]) =>
    unclaimed(container),
  );
  if (pendingNodes.length === 0 && pendingTexts.length === 0) return;

  pendingNodes.forEach(claim);
  pendingTexts.forEach(([container]) => claim(container));

  // Reduced motion: land on the end state, no transition, nothing observed.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const el of pendingNodes) settle(el);
    for (const [, tokens] of pendingTexts) for (const t of tokens) settle(t);
    return;
  }

  const running: Stoppable[] = [];
  const observers: IntersectionObserver[] = [];
  const stopWatching: (() => void)[] = [];
  // Anything torn down before it played must be released, or a remount (React
  // strict mode does exactly this) would find it claimed and leave it hidden.
  const waiting = new Set<HTMLElement>([
    ...pendingNodes,
    ...pendingTexts.map(([container]) => container),
  ]);

  const play = (el: HTMLElement, config: AppearConfig) => {
    waiting.delete(el);
    const from = parseTranslate(el.style.transform);
    const keyframes: DOMKeyframesDefinition = { opacity: [0, 1], y: [from.y, 0] };
    if (from.x !== 0) keyframes.x = [from.x, 0];
    const controls = animate(el, keyframes, {
      ...config.transition,
      // A permanent compositor layer on a 13,500px page is a scroll-perf tax;
      // Framer leaves will-change set, we drop it once the node has landed.
      onComplete: () => {
        el.style.willChange = "";
      },
    });
    running.push(controls);
  };

  // 1. Box reveals - one observer, Framer's own visibility predicate.
  if (pendingNodes.length > 0) {
    const configs = new WeakMap<Element, AppearConfig>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const config = configs.get(el) ?? DEFAULT_APPEAR;
          if (!isVisibleEnough(entry, config.threshold)) continue;
          observer.unobserve(el); // animateOnce: it never plays in reverse
          play(el, config);
        }
      },
      { threshold: OBSERVER_THRESHOLDS },
    );
    observers.push(observer);

    for (const el of pendingNodes) {
      const key = Array.from(el.classList).find((c) => c in APPEAR_BY_CLASS);
      configs.set(el, key ? APPEAR_BY_CLASS[key] : DEFAULT_APPEAR);
      observer.observe(el);
    }
  }

  // 2. Split text - per-line stagger, triggered at 50% of the block.
  for (const [container, tokens] of pendingTexts) {
    // Framer guards its own effect with `hasAnimatedOnce`, so scrolling the
    // headline out and back never replays it. `inView` fires on every entry,
    // hence the latch.
    let played = false;
    stopWatching.push(
      inView(
        container,
        () => {
          if (played) return;
          played = true;
          waiting.delete(container);
          const from = parseTranslate(tokens[0]?.style.transform ?? "");
          groupIntoLines(tokens).forEach((line, index) => {
            running.push(
              animate(
                line,
                { opacity: [0.001, 1], y: [from.y, 0] },
                {
                  ...TEXT_TRANSITION,
                  delay: TEXT_START_DELAY + index * TEXT_LINE_STAGGER,
                  onComplete: () => {
                    for (const token of line) token.style.willChange = "";
                  },
                },
              ),
            );
          });
        },
        { amount: TEXT_THRESHOLD },
      ),
    );
  }

  return () => {
    for (const observer of observers) observer.disconnect();
    for (const stop of stopWatching) stop();
    for (const controls of running) controls.stop();
    for (const el of waiting) delete el.dataset[BOUND];
  };
}
