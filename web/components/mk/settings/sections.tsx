"use client";

import { Download } from "lucide-react";
import { useTheme } from "next-themes";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { createCheckoutAction, updateEmailNotificationsAction, updateUserSettingsAction } from "@/lib/actions";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatDateTime, formatUsd } from "@/lib/format";
import type { BillingBalance } from "@/lib/types";
import { Button, cx, Input, Segmented, Switch } from "../ui";
import { ConfirmModal, MoneyInput, SaveNote } from "./primitives";

/* ----------------------------------------------------------------- profile */

export function ProfileSection({ email, initialNotifications }: { email: string | null; initialNotifications: boolean }) {
  const [enabled, setEnabled] = useState(initialNotifications);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);

  const onToggle = (next: boolean) => {
    const prev = enabled;
    setEnabled(next); // optimistic, reverted if the server refuses
    setNote(null);
    start(async () => {
      // Sends only email_notifications so the spend cap is never touched.
      const res = await updateEmailNotificationsAction(next);
      if (!res.ok) {
        setEnabled(prev);
        setNote({ error: res.error ?? "Couldn't save your preference" });
      } else setNote({ ok: next ? "Email notifications on." : "Email notifications off." });
    });
  };

  return (
    <div className="divide-y divide-border">
      <div className="flex items-center justify-between gap-4 pb-3.5">
        <div className="min-w-0">
          <div className="text-[13px] text-muted-foreground">Email</div>
          <div className="truncate text-[14px] font-medium">{email ?? "Unavailable"}</div>
        </div>
      </div>
      <div className="flex items-start justify-between gap-4 pt-3.5">
        <div className="min-w-0">
          <div className="text-[14px] font-medium">Email notifications</div>
          <p className="max-w-[52ch] text-[13px] text-muted-foreground">An email when a video is ready to review, a video or article finishes, or a run fails. Webhooks fire regardless of this setting.</p>
          <div className="mt-1.5">
            <SaveNote ok={note?.ok} error={note?.error} />
          </div>
        </div>
        <span className={cx(pending && "opacity-60")}>
          <Switch checked={enabled} onChange={onToggle} label="Email notifications" />
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- spend cap */

// A representative playbook, used only to turn a dollar cap into "videos a day".
const PER_VIDEO_USD = estimateVideoCostUsd({ scene_count: 6, image_quality: "medium", video_resolution: "720p", scene_max_duration_sec: 5, target_duration_sec: 60 }).total;

export function SpendCapSection({ initialCap }: { initialCap: string | null }) {
  const has = initialCap != null && initialCap.trim() !== "";
  const [enabled, setEnabled] = useState(has);
  const [cap, setCap] = useState(has ? initialCap!.trim() : "");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);

  const n = cap === "" ? NaN : Number(cap);
  const valid = Number.isFinite(n) && n >= 0;
  const perDay = enabled && valid && n > 0 ? Math.floor(n / PER_VIDEO_USD) : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setNote(null);
    const fd = new FormData();
    // Off submits an empty value, which clears the cap.
    fd.set("global_daily_cap_usd", enabled ? cap : "");
    const res = await updateUserSettingsAction({ ok: false }, fd);
    setPending(false);
    setNote(res.ok ? { ok: enabled ? "Daily cap saved." : "Global cap removed." } : { error: res.error ?? "Couldn't save the cap" });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-medium">Enforce a global daily cap</div>
          <p className="max-w-[54ch] text-[13px] text-muted-foreground">An account-wide ceiling on generation spend across every playbook, checked before each run. Anything that would cross it is refused, not truncated. Ad spend has its own caps on Paid media.</p>
        </div>
        <Switch
          checked={enabled}
          label="Enforce a global daily cap"
          onChange={(v) => {
            setEnabled(v);
            if (v && cap === "") setCap("10");
          }}
        />
      </div>
      {enabled ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-40 space-y-1.5">
            <span className="text-[13px] font-medium">Per day</span>
            <MoneyInput value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Global daily spend cap in US dollars" />
          </label>
          <p className="pb-2 text-[13px] text-muted-foreground tabular">
            About {perDay} video{perDay === 1 ? "" : "s"} a day at ≈{formatUsd(PER_VIDEO_USD)} each for a typical playbook.
          </p>
        </div>
      ) : (
        <p className="rounded-[14px] bg-subtle px-4 py-3 text-[13px] text-muted-foreground">Uncapped. Spend is bounded only by each playbook's own daily cap.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SaveNote ok={note?.ok} error={note?.error} />
        <Button type="submit" variant="primary" loading={pending} className="ml-auto">
          Save cap
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------- billing */

const PACKS = [
  { key: "starter", label: "Starter", amount: 5, blurb: "Try the machine" },
  { key: "creator", label: "Creator", amount: 20, blurb: "A daily channel" },
  { key: "studio", label: "Studio", amount: 50, blurb: "Several playbooks" },
];

export function BillingSection({ billing }: { billing: BillingBalance | null }) {
  const [buying, setBuying] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);
  const [all, setAll] = useState(false);

  // Surface the Stripe checkout outcome once, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("purchase");
    if (outcome === "success") setNote({ ok: "Payment received. Credit lands as soon as Stripe confirms." });
    else if (outcome === "cancelled") setNote({ error: "Checkout cancelled." });
    if (outcome) window.history.replaceState({}, "", `${window.location.pathname}#billing`);
  }, []);

  if (billing === null) return <p className="text-[13px] text-muted-foreground">We couldn't reach billing right now. Your credit is safe; refresh in a moment.</p>;
  if (!billing.billing_enabled) return <p className="text-[13px] text-muted-foreground">Billing isn't enabled on this deployment. You're running on your own API keys, and the only limits are the caps you set.</p>;

  const buy = async (pack: string) => {
    setBuying(pack);
    setNote(null);
    const fd = new FormData();
    fd.set("pack", pack);
    const res = await createCheckoutAction({ ok: false }, fd);
    if (res.ok && res.url) {
      window.location.href = res.url;
      return;
    }
    setBuying(null);
    setNote({ error: res.error ?? "Checkout failed" });
  };

  const low = Number(billing.balance_usd) < 1;
  const txs = all ? billing.transactions : billing.transactions.slice(0, 5);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[13px] text-muted-foreground">Available credit</div>
        <div className={cx("text-[32px] font-medium tracking-[-0.02em] tabular", low && "text-queued")}>{formatUsd(billing.balance_usd)}</div>
        <p className="text-[13px] text-muted-foreground">
          {low ? "Running low: the pipeline pauses at zero. " : ""}Work draws down prepaid credit at provider cost plus a {Math.round((billing.margin - 1) * 100)}% margin. The spend guard refuses anything your balance can't cover, so you can never owe us.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PACKS.map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={buying !== null}
            onClick={() => void buy(p.key)}
            className="press flex min-w-0 flex-col items-start rounded-[14px] border border-border bg-card px-3 py-3 text-left sm:px-4 transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            <span className="text-[13px] text-muted-foreground">{p.label}</span>
            <span className="text-[22px] font-medium tracking-[-0.02em] tabular">${p.amount}</span>
            <span className="truncate text-[12.5px] text-faint max-w-full">{buying === p.key ? "Opening checkout…" : p.blurb}</span>
          </button>
        ))}
      </div>
      <SaveNote ok={note?.ok} error={note?.error} />
      {billing.transactions.length > 0 && (
        <div>
          <div className="mb-1.5 text-[13px] text-muted-foreground">History</div>
          <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border">
            {txs.map((tx) => {
              const amt = Number(tx.amount_usd);
              return (
                <li key={tx.id} className="flex min-h-[44px] items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{tx.description || tx.kind}</span>
                    <span className="block text-[12px] text-faint tabular">{formatDateTime(tx.created_at)}</span>
                  </span>
                  <span className={cx("shrink-0 text-[13px] tabular", amt > 0 ? "text-floor" : "text-muted-foreground")}>
                    {amt > 0 ? "+" : ""}
                    {formatUsd(amt)}
                  </span>
                </li>
              );
            })}
          </ul>
          {billing.transactions.length > 5 && (
            <div className="mt-1.5 flex justify-center">
              <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
                {all ? "Show fewer" : `Show all ${billing.transactions.length}`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- privacy */

const DATA_ITEMS = ["Your profile and account details", "Every playbook and its configuration", "All videos, carousels and their spend records", "Generated articles and video metadata", "Access token prefixes (never the secrets)"];
const CONFIRM_WORD = "DELETE";

export function PrivacySection({ email }: { email: string | null }) {
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);
  const [delError, setDelError] = useState<string | null>(null);

  const t = typed.trim();
  const confirmed = (!!email && t.toLowerCase() === email.toLowerCase()) || t === CONFIRM_WORD;

  const onExport = async () => {
    setExporting(true);
    setNote(null);
    try {
      const res = await fetch("/api/proxy/api/v1/users/me/export", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const match = res.headers.get("content-disposition")?.match(/filename="?([^"]+)"?/i);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? "marketer-data-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNote({ ok: "Your export downloaded." });
    } catch {
      setNote({ error: "Export failed. Please try again." });
    } finally {
      setExporting(false);
    }
  };

  const onDelete = async () => {
    if (!confirmed) return;
    setDeleting(true);
    setDelError(null);
    try {
      const res = await fetch("/api/proxy/api/v1/users/me", { method: "DELETE" });
      if (res.status !== 204 && !res.ok) throw new Error(String(res.status));
      // Point of no return: end the session and land on the home page.
      const clerk = (window as unknown as { Clerk?: { signOut: (o: { redirectUrl: string }) => Promise<void> } }).Clerk;
      try {
        if (clerk) await clerk.signOut({ redirectUrl: "/" });
        else window.location.href = "/";
      } catch {
        window.location.href = "/";
      }
    } catch {
      setDeleting(false);
      setDelError("Couldn't delete your account. Please try again.");
    }
  };

  return (
    <div className="divide-y divide-border">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
        <div className="min-w-0 flex-1 basis-[260px]">
          <div className="text-[14px] font-medium">Export your data</div>
          <p className="text-[13px] text-muted-foreground">A machine-readable copy of everything we hold about your account (your GDPR right to portability): {DATA_ITEMS.join(", ").toLowerCase()}.</p>
          <div className="mt-1.5">
            <SaveNote ok={note?.ok} error={note?.error} />
          </div>
        </div>
        <Button onClick={() => void onExport()} loading={exporting}>
          <Download /> Download my data
        </Button>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 pt-4">
        <div className="min-w-0 flex-1 basis-[260px]">
          <div className="text-[14px] font-medium text-destructive">Delete account</div>
          <p className="text-[13px] text-muted-foreground">Permanently erase your account and everything tied to it. Playbooks, videos, articles, spend history and tokens are wiped immediately. No recovery, no grace period.</p>
        </div>
        <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </div>

      <ConfirmModal
        open={open}
        onClose={() => !deleting && (setOpen(false), setTyped(""), setDelError(null))}
        title="Delete your account permanently?"
        confirmLabel="Permanently delete"
        danger
        busy={deleting}
        disabled={!confirmed}
        error={delError}
        onConfirm={() => void onDelete()}
      >
        <p>This can't be undone. Your account and all of this is erased immediately:</p>
        <ul className="space-y-1 rounded-[14px] bg-destructive/[0.06] px-4 py-3 text-[13px]">
          {DATA_ITEMS.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <label className="block space-y-1.5">
          <span className="text-[13px] text-foreground">
            To confirm, type {email ? <>your email <code className="font-mono text-[12.5px]">{email}</code> or </> : "the word "}
            <code className="font-mono text-[12.5px]">{CONFIRM_WORD}</code>
          </span>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={deleting} placeholder={email ?? CONFIRM_WORD} aria-invalid={t.length > 0 && !confirmed} />
        </label>
      </ConfirmModal>
    </div>
  );
}

/* -------------------------------------------------------------- appearance */

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const value = (mounted ? theme : undefined) ?? "system";
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">Theme</div>
        <p className="text-[13px] text-muted-foreground">Light and dark are equals. System follows your device.</p>
      </div>
      <Segmented
        label="Theme"
        value={value as "light" | "dark" | "system"}
        onChange={(v) => setTheme(v)}
        className="w-full sm:w-[240px]"
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "System" },
        ]}
      />
    </div>
  );
}
