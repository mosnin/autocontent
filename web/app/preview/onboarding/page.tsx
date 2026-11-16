// Design-review preview of onboarding (no Clerk, no API: activation falls back gracefully).
import { OnboardingFlow } from "@/components/mk/onboarding/flow";

export default function PreviewOnboarding() {
  return <OnboardingFlow email="sam@pastaclub.co" displayName="Sam Rossi" inferredBrand="Pastaclub" inferredWebsite="pastaclub.co" savedBrand={null} channelsConnected={false} />;
}
