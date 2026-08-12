/**
 * The homepage showcase band: "here is what the platform actually makes".
 *
 * Built entirely from the shared section primitives, so it reads as another
 * band of the same page rather than a bolted-on gallery. What it shows comes
 * from `HOMEPAGE_SHOWCASE` in the registry — a landscape video ad, a row of
 * static ad creative, then a scrollable rail of the vertical formats.
 *
 * Server component.
 */
import * as React from "react";

import { Rule, Section, SectionHead } from "@/components/site/sections";

import { ShowcaseGrid, ShowcaseRail, ShowcaseSlot } from "./showcase-layout";
import { HOMEPAGE_SHOWCASE, getSlot, getSlots } from "./showcase.config";

import "./showcase.css";

export function HomeShowcase() {
  const feature = getSlot(HOMEPAGE_SHOWCASE.feature);
  const ads = getSlots([...HOMEPAGE_SHOWCASE.ads]);
  const rail = getSlots([...HOMEPAGE_SHOWCASE.rail]);

  return (
    <Section id="showcase" label="Made on marketer.sh">
      <SectionHead
        eyebrow="Made on marketer.sh"
        heading="Ads, clips and micro-dramas the platform made itself."
        highlight="the platform made itself"
        lede="Every frame below is pipeline output — briefed, generated, cut and captioned by the agents, then shipped to the channels that pay for themselves."
      />

      <div className="os-mt-48">
        <ShowcaseSlot
          priority
          sizes="(max-width: 1023px) 100vw, 1100px"
          slot={feature}
        />
      </div>

      <Rule className="os-mt-64" />

      <div className="os-mt-48">
        <div className="ms-rowhead">
          <p className="os-label">Static ad creative · 4:5</p>
          <span className="ms-hint">Three variants, one brief</span>
        </div>
        <ShowcaseGrid
          cols={3}
          sizes="(max-width: 719px) 100vw, (max-width: 1023px) 50vw, 33vw"
          slots={ads}
        />
      </div>

      <ShowcaseRail
        className="os-mt-64"
        label="Vertical video · 9:16"
        slots={rail}
      />
    </Section>
  );
}
