"use client";

/**
 * Continuous / looping motion for the Framer export.
 *
 * Everything here was measured off the original site running WITH its Framer
 * runtime (http://127.0.0.1:8123) and cross-checked against the exact props in
 * the site's page module
 * (framerusercontent.com/sites/4OiOOJlBbEysmPI2h0wXgt/ta7db_….mjs) and the
 * Ticker/Slideshow implementations in framer.Diyk9lKL.mjs. No value here is a
 * guess.
 *
 * ── 1. Tickers (Framer `Ticker`, class `.framer-<hash>` wrapping a `<ul>`) ──
 *   The runtime keeps an `offset` motion value, integrates
 *   `offset -= dt/1000 * velocity * directionModifier * hoverFactor`
 *   and renders `wrap(offset, -(totalItemLength + gap), 0)` onto the `<ul>`.
 *   Items that leave the window are re-projected by ±(totalItemLength + gap);
 *   duplicating the item set is visually identical and much cheaper.
 *
 *   Measured px/s on the original (median of 80 samples over 20s):
 *     .framer-aj6bzg  −19.98 px/s   (config: velocity 20, direction default)
 *     .framer-h6y6rj  +63.93 px/s   (config: velocity 64, direction reverse)
 *   Hover (real pointer):  aj6bzg −20.19 → −20.00 (hoverModifier 100 ⇒ ×1.00)
 *                          h6y6rj +63.99 → +40.95 (hoverModifier  64 ⇒ ×0.64)
 *   Loop seam: h6y6rj wraps −9.85 → −970.22, i.e. period 972 =
 *   totalItemLength 922 + gap 50. No easing — perfectly linear.
 *
 *   The export ships these `<ul>`s with `opacity: 0` (the runtime raised it
 *   after its first measure pass), so they are currently invisible, not merely
 *   frozen. We raise opacity as part of setup.
 *
 * ── 2. Integrations orbit (`.framer-1xj5jk5`, "Circle") ──
 *   Page module: __framer__loop {rotate: 360}, __framer__loopTransition
 *   {type: "tween", duration: 30, ease: [0,0,1,1], delay: 0},
 *   loopRepeatType "loop", loopPauseOffscreen true.
 *   ease [0,0,1,1] is linear ⇒ 12.000 deg/s. Measured 11.99–12.02 deg/s.
 *
 * ── 3. Comparison slideshows (`.framer-slideshow-axis-x`) — NOT ours ──
 *   `controls.tsx` already drives `section.framer-slideshow`. Measurements
 *   taken here in case they are useful there: page module says autoPlayControl
 *   true, direction "left", intervalControl 3, gap 11, itemAmount 1,
 *   startFrom 1, six slots, transitionControl
 *   {type: "spring", stiffness: 200, damping: 40, mass: 1}. On the original
 *   that is one 211px step (200px slide + 11px gap) every 3.00s, the settle
 *   curve fits that overdamped spring to <0.5% at every sample, the `<ul>`
 *   snaps back by 6×211 = 1266px on the seam, and hover does NOT pause it
 *   (verified with a real pointer).
 *
 * ── 4. "Marquee Container" progress bars (`.framer-ckr9v3`, ×6) ──
 *   The testimonial deck's indicator strip. One bar fills left→right,
 *   linearly, over 5.0s, then the next; measured step 4.98s, then a ~1.05s
 *   all-empty gap before the cycle restarts.
 *
 * ── 5. Rive containers ("1.riv", "2N.riv") — NOT reproduced ──
 *   Both live in the Challenges section's "Rive Container" and are the same
 *   graphic at two aspect ratios (1.riv desktop+tablet, 2N.riv mobile).
 *   Downloading the assets (framerusercontent.com/assets/
 *   OH4E1Fo3AN0nu4qzLBLchL9GjL0.riv, 1FmJ16uJgj0nCPROxVjG5rISU0.riv — 2.3KB
 *   and 828B, artboard "Artboard", "State Machine 1") and playing them through
 *   @rive-app/canvas shows a circuit trace in #354B48: a full-width horizontal
 *   rule with short upward stubs at both ends and a stem dropping from the
 *   centre into the logo card, with a #41FFF3 pulse running down it every
 *   ~4.05s. Faithful reproduction needs the Rive WASM runtime plus those two
 *   assets vendored into `public/`, which is outside this file's remit; the
 *   export's `<canvas>` is 0×0 so the section renders correctly without it.
 *
 * prefers-reduced-motion freezes everything (the original does the same: the
 * Ticker's rAF is gated on `useReducedMotion()`, and with reduce set the
 * measured drift over 2s was exactly 0px).
 */

