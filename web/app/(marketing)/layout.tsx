import * as React from "react";

import { MarketingFooter, MarketingNav } from "@/components/marketing/system";

// The root layout wraps everything in <ClerkProvider>, which can't be
// statically prerendered without a real Clerk key — opt the whole marketing
// group out so CI builds ship with a placeholder key (same reason the old
// app/page.tsx was force-dynamic).
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
