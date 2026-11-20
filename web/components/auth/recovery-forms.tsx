"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Notice } from "@/design-system";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { passwordProblem, MAX_PASSWORD, MIN_PASSWORD } from "./sign-up-form";

/** "Didn't get it?" on the verify-email page. Says the same thing whether or not the address exists. */
export function ResendVerification({ email: preset }: { email?: string | null }) {
  const [email, setEmail] = useState(preset ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: "/sign-in?verified=1" });
    setBusy(false);
    setNote(error && error.status === 429 ? { error: authErrorMessage(error) } : { ok: "If that address has an account, a new link is on its way." });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Email">
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </Field>
      <Notice ok={note?.ok} error={note?.error} />
      <Button type="submit" className="w-full" loading={busy}>
        Send a new link
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
    setBusy(false);
    // Same answer for known and unknown addresses (no account enumeration).
    setNote(error && error.status === 429 ? { error: authErrorMessage(error) } : { ok: "If that address has an account, a reset link is on its way. It works for an hour." });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email">
        <Input type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
      </Field>
      <Notice ok={note?.ok} error={note?.error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        Send reset link
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(password) ?? (password !== confirm ? "The two passwords don't match." : null);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (error) return setError(/token/i.test(error.message ?? "") ? "This link has expired or was already used. Ask for a new one." : authErrorMessage(error));
    router.replace("/sign-in?reset=1");
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="New password" hint={`${MIN_PASSWORD} to ${MAX_PASSWORD} characters. Every other session is signed out.`}>
        <Input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      <Field label="Type it again">
        <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Notice error={error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        Set password
      </Button>
    </form>
  );
}