type Cleanup = () => void;

/** Framer gates its ticker rAF on useInView(el, { margin: "100px" }). */
const IN_VIEW_MARGIN = "100px";

interface TickerConfig {
  /** Wrapper class emitted by Framer for this Ticker instance. */
  selector: string;
  /** `tickerEffectVelocity` — px/s. */
  velocity: number;
  /** `tickerEffectDirectionModifier`: "default" → 1, "reverse" → -1. */
  direction: 1 | -1;
  /** `tickerEffectGap` in px (also present on the `<ul>`'s computed gap). */
  gap: number;
  /** `tickerEffectHoverModifier` as a percentage of `velocity`. */
  hoverModifier: number;
  /** `tickerEffectOverflow === "visible"`. */
  overflowVisible: boolean;
}

const TICKERS: readonly TickerConfig[] = [
  // "Trusted By" logo cloud.
  { selector: ".framer-aj6bzg", velocity: 20, direction: 1, gap: 0, hoverModifier: 100, overflowVisible: false },
  // "Loop Logo Animation" → "Main Icon", desktop.
  { selector: ".framer-h6y6rj", velocity: 64, direction: -1, gap: 50, hoverModifier: 64, overflowVisible: false },
  // AI-workflow icon strip, tablet + mobile only.
  { selector: ".framer-2x5gzp", velocity: 50, direction: -1, gap: 32, hoverModifier: 50, overflowVisible: true },
  // "Loop Logo Animation" → "Main Icon", tablet + mobile.
  { selector: ".framer-pe0qcw", velocity: 45, direction: -1, gap: 32, hoverModifier: 45, overflowVisible: false },
];

/** Orbit: `rotate: 360` over 30s, ease [0,0,1,1] (linear). */
const ORBIT_SELECTOR = ".framer-1xj5jk5";
const ORBIT_PERIOD_MS = 30_000;

/** Marquee indicator strip. */
const BAR_STEP_MS = 4980;
const BAR_FILL_MS = 5000;
const BAR_TAIL_MS = 1050;

const registry = new WeakMap<HTMLElement, Cleanup>();

/** Wrap `v` into the half-open range [min, max) — Framer's ticker clamp. */
function wrap(v: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0)) return min;
  return min + (((v - min) % span) + span) % span;
}

