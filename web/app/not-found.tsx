import Link from "next/link";
import { connection } from "next/server";

import { Footer } from "@/components/marketing/site-footer";
import { Nav } from "@/components/marketing/nav/nav";
import { MarketingProviders } from "@/components/marketing/providers";
import { ThemeSwitch } from "@/components/marketing/theme-switch";

export const dynamic = "force-dynamic";

/**
 * Global 404, styled like the Cortex marketing site (unknown URLs are
 * almost always logged-out traffic). Authed sections keep their own
 * app/(app)/not-found.tsx.
 */
export default async function NotFound() {
  await connection();

  return (
    <div className="marketing-site flex min-h-screen flex-col">
      <MarketingProviders>
        <Nav />
        <main
          className="flex flex-1 items-center justify-center px-6 pt-24"
          id="main-content"
        >
          <div className="text-center">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
              404
            </p>
            <h1 className="text-foreground mt-4 text-[clamp(44px,7.5vw,84px)] leading-[1.02] font-medium tracking-tight">
              This page doesn&apos;t exist.
            </h1>
            <p className="text-muted-foreground mx-auto mt-4 max-w-md text-base leading-relaxed">
              The link may be old, or the page hasn&apos;t shipped yet.
            </p>
            <div className="mt-8 flex justify-center">
              <Link
                className="focus-ring bg-foreground text-background inline-flex h-11 items-center rounded-full px-6 text-sm font-medium transition-opacity hover:opacity-85"
                href="/"
              >
                Back to the home page
              </Link>
            </div>
          </div>
        </main>
        <Footer />
        <ThemeSwitch />
      </MarketingProviders>
    </div>
  );
}
