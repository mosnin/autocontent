"use client";

import { features } from "@/lib/marketing/config";
import { useIntroDone } from "@/lib/marketing/intro";
import Lenis from "lenis";
import { useEffect, useRef, type ReactNode } from "react";

const LENIS_OPTIONS = {
  duration: 1.6,
  easing: (t: number): number => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  orientation: "vertical" as const,
  gestureOrientation: "vertical" as const,
  smoothWheel: true,
  wheelMultiplier: 1,
  touchMultiplier: 2,
};

const ANCHOR_OFFSET = -100;

export function SmoothScroll({ children }: { children: ReactNode }): ReactNode {
  const introDone = useIntroDone();
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (!features.smoothScroll) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion) return;

    const lenis = new Lenis(LENIS_OPTIONS);
    lenisRef.current = lenis;

    function raf(time: number): void {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    function handleAnchorClick(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href^="#"]');
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const element = document.querySelector(href);
      if (!element || !(element instanceof HTMLElement)) return;
      event.preventDefault();
      lenis.scrollTo(element, { offset: ANCHOR_OFFSET });
    }

    document.addEventListener("click", handleAnchorClick);
    return () => {
      document.removeEventListener("click", handleAnchorClick);
      lenisRef.current = null;
      lenis.destroy();
    };
  }, []);

  // Halt Lenis while the intro loader is up; it scrolls programmatically,
  // so CSS overflow locks alone can't block it.
  useEffect(() => {
    const lenis = lenisRef.current;
    if (!lenis) return;
    if (introDone) {
      lenis.start();
    } else {
      lenis.stop();
    }
  }, [introDone]);

  return <>{children}</>;
}
