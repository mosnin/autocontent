import * as React from "react";

import { MarketingFooter, MarketingNav } from "@/components/marketing/system";

// Rendered per request (kept from when the auth provider needed it; the
// nav's signed-in switch now runs in the browser).
export const dynamic = "force-dynamic";

/**
 * Shell for every logged-out marketing page: announcement banner + sticky
 * mega-menu nav on top, sitemap footer below, white canvas behind
 * everything (spec: web/marketing/DESIGN_SPEC.md).
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  );
}
