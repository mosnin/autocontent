import { api } from "@/lib/api";
import { EMPTY_BRAND_KIT, type BrandKit } from "@/lib/brand-kit-client";
import { BrandKitForm } from "./BrandKitForm";

export const dynamic = "force-dynamic";

export default async function BrandKitPage() {
  // Fetched server-side and handed to the client as SWR fallbackData so the
  // form renders filled in immediately, then revalidates in the browser. The
  // endpoint returns an empty kit when none is set; on any failure we still
  // render with a blank kit rather than erroring the whole route.
  let kit: BrandKit = EMPTY_BRAND_KIT;
  try {
    kit = await api<BrandKit>("/api/v1/brand-kit");
  } catch {
    // ignore — the client seeds from the empty fallback and revalidates.
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Brand kit
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Your brand identity
        </h1>
        <p className="text-sm text-muted-foreground">
          One shared identity that seeds every new channel. When you describe a
          channel in a sentence during onboarding, its first draft is steered to
          match this name, tone, banned words, and hashtags.
        </p>
      </header>

      <BrandKitForm initial={kit} />
    </div>
  );
}
