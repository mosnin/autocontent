"use client";

import { Backdrop } from "@/components/originkit/ui/hero-19/backdrop";

import { HeroOrb } from "./orb";
import "./hero.css";

/**
 * Homepage hero - Originkit "hero-19" (section-26), re-tokenised.
 *
 * What is kept from the delivered section: the composition. A ceiling
 * light rig behind everything, a cupped hand on the floor, a particle orb
 * resting above it, a small card at the right, copy anchored to the
 * bottom-left on desktop and to the top when the stage narrows.
 *
 * What is not: its nav, wordmark and auth buttons (`SiteShell` already
 * renders the site's one nav - keeping these would have rendered two);
 * its wellness copy; its logo marquee, which the page's own "Trusted By"
 * band does properly one section down; its 88px Instrument Serif
 * headline; and every warm colour in it. See hero.css for the mapping.
 *
 * `Backdrop` and `ParticleSphere` are the delivered files, imported
 * unmodified - the light rig is recoloured with a per-image filter from
 * hero.css and the orb's colour is handed to the engine as a prop, so a
 * re-pull of hero-19 does not lose this work.
 */

const HAND = "/originkit/hero-19/hand.png";

/** Straight from the site's own capability copy (scripts/opsra_content.py). */
const CARD_ITEMS = [
  "One brief in",
  "Produce and publish",
  "Live spend visibility",
];

export function SiteHero() {
  return (
    <section className="mkt-hero" data-framer-name="Hero" id="hero">
      <div aria-hidden className="mkt-hero__light">
        <Backdrop />
      </div>

      {/* Lands the light back on the exact page ground. Full-bleed and
          outside the rails, because the rig is full-bleed too - inside
          them the outer 74px of light stepped straight into the next
          section. */}
      <div aria-hidden className="mkt-hero__floor" />

      <div className="mkt-hero__rails">
        <div className="mkt-hero__stage">
          <HeroOrb />

          <img
            aria-hidden
            alt=""
            className="mkt-hero__hand"
            decoding="async"
            fetchPriority="high"
            src={HAND}
          />

          <div aria-hidden className="mkt-hero__bloom" />
          <div aria-hidden className="mkt-hero__haze" />

          <div className="mkt-hero__copy">
            <p className="mkt-hero__eyebrow">
              <span className="mkt-hero__eyebrow-tag">autonomous marketing</span>
              <span className="mkt-hero__eyebrow-note">See it run</span>
            </p>

            <h1 className="mkt-hero__title">
              Autopilot your brand&rsquo;s <em>entire content engine</em> with a
              cap on spend.
            </h1>

            <p className="mkt-hero__lede">
              One brief in. Video and SEO articles ideated, produced,
              published, and improved &mdash; with hard caps on every dollar
              spent.
            </p>

            <div className="mkt-hero__actions">
              <a className="mkt-hero__cta" href="/sign-up">
                <span className="mkt-hero__cta-face">Start free</span>
              </a>
              <span className="mkt-hero__cta-note">No subscription</span>
            </div>
          </div>

          <aside className="mkt-hero__card">
            <span className="mkt-hero__card-badge">
              <svg
                aria-hidden
                fill="none"
                height="16"
                viewBox="0 0 16 16"
                width="16"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M8 1.5 9.5 6.5 14.5 8 9.5 9.5 8 14.5 6.5 9.5 1.5 8 6.5 6.5 8 1.5Z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <p className="mkt-hero__card-title">What it does</p>
            <ul className="mkt-hero__card-list">
              {CARD_ITEMS.map((item) => (
                <li key={item}>
                  <span aria-hidden className="mkt-hero__card-dot" />
                  {item}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </section>
  );
}
