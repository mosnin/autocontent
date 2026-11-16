import { currentUser } from "@clerk/nextjs/server";
import { OnboardingFlow } from "@/components/mk/onboarding/flow";
import { inferFromEmail } from "@/components/mk/onboarding/infer";
import type { BrandKit } from "@/lib/brand-kit-client";
import type { AyrshareConnectStatus } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Get started · Marketer" };

export default async function OnboardingPage() {
  const [user, brand, ayrshare] = await Promise.all([currentUser().catch(() => null), safe<BrandKit>("/api/v1/brand-kit"), safe<AyrshareConnectStatus>("/api/v1/connect/ayrshare/status")]);
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const inferred = inferFromEmail(email);
  return (
    <OnboardingFlow
      email={email}
      displayName={[user?.firstName, user?.lastName].filter(Boolean).join(" ")}
      inferredBrand={inferred.brand}
      inferredWebsite={inferred.website}
      savedBrand={brand?.brand_name || null}
      channelsConnected={Boolean(ayrshare?.connected)}
    />
  );
}
