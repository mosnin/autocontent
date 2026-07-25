import { api } from "@/lib/api";
import type { SocialConnectStatus } from "@/lib/types";
import { OnboardingExperience } from "./OnboardingExperience";

async function fetchSocialsConnected(): Promise<boolean | null> {
  try {
    const s = await api<SocialConnectStatus>(
      "/api/v1/connect/zernio/status",
    );
    return Boolean(s?.connected);
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export default async function Onboarding() {
  const connected = await fetchSocialsConnected();
  return <OnboardingExperience connected={connected} />;
}
