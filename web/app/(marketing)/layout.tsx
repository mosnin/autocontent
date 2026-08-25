import * as React from "react";

import { Footer } from "@/components/marketing/site-footer";
import { Nav } from "@/components/marketing/nav/nav";
import { MarketingProviders } from "@/components/marketing/providers";
import { SkipToContent } from "@/components/marketing/skip-to-content";
import { ThemeSwitch } from "@/components/marketing/theme-switch";

export const dynamic = "force-dynamic";

/**
 * Shell for every logged-out marketing page. Cortex template: expanding
 * pill nav, inverted-surface theme switch, Lenis smooth scroll, and the
 * oversized wordmark footer.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="marketing-site flex min-h-screen flex-col">
      <MarketingProviders>
        <SkipToContent />
        <Nav />
        <div className="flex-1" id="main-content">
          {children}
        </div>
        <Footer />
        <ThemeSwitch />
      </MarketingProviders>
    </div>
  );
}