function isVisible(el: Element): boolean {
  return (el as HTMLElement).getClientRects().length > 0;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * One shared rAF loop. The page is 13,500px tall; a per-effect loop would keep
 * several rAF callbacks alive at all times. Jobs unsubscribe when they scroll
 * out of view, and the loop stops entirely once the set is empty.
 */
class Driver {
  private jobs = new Set<(dtMs: number) => void>();
  private raf = 0;
  private last = 0;

  private tick = (now: number) => {
    // Cap only to absorb the huge delta after the tab is re-shown (rAF is
    // parked while hidden); 100ms keeps speeds accurate down to 10fps.
    const dt = this.last === 0 ? 16.667 : Math.min(now - this.last, 100);
    this.last = now;
    for (const job of Array.from(this.jobs)) job(dt);
    this.raf = this.jobs.size > 0 ? requestAnimationFrame(this.tick) : 0;
  };

  add(job: (dtMs: number) => void): void {
    this.jobs.add(job);
    if (this.raf === 0) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  remove(job: (dtMs: number) => void): void {
    this.jobs.delete(job);
    if (this.jobs.size === 0 && this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  stop(): void {
    this.jobs.clear();
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/**
 * Runs `job` only while `el` is within 100px of the viewport, mirroring
 * Framer's `useInView(ref, { margin: "100px" })` gate (and the Slideshow's
 * `playOffscreen: false`).
 */
function gateOnVisibility(
  driver: Driver,
  el: Element,
  job: (dtMs: number) => void,
  teardown: Cleanup[],
): void {
  let running = false;
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (visible === running) return;
      running = visible;
      if (visible) driver.add(job);
      else driver.remove(job);
    },
    { rootMargin: IN_VIEW_MARGIN },
  );
  observer.observe(el);
  teardown.push(() => {
    observer.disconnect();
    driver.remove(job);
  });
}

/* ------------------------------------------------------------------ */
/* 1. Tickers                                                          */
/* ------------------------------------------------------------------ */

function setupTicker(
  root: HTMLElement,
  config: TickerConfig,
  driver: Driver,
  teardown: Cleanup[],
  reduced: boolean,
): void {
  const wrapper = root.querySelector<HTMLElement>(config.selector);
  if (!wrapper) return;
  const list = wrapper.querySelector<HTMLElement>(":scope > ul");
  if (!list) return;

  const originals = Array.from(list.children) as HTMLElement[];
  const previousOpacity = list.style.opacity;
  const previousTransform = list.style.transform;
  const previousWillChange = list.style.willChange;

  // The export ships the list at opacity 0 (Framer raised it post-measure).
  list.style.opacity = "1";
  list.style.willChange = "transform";

  /** Signed px/s applied to the offset. Positive velocity ⇒ offset decreases. */
  const signedVelocity = config.velocity * config.direction;
  const hoverFactor = config.hoverModifier / 100;

  let period = 0;
  let offset = 0;
  let factor = 1;
  let factorTarget = 1;

  const clearClones = () => {
    for (const node of Array.from(list.children) as HTMLElement[]) {
      if (node.dataset.tickerClone === "1") node.remove();
    }
  };

  const measure = () => {
    clearClones();
    const items = (Array.from(list.querySelectorAll<HTMLElement>("li.ticker-item"))).filter(isVisible);
    if (items.length === 0) {
      period = 0;
      return;
    }
    const listRect = list.getBoundingClientRect();
    let start = Infinity;
    let end = -Infinity;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      start = Math.min(start, rect.left - listRect.left);
      end = Math.max(end, rect.right - listRect.left);
    }
    const gap = Number.parseFloat(getComputedStyle(list).gap) || config.gap;
    const totalItemLength = end - start;
    period = totalItemLength + gap;
    if (!(period > 0)) return;

    // Enough duplicates that the visible window is always covered for any
    // offset in [-period, 0). Framer instead re-projects individual items by
    // ±period; the rendered result is the same.
    const viewport =
      config.overflowVisible || wrapper.clientWidth === 0
        ? window.innerWidth
        : Math.min(wrapper.clientWidth, window.innerWidth);
    // 0.5px slack so a sub-pixel measurement doesn't buy a whole extra group.
    const groups = Math.min(12, Math.max(2, 1 + Math.ceil((viewport + gap - 0.5) / period)));

    for (let g = 1; g < groups; g++) {
      for (const node of originals) {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.dataset.tickerClone = "1";
        clone.setAttribute("aria-hidden", "true");
        for (const focusable of Array.from(clone.querySelectorAll<HTMLElement>("[tabindex], a, button"))) {
          focusable.setAttribute("tabindex", "-1");
        }
        list.appendChild(clone);
      }
    }
  };

  const render = () => {
    list.style.transform = `translateX(${wrap(offset, -period, 0).toFixed(3)}px)`;
  };

  measure();
  render();

  if (reduced) {
    teardown.push(() => {
      clearClones();
      list.style.opacity = previousOpacity;
      list.style.transform = previousTransform;
      list.style.willChange = previousWillChange;
    });
    return;
  }

  const job = (dtMs: number) => {
    const dt = dtMs / 1000;
    // Framer eases the hover factor on a motion value; ~8/s exponential
    // approach settles in the same ~0.3s and is imperceptibly different.
    factor += (factorTarget - factor) * (1 - Math.exp(-dt * 8));
    if (period > 0) {
      offset -= dt * signedVelocity * factor;
      render();
    }
  };

  const onEnter = () => {
    factorTarget = hoverFactor;
  };
  const onLeave = () => {
    factorTarget = 1;
  };
  if (hoverFactor !== 1) {
    wrapper.addEventListener("pointerenter", onEnter);
    wrapper.addEventListener("pointerleave", onLeave);
  }

  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      measure();
      render();
    }, 150);
  };
  window.addEventListener("resize", onResize);

  gateOnVisibility(driver, wrapper, job, teardown);

  teardown.push(() => {
    window.clearTimeout(resizeTimer);
    window.removeEventListener("resize", onResize);
    wrapper.removeEventListener("pointerenter", onEnter);
    wrapper.removeEventListener("pointerleave", onLeave);
    clearClones();
    list.style.opacity = previousOpacity;
    list.style.transform = previousTransform;
    list.style.willChange = previousWillChange;
  });
}

