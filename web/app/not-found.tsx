import Link from "next/link";
import { connection } from "next/server";

import { SiteShell } from "@/components/site";
import "@/components/site/site.css";
import "@/components/site/bridge.css";

// The root layout's <ClerkProvider> can't be statically prerendered with a
// placeholder key, and /_not-found is otherwise prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Global 404, rendered inside the marketing shell.
 *
 * It used to render the old light-mode nav and footer on an off-white
 * ground, so a mistyped URL looked like a different product entirely —
 * which is exactly how it read while every nav link still pointed at the
 * export's `index.html`. Authed sections keep their own
 * app/(app)/not-found.tsx.
 */
export default async function NotFound() {
  // Opt into dynamic rendering, matching the (marketing) group.
  await connection();

  return (
    <SiteShell>
      <main className="os-notfound">
        <p className="os-notfound__code">404</p>
        <h1 className="os-notfound__title">This page doesn&apos;t exist.</h1>
        <p className="os-notfound__body">
          The link may be old, or the page hasn&apos;t shipped yet.
        </p>
        <div className="os-notfound__actions">
          <Link className="os-notfound__cta" href="/">
            Back to the home page
          </Link>
          <Link className="os-notfound__cta os-notfound__cta--ghost" href="/features">
            Browse the product
          </Link>
        </div>
      </main>
    </SiteShell>
  );
}
