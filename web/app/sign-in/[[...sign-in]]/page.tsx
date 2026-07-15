import { SignIn } from "@clerk/nextjs";

// Real Clerk sign-in. Every signed-out CTA in the app points here; the
// catch-all segment lets Clerk handle its multi-step sub-routes.
export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-4">
      {/* Land on the suite launcher; a brand-new account arriving through
          this page (e.g. Google OAuth sign-up transfer) goes to onboarding.
          The middleware gate backstops every other path. */}
      <SignIn
        fallbackRedirectUrl="/home"
        signUpFallbackRedirectUrl="/onboarding"
      />
    </main>
  );
}
