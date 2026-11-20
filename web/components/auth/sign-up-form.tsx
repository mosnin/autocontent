"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Notice } from "@/design-system";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { nextPath } from "./next-path";

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  return null;
}

export function SignUpForm({ next, email: presetEmail }: { next?: string | null; email?: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(presetEmail ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const dest = nextPath(next, "");
    const { error } = await authClient.signUp.email({
      name: name.trim() || email.split("@")[0] || "",
      email: email.trim(),
      password,
      // The verification link lands on sign-in, which then continues to `next`.
      callbackURL: `/sign-in?verified=1${dest ? `&next=${encodeURIComponent(dest)}` : ""}`,
    });
    setBusy(false);
    if (error) return setError(authErrorMessage(error));
    router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Your name">
        <Input name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Work email">
        <Input type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" hint={`${MIN_PASSWORD} to ${MAX_PASSWORD} characters. We check it against known breaches.`}>
        <Input type="password" name="password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Notice error={error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        Create account
      </Button>
    </form>
  );
}
