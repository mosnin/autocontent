import { FeatureGrid } from "@/components/marketing/feature-grid";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { LoopSection } from "@/components/marketing/loop-section";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { SpendDemo } from "@/components/marketing/spend-demo";
import { StackBand } from "@/components/marketing/stack-band";
import { SystemVoices } from "@/components/marketing/system-voices";

// `/` uses Clerk's <SignedIn>/<SignedOut> which can't be statically
// prerendered without a real Clerk key — opt out so the build can
// still ship in CI.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="relative">
      {/* Content rides above the sticky footer; the footer is revealed as
          the page bottoms out (scroll-reveal pattern). */}
      <div className="relative z-10 bg-background shadow-[0_24px_48px_-12px_rgb(0_0_0/0.4)]">
        <SiteNav />
        <main>
          <Hero />
          <LoopSection />
          <SpendDemo />
          <FeatureGrid />
          <StackBand />
          <SystemVoices />
          <FinalCta />
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
