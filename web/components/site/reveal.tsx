"use client";

import { useEffect } from "react";

/**
 * Plays the entrance animations the Framer runtime used to drive.
 *
 * The export ships its reveal state inline — `opacity: 0` (or `0.001` for
 * the per-character headline) plus a `translateY`. Framer's runtime clears
 * both when the element scrolls into view. Without it those nodes stay
 * invisible forever, which is most of the page.
 *
 * This is a transcription of that behaviour, not an invention: same
 * trigger (entering the viewport), same end state (opacity 1, no
 * transform). The stagger is derived from DOM order within a group so the
 * per-character headline still writes on rather than appearing at once.
 */
export function Reveal() {
  useEffect(() => {
    const root = document.getElementById("main");
    if (!root) return;

    const hidden = Array.from(
      root.querySelectorAll<HTMLElement>("[style*='opacity']"),
    ).filter((el) => {
      const value = Number.parseFloat(el.style.opacity);
      return !Number.isNaN(value) && value < 0.5;
    });
    if (hidden.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const show = (el: HTMLElement, delay: number) => {
      if (!reduced) {
        el.style.transition =
          `opacity 600ms cubic-bezier(0.215,0.61,0.355,1) ${delay}ms,` +
          ` transform 600ms cubic-bezier(0.215,0.61,0.355,1) ${delay}ms`;
      }
      el.style.opacity = "1";
      if (el.style.transform) el.style.transform = "none";
    };

    if (reduced) {
      hidden.forEach((el) => show(el, 0));
      return;
    }

    // Character spans share a parent and must stagger against each other,
    // not against the whole page — so the delay is the index within the
    // element's own parent, capped so a 300-character headline does not
    // take twenty seconds to finish.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const siblings = el.parentElement
            ? Array.from(el.parentElement.children)
            : [];
          const index = Math.max(0, siblings.indexOf(el));
          show(el, Math.min(index * 12, 400));
          observer.unobserve(el);
        }
      },
      // Matches Framer's default: fire slightly before the element is
      // fully on screen so it is already settling as it arrives.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );

    hidden.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return null;
}
