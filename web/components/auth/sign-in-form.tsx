"use client";

/**
 * Sign-in, one thing at a time: email, then the password (or single sign-on
 * when the email's domain uses it), then the two-factor code when it's on.
 * An address that was never verified gets its code step right here. Passkey
 * and Google sit quietly under the email step.
 */
import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Notice, Step, StepFlow, StepLink, useStepFlow } from "@/design-system";
import { authClient, authErrorMessage, TWO_FACTOR_EVENT } from "@/lib/auth/client";
import { nextPath, withNext } from "./next-path";
import { ssoForEmail } from "./sso-hint";
import { EmailCodeStep, EmailField, FlowHead, isEmail, OtherWaysIn, PasswordField, TwoFactorStep } from "./steps";

const ORDER = ["email", "password", "sso", "verify", "two-factor"] as const;
type Busy = "email" | "password" | "passkey" | "google" | "sso" | null;

export function SignInForm({ next, google, notice, error: pageError, email: presetEmail }: { next?: string | null; google: boolean; notice?: string | null; error?: string | null; email?: string | null }) {
  const router = useRouter();
  const dest = nextPath(next);
  const flow = useStepFlow(ORDER);
  const [email, setEmail] = useState(presetEmail ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(pageError ?? null);
  const stepRef = useRef(flow.step);
  stepRef.current = flow.step;

  // A sign-in that needs the second factor stays on this page and asks for it.
  useEffect(() => {
    const onTwoFactor = (e: Event) => {
      if (stepRef.current !== "password" && stepRef.current !== "verify") return;
      e.preventDefault();
      setBusy(null);
      flow.go("two-factor", { replace: true, lock: true });
    };
    window.addEventListener(TWO_FACTOR_EVENT, onTwoFactor);
    return () => window.removeEventListener(TWO_FACTOR_EVENT, onTwoFactor);
  }, [flow]);

  const done = () => {
    router.replace(dest);
    router.refresh();
  };

  const toNext = async () => {
    if (busy) return;
    if (!isEmail(email)) return setError("Enter your email address, like name@company.com.");
    setError(null);
    setBusy("email");
    // Don't hold the person up if the lookup is slow: a password is always an option.
    const sso = await Promise.race([ssoForEmail(email).catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]);
    setBusy(null);
    flow.go(sso ? "sso" : "password");
  };

  const onPassword = async () => {
    if (busy) return;
    if (!password) return setError("Enter your password.");
    setBusy("password");
    setError(null);
    const { data, error: err } = await authClient.signIn.email({ email: email.trim(), password });
    if (err) {
      setBusy(null);
      if (err.status === 403 && /verif/i.test(err.message ?? "")) {
        // Better Auth just sent a fresh verification email (code and link).
        flow.go("verify");
        return;
      }
      return setError(err.status === 401 ? "That email and password don't match." : authErrorMessage(err));
    }
    // With two-factor on, the event above has already moved to the code step.
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return;
    done();
  };

  const onPasskey = async () => {
    if (busy) return;
    setBusy("passkey");
    setError(null);
    const res = await authClient.signIn.passkey();
    setBusy(null);
    if (res?.error) return setError(authErrorMessage(res.error, "That passkey didn't work. Try another way."));
    done();
  };

  const onGoogle = async () => {
    if (busy) return;
    setBusy("google");
    setError(null);
    const { error: err } = await authClient.signIn.social({ provider: "google", callbackURL: dest, errorCallbackURL: "/sign-in?error=google" });
    if (err) {
      setBusy(null);
      setError(authErrorMessage(err));
    }
  };

  const onSso = async () => {
    if (busy) return;
    setBusy("sso");
    setError(null);
    const { error: err } = await authClient.signIn.sso({ email: email.trim(), callbackURL: dest, errorCallbackURL: "/sign-in?error=sso" });
    if (err) {
      setBusy(null);
      setError(err.status === 404 || /not found/i.test(err.message ?? "") ? "Your company doesn't use single sign-on with Marketer. Use your password." : authErrorMessage(err));
    }
  };

  const view = (() => {
    switch (flow.step) {
      case "email":
        return (
          <>
            <Step title="Sign in" subtitle={notice ?? "Welcome back to your marketing department."} onSubmit={() => void toNext()} primary={{ label: "Continue", loading: busy === "email" }}>
              <EmailField value={email} onChange={(v) => (setEmail(v), setError(null))} autoComplete="username webauthn" invalid={Boolean(error)} />
              <div className="mt-3 min-h-5">
                <Notice error={error} />
              </div>
            </Step>
            <OtherWaysIn google={google} busy={busy} onPasskey={() => void onPasskey()} onGoogle={() => void onGoogle()} />
          </>
        );
      case "password":
        return (
          <Step
            eyebrow={email}
            title="Enter your password"
            onSubmit={() => void onPassword()}
            primary={{ label: "Sign in", loading: busy === "password" }}
            secondary={<StepLink onClick={() => void onPasskey()} disabled={busy !== null}>Use a passkey instead</StepLink>}
          >
            <PasswordField
              value={password}
              onChange={(v) => (setPassword(v), setError(null))}
              autoComplete="current-password"
              hint={
                <a href={withNext("/forgot-password", next)} className="text-[13px] text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                  Forgot it?
                </a>
              }
            />
            <div className="mt-3 min-h-5">
              <Notice error={error} />
            </div>
          </Step>
        );
      case "sso":
        return (
          <Step
            eyebrow={email}
            title="Your company signs you in"
            subtitle="This email's domain uses single sign-on. You'll continue with your company's sign-in page."
            onSubmit={() => void onSso()}
            primary={{
              label: (
                <>
                  <Building2 /> Continue with SSO
                </>
              ),
              loading: busy === "sso",
            }}
            secondary={<StepLink onClick={() => (setError(null), flow.go("password", { replace: true }))}>Use a password instead</StepLink>}
          >
            <Notice error={error} />
          </Step>
        );
      case "verify":
        return <EmailCodeStep email={email} title="Verify your email first" onVerified={() => onPassword()} />;
      case "two-factor":
        return <TwoFactorStep onDone={done} />;
    }
  })();

  return (
    <div>
      <FlowHead flow={flow} progress={false} />
      <StepFlow step={flow.step} direction={flow.direction}>
        {view}
      </StepFlow>
    </div>
  );
}
