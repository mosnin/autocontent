import { SignUp } from "@clerk/nextjs";

import { AuthShell } from "@/components/marketing/auth-shell";
import { clerkAppearance } from "@/lib/marketing/clerk-appearance";

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUp appearance={clerkAppearance} fallbackRedirectUrl="/onboarding" />
    </AuthShell>
  );
}
