"use client";

import { Fingerprint, KeyRound, Laptop, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Callout, ConfirmModal, EmptyLine, Field, Input, List, ListRow, Notice, QrCode, Section, StatusBadge, Time, usePending } from "@/design-system";
import { listMySessions, revokeMyOtherSessions, revokeMySession, type SessionSummary } from "@/lib/auth/actions";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { MAX_PASSWORD, MIN_PASSWORD, passwordProblem } from "./sign-up-form";

const NOT_FRESH = "For your security, sign out and back in, then try again.";

function message(error: { message?: string | null; status?: number; code?: string | null } | null | undefined, fallback?: string) {
  if (error?.code === "SESSION_NOT_FRESH") return NOT_FRESH;
  return authErrorMessage(error, fallback);
}

/** Change password. Every other session is signed out (the server forces it). */
export function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(next);
    if (problem) return setNote({ error: problem });
    setBusy(true);
    setNote(null);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (error) return setNote({ error: error.status === 400 && /password/i.test(error.message ?? "") ? message(error) : message(error, "Couldn't change your password.") });
    setCurrent("");
    setNext("");
    setNote({ ok: "Password changed. Your other sessions were signed out." });
  };
  return (
    <Section title="Password">
      <form onSubmit={onSubmit} className="space-y-3 rounded-ds-lg border border-hairline bg-surface p-4">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint={`${MIN_PASSWORD} to ${MAX_PASSWORD} characters, checked against known breaches.`}>
          <Input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy}>
            Change password
          </Button>
          <Notice inline ok={note?.ok} error={note?.error} />
        </div>
      </form>
    </Section>
  );
}

/** Two-factor enrolment: password → QR + backup codes → one code to confirm. Also used by /two-factor/setup. */
export function TwoFactorSection({ enabled: initialEnabled, onEnabled, title = "Two-factor authentication" }: { enabled: boolean; onEnabled?: () => void; title?: string }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [step, setStep] = useState<"idle" | "password" | "scan">("idle");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [fresh, setFresh] = useState<string[] | null>(null);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable(password ? { password } : ({} as { password: string }));
    setBusy(false);
    if (error || !data) return setError(error?.status === 400 || error?.status === 401 ? (error?.code === "SESSION_NOT_FRESH" ? NOT_FRESH : "That password isn't right.") : message(error));
    setSetup({ totpURI: data.totpURI, backupCodes: data.backupCodes });
    setPassword("");
    setStep("scan");
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s+/g, "") });
    setBusy(false);
    if (error) return setError(error.status === 429 ? message(error) : "That code didn't work. Codes change every 30 seconds; try the current one.");
    setEnabled(true);
    setStep("idle");
    setCode("");
    onEnabled?.();
  };

  const secret = setup ? new URL(setup.totpURI).searchParams.get("secret") : null;

  return (
    <Section title={title}>
      <div className="space-y-4 rounded-ds-lg border border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-[13px]">
            <ShieldCheck className="size-4 text-fg-muted" />
            <span>Authenticator app</span>
            {enabled ? <StatusBadge tone="positive">On</StatusBadge> : <StatusBadge>Off</StatusBadge>}
          </div>
          {enabled ? (
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setCodesOpen(true)}>
                New backup codes
              </Button>
              <Button size="sm" variant="danger" onClick={() => setDisableOpen(true)}>
                Turn off
              </Button>
            </div>
          ) : (
            step === "idle" && (
              <Button size="sm" variant="primary" onClick={() => (setStep("password"), setError(null))}>
                Set up
              </Button>
            )
          )}
        </div>
        {!enabled && step === "idle" && <p className="text-[12.5px] text-fg-muted">A code from an app like 1Password or Google Authenticator, on top of your password.</p>}

        {step === "password" && (
          <form onSubmit={start} className="space-y-3">
            <Field label="Confirm your password" hint="If you sign in only with Google or SSO, leave this empty.">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={busy}>
                Continue
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep("idle")}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {step === "scan" && setup && (
          <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <QrCode value={setup.totpURI} label="QR code for your authenticator app" />
              <div className="min-w-0 space-y-2 text-[12.5px] text-fg-muted">
                <p>Scan this with your authenticator app. Can&apos;t scan? Enter this key:</p>
                {secret && <code className="block break-all rounded-ds-sm border border-hairline bg-surface-2 px-2 py-1 font-mono text-[12px] text-fg" data-testid="totp-secret">{secret}</code>}
              </div>
            </div>
            <BackupCodes codes={setup.backupCodes} />
            <form onSubmit={confirm} className="space-y-3">
              <Field label="Code from the app">
                <Input name="totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Button type="submit" variant="primary" loading={busy}>
                Turn on two-factor
              </Button>
            </form>
          </div>
        )}
        <Notice error={error} />
        {fresh && <BackupCodes codes={fresh} onDone={() => setFresh(null)} />}
      </div>

      <PasswordConfirm
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Turn off two-factor?"
        confirmLabel="Turn off"
        danger
        body="Signing in will need only your password. A workspace that requires two-factor will ask you to set it up again."
        onConfirm={async (pw) => {
          const { error } = await authClient.twoFactor.disable(pw ? { password: pw } : ({} as { password: string }));
          if (error) throw new Error(message(error, "Couldn't turn it off."));
          setEnabled(false);
        }}
      />
      <PasswordConfirm
        open={codesOpen}
        onClose={() => setCodesOpen(false)}
        title="Make new backup codes?"
        confirmLabel="Make new codes"
        body="Your old backup codes stop working."
        onConfirm={async (pw) => {
          const { data, error } = await authClient.twoFactor.generateBackupCodes(pw ? { password: pw } : ({} as { password: string }));
          if (error || !data) throw new Error(message(error, "Couldn't make new codes."));
          setFresh(data.backupCodes);
        }}
      />
    </Section>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone?: () => void }) {
  return (
    <Callout tone="attention" title="Backup codes" action={onDone ? <Button size="sm" variant="ghost" onClick={onDone}>I&apos;ve saved them</Button> : undefined}>
      <p>Each works once if you lose your phone. Store them somewhere safe; they won&apos;t be shown again.</p>
      <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[12px] text-fg sm:grid-cols-3" data-testid="backup-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </Callout>
  );
}

