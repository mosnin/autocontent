"use client";

/**
 * The pieces every auth flow shares, built on the design system's StepFlow:
 * the back/progress row, the big email and password fields, the password
 * meter, the email code step and the two-factor step.
 */
import { Eye, EyeOff, Fingerprint, KeyRound } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, CodeInput, cx, Input, Notice, Step, StepBack, StepLink, StepProgress, type StepFlowState } from "@/design-system";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { OrRule } from "./frame";

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  return null;
}

/** 0 too short, 1 fine, 2 good, 3 strong. Length first; variety only helps once it's long enough. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < MIN_PASSWORD) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const unique = new Set(pw).size;
  if (unique < 5) return 1;
  if (pw.length >= 20 || (pw.length >= 14 && kinds >= 3)) return 3;
  if (pw.length >= 14 || kinds >= 3) return 2;
  return 1;
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** The row above every step: back on the left, quiet progress on the right. */
export function FlowHead({ flow, progress = true, count }: { flow: Pick<StepFlowState<string>, "back" | "canBack" | "index" | "count">; progress?: boolean; count?: number }) {
  const n = count ?? flow.count;
  return (
    <div className="mb-8 flex h-8 items-center justify-between">
      <StepBack flow={flow} />
      {progress && <StepProgress index={Math.min(flow.index, n - 1)} count={n} />}
    </div>
  );
}

export function EmailField({ label = "Email", value, onChange, autoComplete = "email", invalid }: { label?: string; value: string; onChange: (v: string) => void; autoComplete?: string; invalid?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-[13px] font-medium text-fg-muted">
        {label}
      </label>
      <Input id={id} inputSize="lg" type="email" name="email" inputMode="email" autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} placeholder="name@company.com" aria-invalid={invalid || undefined} />
    </div>
  );
}

export function PasswordField({
  label = "Password",
  value,
  onChange,
  autoComplete,
  meter,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "new-password" | "current-password";
  meter?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="block text-[13px] font-medium text-fg-muted">
          {label}
        </label>
        {hint}
      </div>
      <div className="relative">
        <Input
          id={id}
          inputSize="lg"
          type={shown ? "text" : "password"}
          name="password"
          autoComplete={autoComplete}
          minLength={autoComplete === "new-password" ? MIN_PASSWORD : undefined}
          maxLength={MAX_PASSWORD}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-11"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="ds-press absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-ds-sm text-fg-faint hover:bg-surface-3 hover:text-fg"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {meter && <PasswordMeter password={value} />}
    </div>
  );
}

const STRENGTH = ["", "Long enough", "Good", "Strong"] as const;

/** Live, quiet feedback while a new password is typed. The breach check happens on submit. */
export function PasswordMeter({ password }: { password: string }) {
  const s = passwordStrength(password);
  const left = Math.max(0, MIN_PASSWORD - password.length);
  return (
    <div className="pt-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cx("h-1 flex-1 rounded-full transition-colors duration-300", s >= i ? (s === 1 ? "bg-fg-faint" : s === 2 ? "bg-fg-muted" : "bg-positive") : "bg-hairline-strong")} />
        ))}
      </div>
      <p className="mt-2 text-[12.5px] text-fg-muted">
        {password.length === 0 ? `At least ${MIN_PASSWORD} characters. We check it against known data breaches.` : left > 0 ? `${left} more character${left === 1 ? "" : "s"}` : STRENGTH[s]}
      </p>
    </div>
  );
}

/** Seconds until `start()` may be called again. */
export function useCooldown(seconds: number, startActive = false) {
  const [left, setLeft] = useState(startActive ? seconds : 0);
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);
  return { left, start: useCallback(() => setLeft(seconds), [seconds]) };
}

/**
 * "Check your email": the six-digit code from the verification email. Resend
 * sends a new email (new code and link) after a cooldown. The link in the
 * email still works if they'd rather click it.
 */
