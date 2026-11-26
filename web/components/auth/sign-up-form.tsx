"use client";

/**
 * Sign-up, one thing at a time: email, then password, then the code from the
 * verification email, then straight into onboarding. The account is created
 * when the password is accepted (so the breach check answers on the password
 * screen); verifying the code signs the person in with the password they just
 * chose, so there's no second sign-in.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice, Step, StepFlow, StepLink, useStepFlow } from "@/design-system";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { nextPath } from "./next-path";
import { EmailCodeStep, EmailField, FlowHead, isEmail, OtherWaysIn, PasswordField, passwordProblem } from "./steps";

export { MAX_PASSWORD, MIN_PASSWORD, passwordProblem } from "./steps";

const ORDER = ["email", "password", "code", "done"] as const;

export function SignUpForm({ next, email: presetEmail, google = false }: { next?: string | null; email?: string | null; google?: boolean }) {
  const router = useRouter();
  const flow = useStepFlow(ORDER);
  const [email, setEmail] = useState(presetEmail ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"create" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dest = nextPath(next);

  const toPassword = () => {
    if (!isEmail(email)) return setError("Enter your email address, like name@company.com.");
    setError(null);
    flow.go("password");
  };

  const create = async () => {
    if (busy) return;
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setBusy("create");
    setError(null);
    const verified = nextPath(next, "");
    const { error: err } = await authClient.signUp.email({
      // The name is inferred from the address (spec: displayName is never asked here); Settings can change it.
      name: email.split("@")[0] ?? "",
      email: email.trim(),
      password,
      // The link in the same email lands on sign-in, which then continues to `next`.
      callbackURL: `/sign-in?verified=1${verified ? `&next=${encodeURIComponent(verified)}` : ""}`,
    });
    setBusy(null);
    if (err) {
      if (err.status === 422 || /exist/i.test(err.message ?? "")) return setError("There's already an account with this email. Sign in instead.");
      return setError(authErrorMessage(err));
    }
    // The account exists now: the steps before this can't be redone, so the code replaces them in history.
    flow.go("code", { replace: true, lock: true });
  };

  const verified = async () => {
    flow.go("done", { replace: true, lock: true });
    const { data, error: err } = await authClient.signIn.email({ email: email.trim(), password });
    if (err) {
      router.replace(`/sign-in?verified=1${next ? `&next=${encodeURIComponent(dest)}` : ""}`);
      return;
    }
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return;
    router.replace(dest);
    router.refresh();
  };

  const google_ = async () => {
    if (busy) return;
    setBusy("google");
    const { error: err } = await authClient.signIn.social({ provider: "google", callbackURL: dest, errorCallbackURL: "/sign-in?error=google" });
    if (err) {
      setBusy(null);
      setError(authErrorMessage(err));
    }
  };

  const restart = () => {
    setPassword("");
    setEmail("");
    setError(null);
    window.location.assign(`/sign-up${next ? `?next=${encodeURIComponent(dest)}` : ""}`);
  };

  const view = (() => {
    switch (flow.step) {
      case "email":
        return (
          <>
            <Step title="Create your account" subtitle="Your marketing department, set up around your brand in a few minutes." onSubmit={toPassword} primary={{ label: "Continue" }}>
              <EmailField label="Work email" value={email} onChange={(v) => (setEmail(v), setError(null))} invalid={Boolean(error)} />
              <div className="mt-3 min-h-5">
                <Notice error={error} />
              </div>
            </Step>
            {google && <OtherWaysIn google busy={busy} onGoogle={() => void google_()} />}
          </>
        );
      case "password":
        return (
          <Step
            eyebrow={email}
            title="Choose a password"
            subtitle="You'll use it with this email to sign in."
            onSubmit={() => void create()}
            primary={{ label: "Create account", loading: busy === "create" }}
            secondary={error?.startsWith("There's already") ? <StepLink href={`/sign-in${next ? `?next=${encodeURIComponent(dest)}` : ""}`}>Sign in instead</StepLink> : undefined}
          >
            <PasswordField value={password} onChange={(v) => (setPassword(v), setError(null))} autoComplete="new-password" meter />
            <div className="mt-3 min-h-5">
              <Notice error={error} />
            </div>
          </Step>
        );
      case "code":
        return <EmailCodeStep email={email} onVerified={verified} onChangeEmail={restart} />;
      case "done":
        return <Step title="You're in" subtitle={<span className="ds-shimmer">Setting up your workspace…</span>} />;
    }
  })();

  return (
    <div>
      <FlowHead flow={flow} progress={flow.step !== "done"} count={3} />
      <StepFlow step={flow.step} direction={flow.direction}>
        {view}
      </StepFlow>
    </div>
  );
}