function PasswordConfirm({ open, onClose, title, body, confirmLabel, danger, onConfirm }: { open: boolean; onClose: () => void; title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: (password: string) => Promise<void> }) {
  const [pw, setPw] = useState("");
  const { busy, error, run, setError } = usePending<"go">();
  const close = () => (setPw(""), setError(null), onClose());
  return (
    <ConfirmModal
      open={open}
      onClose={close}
      title={title}
      confirmLabel={confirmLabel}
      danger={danger}
      busy={busy === "go"}
      error={error}
      onConfirm={() => void run("go", async () => (await onConfirm(pw), close()))}
    >
      <p>{body}</p>
      <div className="mt-3">
        <Field label="Your password" hint="Leave empty if you have no password.">
          <Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
      </div>
    </ConfirmModal>
  );
}

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt: string | Date;
  deviceType?: string;
}

export function PasskeysSection({ initial }: { initial?: PasskeyRow[] }) {
  const [rows, setRows] = useState<PasskeyRow[] | null>(initial ?? null);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);
  const [remove, setRemove] = useState<PasskeyRow | null>(null);
  const { busy, error: removeError, run, setError } = usePending<"remove">();

  const load = useCallback(async () => {
    const { data, error } = await authClient.passkey.listUserPasskeys();
    if (error) return setNote({ error: "Couldn't load your passkeys." });
    setRows((data ?? []) as PasskeyRow[]);
  }, []);
  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);

  const add = async () => {
    if (adding) return;
    setAdding(true);
    setNote(null);
    const res = await authClient.passkey.addPasskey({ name: name.trim() || undefined });
    setAdding(false);
    if (res?.error) return setNote({ error: message(res.error, "The passkey wasn't added.") });
    setName("");
    setNote({ ok: "Passkey added." });
    void load();
  };

  return (
    <Section title="Passkeys">
      <div className="space-y-3">
        {rows === null ? null : rows.length === 0 ? (
          <EmptyLine>No passkeys yet. A passkey signs you in with your fingerprint, face or device PIN.</EmptyLine>
        ) : (
          <List>
            {rows.map((p) => (
              <ListRow key={p.id}>
                <Fingerprint className="size-4 shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{p.name || "Passkey"}</div>
                  <div className="text-[12px] text-fg-muted">
                    Added <Time iso={new Date(p.createdAt).toISOString()} />
                  </div>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Remove ${p.name || "passkey"}`} onClick={() => (setError(null), setRemove(p))}>
                  <Trash2 /> Remove
                </Button>
              </ListRow>
            ))}
          </List>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Field label="Name (optional)">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Work laptop" />
            </Field>
          </div>
          <Button onClick={() => void add()} loading={adding}>
            <KeyRound /> Add a passkey
          </Button>
        </div>
        <Notice ok={note?.ok} error={note?.error} />
      </div>
      <ConfirmModal
        open={remove !== null}
        onClose={() => setRemove(null)}
        title="Remove this passkey?"
        confirmLabel="Remove"
        danger
        busy={busy === "remove"}
        error={removeError}
        onConfirm={() =>
          void run("remove", async () => {
            const { error } = await authClient.passkey.deletePasskey({ id: remove!.id });
            if (error) throw new Error(message(error, "Couldn't remove it."));
            setRemove(null);
            await load();
          })
        }
      >
        <p>You won&apos;t be able to sign in with {remove?.name || "it"} any more.</p>
      </ConfirmModal>
    </Section>
  );
}

function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Active sessions with revoke. The list comes from a server action, so session tokens never reach this page. */
export function SessionsSection({ initial }: { initial?: SessionSummary[] }) {
  const [rows, setRows] = useState<SessionSummary[] | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, run } = usePending<string>();
  const load = useCallback(async () => {
    try {
      setRows(await listMySessions());
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load your sessions.");
    }
  }, []);
  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);

  const others = (rows ?? []).filter((r) => !r.current).length;
  return (
    <Section
      title="Sessions"
      action={
        others > 0 ? (
          <Button size="sm" variant="ghost" loading={busy === "others"} onClick={() => void run("others", async () => (await revokeMyOtherSessions(), await load()))}>
            Sign out other sessions
          </Button>
        ) : undefined
      }
    >
      {rows === null ? (
        loadError ? <EmptyLine>{loadError}</EmptyLine> : null
      ) : (
        <List>
          {rows.map((s) => (
            <ListRow key={s.id}>
              <Laptop className="size-4 shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="truncate">{deviceLabel(s.userAgent)}</span>
                  {s.current && <StatusBadge tone="accent">This device</StatusBadge>}
                </div>
                <div className="text-[12px] text-fg-muted">
                  {s.ipAddress ? `${s.ipAddress} · ` : ""}Active <Time iso={s.updatedAt} />
                </div>
              </div>
              {!s.current && (
                <Button size="sm" variant="ghost" loading={busy === s.id} disabled={busy !== null && busy !== s.id} onClick={() => void run(s.id, async () => (await revokeMySession(s.id), await load()))} data-testid="revoke-session">
                  Revoke
                </Button>
              )}
            </ListRow>
          ))}
        </List>
      )}
      <Notice error={error} />
    </Section>
  );
}

/** The whole Security tab. */
export function SecuritySettings({ twoFactorEnabled, hasPassword }: { twoFactorEnabled: boolean; hasPassword: boolean }) {
  return (
    <>
      {hasPassword ? <PasswordSection /> : <Callout title="No password">You sign in with Google or SSO. To add a password, use “Forgot your password?” on the sign-in page.</Callout>}
      <TwoFactorSection enabled={twoFactorEnabled} />
      <PasskeysSection />
      <SessionsSection />
    </>
  );
}

