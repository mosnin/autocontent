import { OnboardingFlow } from "@/components/app/onboarding/flow";
import { inferFromEmail } from "@/components/app/onboarding/infer";
import { getAuthContext } from "@/lib/auth/session";
import type { BrandKit } from "@/lib/brand-kit-client";
import type { AyrshareConnectStatus } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Get started · Marketer" };

export default async function OnboardingPage() {
  const [ctx, brand, ayrshare] = await Promise.all([getAuthContext().catch(() => null), safe<BrandKit>("/api/v1/brand-kit"), safe<AyrshareConnectStatus>("/api/v1/connect/ayrshare/status")]);
  const email = ctx?.user.email ?? "";
  const inferred = inferFromEmail(email);
  return (
    <OnboardingFlow
      email={email}
      displayName={ctx?.user.name ?? ""}
      inferredBrand={inferred.brand}
      inferredWebsite={inferred.website}
      savedBrand={brand?.brand_name || null}
      channelsConnected={Boolean(ayrshare?.connected)}
      workspaceId={ctx?.membership?.organizationId ?? null}
    />
  );
}