export function EmailCodeStep({ email, onVerified, onChangeEmail, title = "Check your email" }: { email: string; onVerified: () => Promise<void> | void; onChangeEmail?: () => void; title?: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const resend = useCooldown(30, true);
  const inFlight = useRef(false);

  const verify = async (value = code) => {
    if (inFlight.current || value.length !== 6) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.emailOtp.verifyEmail({ email: email.trim(), otp: value });
    if (err) {
      inFlight.current = false;
      setBusy(false);
      setCode("");
      const msg = (err.message ?? "").toLowerCase();
      return setError(err.status === 429 ? authErrorMessage(err) : /expired/.test(msg) ? "That code has expired. Send a new one." : /attempt/.test(msg) ? "Too many tries with that code. Send a new one." : "That code didn't work. Check it and try again.");
    }
    await onVerified();
    inFlight.current = false;
    setBusy(false);
  };

  const sendAgain = async () => {
    if (resend.left > 0) return;
    resend.start();
    setError(null);
    const { error: err } = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: "/sign-in?verified=1" });
    setNote(err?.status === 429 ? null : "A new code is on its way.");
    if (err?.status === 429) setError(authErrorMessage(err));
  };

  return (
    <Step
      title={title}
      subtitle={
        <>
          Enter the 6-digit code we sent to <span className="inline-block max-w-full truncate align-bottom text-fg">{email}</span>
        </>
      }
      onSubmit={() => void verify()}
      primary={{ label: "Verify", loading: busy, disabled: code.length !== 6 }}
      secondary={
        <>
          <StepLink onClick={() => void sendAgain()} disabled={resend.left > 0}>
            {resend.left > 0 ? `Send a new code in 0:${String(resend.left).padStart(2, "0")}` : "Send a new code"}
          </StepLink>
          {onChangeEmail && <StepLink onClick={onChangeEmail}>Use a different email</StepLink>}
        </>
      }
    >
      <CodeInput label="Verification code" value={code} onChange={(v) => (setCode(v), setError(null))} onComplete={(v) => void verify(v)} invalid={Boolean(error)} disabled={busy} />
      <div className="mt-3 min-h-5">
        {error ? <Notice error={error} /> : note ? <Notice ok={note} /> : <p className="text-[12.5px] text-fg-faint">The email also has a link, if you&apos;d rather click.</p>}
      </div>
    </Step>
  );
}

/**
 * The second step of a sign-in: the authenticator code (six boxes), or a
 * backup code. "Trust this device" is one quiet checkbox, off by default.
 */
export function TwoFactorStep({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const backupId = useId();

  const submit = async (value = code) => {
    const v = value.replace(/\s+/g, "");
    if (inFlight.current || (mode === "totp" ? v.length !== 6 : v.length < 6)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const res = mode === "totp" ? await authClient.twoFactor.verifyTotp({ code: v, trustDevice: trust }) : await authClient.twoFactor.verifyBackupCode({ code: v, trustDevice: trust });
    inFlight.current = false;
    if (res.error) {
      setBusy(false);
      setCode("");
      if (res.error.status === 401 && /expired|session/i.test(res.error.message ?? "")) return setError("This sign-in timed out. Start again.");
      return setError(res.error.status === 429 ? authErrorMessage(res.error) : "That code didn't work. Check it and try again.");
    }
    onDone();
  };

  return (
    <Step
      title={mode === "totp" ? "Enter your code" : "Use a backup code"}
      subtitle={mode === "totp" ? "Open your authenticator app and type the six-digit code for Marketer." : "Each backup code works once."}
      onSubmit={() => void submit()}
      primary={{ label: "Verify", loading: busy }}
      secondary={
        <StepLink onClick={() => (setMode(mode === "totp" ? "backup" : "totp"), setCode(""), setError(null))}>{mode === "totp" ? "Use a backup code instead" : "Use your authenticator app"}</StepLink>
      }
    >
      {mode === "totp" ? (
        <CodeInput label="Code from your authenticator app" value={code} onChange={(v) => (setCode(v), setError(null))} onComplete={(v) => void submit(v)} invalid={Boolean(error)} disabled={busy} />
      ) : (
        <div className="space-y-2">
          <label htmlFor={backupId} className="block text-[13px] font-medium text-fg-muted">
            Backup code
          </label>
          <Input id={backupId} inputSize="lg" name="backup" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono tracking-wider" />
        </div>
      )}
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px] text-fg-muted">
        <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="mt-0.5 size-4 shrink-0" style={{ accentColor: "hsl(var(--ds-accent))" }} />
        <span>
          Trust this device for 30 days <span className="text-fg-faint">· not on shared computers</span>
        </span>
      </label>
      <div className="mt-3 min-h-5">
        <Notice error={error} />
      </div>
    </Step>
  );
}

/** Passkey and Google, under the email step: available, never in the way. */
export function OtherWaysIn({ google, busy, onPasskey, onGoogle }: { google: boolean; busy: string | null; onPasskey?: () => void; onGoogle: () => void }) {
  return (
    <div className="mt-8 space-y-3">
      <OrRule />
      <div className="flex flex-col gap-2">
        {onPasskey && (
          <Button size="lg" variant="ghost" className="w-full" onClick={onPasskey} loading={busy === "passkey"} disabled={busy !== null && busy !== "passkey"}>
            <Fingerprint /> Sign in with a passkey
          </Button>
        )}
        {google && (
          <Button size="lg" variant="ghost" className="w-full" onClick={onGoogle} loading={busy === "google"} disabled={busy !== null && busy !== "google"}>
            <KeyRound /> Continue with Google
          </Button>
        )}
      </div>
    </div>
  );
}
