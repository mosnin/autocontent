import { SignIn } from "@clerk/nextjs";

import { AuthShell } from "@/components/marketing/auth-shell";
import { clerkAppearance } from "@/lib/marketing/clerk-appearance";

export default function SignInPage() {
  return (
    <AuthShell>
      <SignIn appearance={clerkAppearance} fallbackRedirectUrl="/home" />
    </AuthShell>
  );
}
