"use client";

import { useEffect, useRef, useState } from "react";

import ParticleSphere from "@/components/originkit/ui/hero-19/particle-sphere";

/**
 * The hero's orb.
 *
 * Wraps Originkit's delivered `ParticleSphere` engine (three.js / WebGL,
 * 1.4k lines, left untouched so it stays re-pullable) and supplies
 * everything around it from this side:
 *
 *   colour  the engine takes `sphereColor` as a string, so the brand token
 *           is read off the document at mount rather than written here as
 *           a literal. Changing `--brand-primary` changes the orb.
 *   motion  under `prefers-reduced-motion` the sphere is never mounted —
 *           no WebGL context, no rAF loop — and a static disc stands in.
 *   cost    the engine runs an unconditional requestAnimationFrame loop
 *           and holds a WebGL context for as long as it is mounted, so it
 *           is mounted only while the hero is on screen. Unmounting runs
 *           the engine's own cleanup, which cancels the loop, disposes the
 *           renderer, the geometry and the materials, and removes the
 *           canvas — i.e. the context is released rather than parked.
 */

/** Falls back to the sage in globals.css if the variable is unreadable. */
const ACCENT_FALLBACK = "#9ab08d";

function readAccent(el: Element | null): string {
  if (!el) return ACCENT_FALLBACK;
  const value = getComputedStyle(el).getPropertyValue("--hero-accent").trim();
  return value || ACCENT_FALLBACK;
}

export function HeroOrb() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [accent, setAccent] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    setAccent(readAccent(host));

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setStill(query.matches);
    onMotion();
    query.addEventListener("change", onMotion);

    // Generous margin so the sphere is already running by the time it
    // scrolls in, but torn down once the hero is well clear of the fold.
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { rootMargin: "200px 0px" },
    );
    observer.observe(host);

    return () => {
      query.removeEventListener("change", onMotion);
      observer.disconnect();
    };
  }, []);

  const live = visible && !still && accent !== null;

  return (
    <div ref={hostRef} aria-hidden className="mkt-hero__orb">
      <div className="mkt-hero__orb-glow" />
      <div className="mkt-hero__orb-core" />
      {live ? (
        <div className="mkt-hero__orb-sphere">
          <ParticleSphere
            particlesCount={7000}
            particleScale={7}
            rotationDirection="clockwise"
            speed={20}
            scale={10}
            drag
            smoothing={7}
            dragSpeed={5}
            stopOnHover={false}
            cursorOn
            cursorRadiusUI={75}
            cursorStrengthUI={10}
            clickForce={5}
            sphereColor={accent as string}
          />
        </div>
      ) : (
        <div className="mkt-hero__orb-still" />
      )}
    </div>
  );
}