/* ------------------------------------------------------------------ */
/* 2. Integrations orbit                                               */
/* ------------------------------------------------------------------ */

function setupOrbit(root: HTMLElement, driver: Driver, teardown: Cleanup[], reduced: boolean): void {
  const circle = root.querySelector<HTMLElement>(ORBIT_SELECTOR);
  if (!circle) return;
  const previousTransform = circle.style.transform;
  const previousWillChange = circle.style.willChange;

  if (reduced) return;

  circle.style.willChange = "transform";
  let elapsed = 0;

  const job = (dtMs: number) => {
    elapsed = (elapsed + dtMs) % ORBIT_PERIOD_MS;
    const deg = (elapsed / ORBIT_PERIOD_MS) * 360;
    circle.style.transform = `rotate(${deg.toFixed(3)}deg)`;
  };

  gateOnVisibility(driver, circle, job, teardown);
  teardown.push(() => {
    circle.style.transform = previousTransform;
    circle.style.willChange = previousWillChange;
  });
}

/* ------------------------------------------------------------------ */
/* 4. "Marquee Container" progress bars                                */
/* ------------------------------------------------------------------ */

function setupMarqueeBars(root: HTMLElement, driver: Driver, teardown: Cleanup[], reduced: boolean): void {
  const containers = Array.from(root.querySelectorAll<HTMLElement>('[data-framer-name="Marquee Container"]'));
  for (const container of containers) {
    const bars = Array.from(container.querySelectorAll<HTMLElement>(".framer-ckr9v3"));
    if (bars.length === 0) continue;

    const restore = bars.map((bar) => ({
      bar,
      left: bar.style.left,
      right: bar.style.right,
      width: bar.style.width,
      origin: bar.style.transformOrigin,
      transform: bar.style.transform,
    }));
    teardown.push(() => {
      for (const entry of restore) {
        entry.bar.style.left = entry.left;
        entry.bar.style.right = entry.right;
        entry.bar.style.width = entry.width;
        entry.bar.style.transformOrigin = entry.origin;
        entry.bar.style.transform = entry.transform;
      }
    });

    if (reduced) continue;

    // The active-variant CSS is `width: unset; left: 0; right: 0`; Framer's
    // layout projection turns that width change into a centred scaleX with a
    // compensating translate. A left-origin scaleX is the same picture.
    for (const bar of bars) {
      bar.style.left = "0px";
      bar.style.right = "0px";
      bar.style.width = "auto";
      bar.style.transformOrigin = "0% 50%";
      bar.style.transform = "scaleX(0)";
    }

    const cycle = bars.length * BAR_STEP_MS + BAR_TAIL_MS;
    let phase = 0;

    const job = (dtMs: number) => {
      phase = (phase + dtMs) % cycle;
      const active = phase < bars.length * BAR_STEP_MS ? Math.floor(phase / BAR_STEP_MS) : -1;
      for (let i = 0; i < bars.length; i++) {
        const fill = i === active ? Math.min(1, (phase - i * BAR_STEP_MS) / BAR_FILL_MS) : 0;
        bars[i].style.transform = `scaleX(${fill.toFixed(4)})`;
      }
    };

    gateOnVisibility(driver, container, job, teardown);
  }
}

/* ------------------------------------------------------------------ */

export function initTicker(root: HTMLElement): Cleanup | void {
  if (typeof window === "undefined") return undefined;

  const existing = registry.get(root);
  if (existing) return existing;

  const driver = new Driver();
  const teardown: Cleanup[] = [];
  const reduced = prefersReducedMotion();

  for (const config of TICKERS) setupTicker(root, config, driver, teardown, reduced);
  setupOrbit(root, driver, teardown, reduced);
  setupMarqueeBars(root, driver, teardown, reduced);

  const cleanup: Cleanup = () => {
    if (registry.get(root) !== cleanup) return;
    registry.delete(root);
    driver.stop();
    for (const fn of teardown) fn();
    teardown.length = 0;
  };

  registry.set(root, cleanup);
  return cleanup;
}
