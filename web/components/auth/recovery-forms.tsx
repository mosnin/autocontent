"use client";

/** Recovery, one thing at a time: forgot password, choose a new one, verify an email by code. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice, Step, StepFlow, StepLink, useStepFlow } from "@/design-system";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { EmailCodeStep, EmailField, FlowHead, isEmail, PasswordField, passwordProblem, useCooldown } from "./steps";

/**
 * /verify-email: the code from the verification email (the link in it works
 * too). Without the password in memory, a verified address continues to
 * sign-in with the email filled in.
 */
export function VerifyEmailForm({ email: preset, next }: { email?: string | null; next?: string | null }) {
  const router = useRouter();
  const flow = useStepFlow(["email", "code"] as const, { initial: preset ? "code" : "email" });
  const [email, setEmail] = useState(preset ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (busy) return;
    if (!isEmail(email)) return setError("Enter your email address, like name@company.com.");
    setBusy(true);
    const { error: err } = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: "/sign-in?verified=1" });
    setBusy(false);
    if (err?.status === 429) return setError(authErrorMessage(err));
    // Same answer whether or not the address has an account.
    flow.go("code");
  };

  const verified = () => {
    const q = new URLSearchParams({ verified: "1", email: email.trim() });
    if (next) q.set("next", next);
    router.replace(`/sign-in?${q.toString()}`);
  };

  return (
    <div>
      <FlowHead flow={flow} progress={false} />
      <StepFlow step={flow.step} direction={flow.direction}>
        {flow.step === "email" ? (
          <Step title="Verify your email" subtitle="We'll send a new code to finish creating your account." onSubmit={() => void send()} primary={{ label: "Send code", loading: busy }}>
            <EmailField value={email} onChange={(v) => (setEmail(v), setError(null))} invalid={Boolean(error)} />
            <div className="mt-3 min-h-5">
              <Notice error={error} />
            </div>
          </Step>
        ) : (
          <EmailCodeStep email={email} onVerified={verified} onChangeEmail={() => flow.go("email")} />
        )}
      </StepFlow>
    </div>
  );
}

/** Kept for callers of the old name: the verify page's resend is now the code step's own. */
export const ResendVerification = VerifyEmailForm;

export function ForgotPasswordForm() {
  const flow = useStepFlow(["email", "sent"] as const);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const again = useCooldown(30);

  const send = async () => {
    if (busy) return;
    if (!isEmail(email)) return setError("Enter your email address, like name@company.com.");
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
    setBusy(false);
    // Same answer for known and unknown addresses (no account enumeration).
    if (err?.status === 429) return setError(authErrorMessage(err));
    again.start();
    if (flow.step === "email") flow.go("sent");
  };

  return (
    <div>
      <FlowHead flow={flow} progress={false} />
      <StepFlow step={flow.step} direction={flow.direction}>
        {flow.step === "email" ? (
          <Step title="Reset your password" subtitle="We'll email you a link to choose a new one." onSubmit={() => void send()} primary={{ label: "Send reset link", loading: busy }}>
            <EmailField value={email} onChange={(v) => (setEmail(v), setError(null))} invalid={Boolean(error)} />
            <div className="mt-3 min-h-5">
              <Notice error={error} />
            </div>
          </Step>
        ) : (
          <Step
            title="Check your email"
            subtitle={
              <>
                If <span className="text-fg">{email}</span> has an account, a reset link is on its way. It works once, for an hour.
              </>
            }
            secondary={
              <StepLink onClick={() => void send()} disabled={busy || again.left > 0}>
                {again.left > 0 ? `Send again in 0:${String(again.left).padStart(2, "0")}` : "Send again"}
              </StepLink>
            }
          >
            <Notice error={error} />
          </Step>
        )}
      </StepFlow>
    </div>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const flow = useStepFlow(["password", "confirm"] as const);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toConfirm = () => {
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setError(null);
    flow.go("confirm");
  };

  const save = async () => {
    if (busy) return;
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (err) {
      // The breach check answers here: send them back to choose another.
      if (/breach|compromised/i.test(err.message ?? "")) {
        setConfirm("");
        flow.back();
      }
      return setError(/token/i.test(err.message ?? "") ? "This link has expired or was already used. Ask for a new one." : authErrorMessage(err));
    }
    router.replace("/sign-in?reset=1");
  };

  return (
    <div>
      <FlowHead flow={flow} />
      <StepFlow step={flow.step} direction={flow.direction}>
        {flow.step === "password" ? (
          <Step title="Choose a new password" subtitle="Every other session is signed out when you save it." onSubmit={toConfirm} primary={{ label: "Continue" }}>
            <PasswordField label="New password" value={password} onChange={(v) => (setPassword(v), setError(null))} autoComplete="new-password" meter />
            <div className="mt-3 min-h-5">
              <Notice error={error} />
            </div>
          </Step>
        ) : (
          <Step title="Type it again" subtitle="Just to be sure." onSubmit={() => void save()} primary={{ label: "Set password", loading: busy }}>
            <PasswordField label="Confirm password" value={confirm} onChange={(v) => (setConfirm(v), setError(null))} autoComplete="new-password" />
            <div className="mt-3 min-h-5">
              <Notice error={error} />
            </div>
          </Step>
        )}
      </StepFlow>
    </div>
  );
}
