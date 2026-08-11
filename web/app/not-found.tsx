import Link from "next/link";
import { connection } from "next/server";

// The root layout's <ClerkProvider> can't be statically prerendered with a
// placeholder key, and /_not-found is otherwise prerendered at build time.
export const dynamic = "force-dynamic";

import {
  MarketingFooter,
  MarketingNav,
} from "@/components/marketing/system";

/**
 * Global 404, styled like the marketing site (unknown URLs are almost
 * always logged-out traffic). Authed sections keep their own
 * app/(app)/not-found.tsx.
 */
export default async function NotFound() {
  // The root layout's <ClerkProvider> can't be statically prerendered with
  // a placeholder key, and /_not-found is otherwise prerendered at build
  // time — opt into dynamic rendering, matching the (marketing) group.
  await connection();

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f6f8] text-zinc-900">
      <MarketingNav />
      <main className="flex flex-1 items-center justify-center px-6 pt-24">
        <div className="text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
            404
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-zinc-900 md:text-5xl">
            This page doesn&apos;t exist.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[17px] leading-relaxed text-zinc-600">
            The link may be old, or the page hasn&apos;t shipped yet.
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              className="inline-flex min-h-11 items-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              href="/"
            >
              Back to the home page
            </Link>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
