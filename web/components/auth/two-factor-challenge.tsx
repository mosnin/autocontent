"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Notice, SwitchRow } from "@/design-system";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { nextPath } from "./next-path";

/** The second step of a sign-in: a code from the authenticator app, or a backup code. */
export function TwoFactorChallenge({ next }: { next?: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const value = code.replace(/\s+/g, "");
    const res = mode === "totp" ? await authClient.twoFactor.verifyTotp({ code: value, trustDevice: trust }) : await authClient.twoFactor.verifyBackupCode({ code: value, trustDevice: trust });
    setBusy(false);
    if (res.error) {
      if (res.error.status === 401 && /expired|session/i.test(res.error.message ?? "")) return setError("This sign-in timed out. Start again.");
      return setError(res.error.status === 429 ? authErrorMessage(res.error) : "That code didn't work. Check it and try again.");
    }
    router.replace(nextPath(next));
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "totp" ? (
        <Field label="Code from your authenticator app">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </Field>
      ) : (
        <Field label="Backup code" hint="Each backup code works once.">
          <Input name="backup" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </Field>
      )}
      <SwitchRow label="Trust this device for 30 days" detail="Skip the code here next time. Don't use on shared computers." checked={trust} onChange={setTrust} />
      <Notice error={error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        Verify
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => (setMode(mode === "totp" ? "backup" : "totp"), setCode(""), setError(null))}>
        {mode === "totp" ? "Use a backup code instead" : "Use your authenticator app"}
      </Button>
    </form>
  );
}
