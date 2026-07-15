import { api } from "@/lib/api";
import type { AyrshareConnectStatus } from "@/lib/types";
import { OnboardingExperience } from "./OnboardingExperience";

async function fetchAyrshareConnected(): Promise<boolean | null> {
  try {
    const s = await api<AyrshareConnectStatus>(
      "/api/v1/connect/ayrshare/status",
    );
    return Boolean(s?.connected);
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export default async function Onboarding() {
  const connected = await fetchAyrshareConnected();
  return <OnboardingExperience connected={connected} />;
}
