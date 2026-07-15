import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-4">
      {/* New accounts go straight into onboarding (create the first channel);
          an existing account arriving here signs in and lands on the launcher. */}
      <SignUp
        fallbackRedirectUrl="/onboarding"
        signInFallbackRedirectUrl="/home"
      />
    </main>
  );
}
