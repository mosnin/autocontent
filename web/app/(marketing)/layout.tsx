import * as React from "react";

import { Reveal, SiteShell } from "@/components/site";
import "@/components/site/site.css";
import "@/components/site/bridge.css";

// The root layout wraps everything in <ClerkProvider>, which can't be
// statically prerendered without a real Clerk key — opt the whole marketing
// group out so CI builds ship with a placeholder key.
export const dynamic = "force-dynamic";

/**
 * Shell for every logged-out marketing page.
 *
 * `SiteShell` carries the transcribed nav, footer and the
 * `#main > .framer-pnUdQ` wrapper chain that site.css scopes all of its
 * layout rules under, so each page inherits the design rather than
 * re-implementing it. `Reveal` plays the entrance animations the Framer
 * runtime used to drive — without it the reveal-state nodes never appear.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SiteShell>
      {children}
      <Reveal />
    </SiteShell>
  );
}
