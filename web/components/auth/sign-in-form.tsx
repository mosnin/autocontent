"use client";

import { Building2, Fingerprint, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Notice } from "@/design-system";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { OrRule, TextLink } from "./frame";
import { nextPath, withNext } from "./next-path";

type Mode = "password" | "sso";

export function SignInForm({ next, google, notice }: { next?: string | null; google: boolean; notice?: string | null }) {
  const router = useRouter();
  const dest = nextPath(next);
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"password" | "passkey" | "google" | "sso" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(notice ?? null);

  const done = () => {
    router.replace(dest);
    router.refresh();
  };

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy("password");
    setError(null);
    setOk(null);
    const { data, error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(null);
    if (error) {
      if (error.status === 403 && /verif/i.test(error.message ?? "")) {
        setOk("Verify your email first. We sent you a new link.");
        return;
      }
      setError(error.status === 401 ? "That email and password don't match." : authErrorMessage(error));
      return;
    }
    // With two-factor on, the client plugin redirects to /two-factor itself.
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
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: dest, errorCallbackURL: "/sign-in?error=google" });
    if (error) {
      setBusy(null);
      setError(authErrorMessage(error));
    }
  };

  const onSso = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy("sso");
    setError(null);
    const { error } = await authClient.signIn.sso({ email: email.trim(), callbackURL: dest, errorCallbackURL: "/sign-in?error=sso" });
    if (error) {
      setBusy(null);
      setError(error.status === 404 || /not found/i.test(error.message ?? "") ? "Your company doesn't use single sign-on with Marketer. Sign in another way." : authErrorMessage(error));
    }
  };

  if (mode === "sso")
    return (
      <form onSubmit={onSso} className="space-y-4">
        <Field label="Work email" hint="We find your company's sign-in from the domain.">
          <Input type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Notice error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === "sso"}>
          <Building2 /> Continue with SSO
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => (setMode("password"), setError(null))}>
          Back to other ways
        </Button>
      </form>
    );

  return (
    <div className="space-y-4">
      <form onSubmit={onPassword} className="space-y-4">
        <Field label="Email">
          <Input type="email" name="email" autoComplete="username webauthn" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint={<TextLink href={withNext("/forgot-password", next)}>Forgot your password?</TextLink>}>
          <Input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Notice ok={ok} error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === "password"} disabled={busy !== null && busy !== "password"}>
          Sign in
        </Button>
      </form>
      <OrRule />
      <div className="space-y-2">
        <Button type="button" size="lg" className="w-full" onClick={() => void onPasskey()} loading={busy === "passkey"} disabled={busy !== null && busy !== "passkey"}>
          <Fingerprint /> Sign in with a passkey
        </Button>
        {google && (
          <Button type="button" size="lg" className="w-full" onClick={() => void onGoogle()} loading={busy === "google"} disabled={busy !== null && busy !== "google"}>
            <KeyRound /> Continue with Google
          </Button>
        )}
        <Button type="button" size="lg" className="w-full" onClick={() => (setMode("sso"), setError(null))} disabled={busy !== null}>
          <Building2 /> Use SSO
        </Button>
      </div>
    </div>
  );
}
