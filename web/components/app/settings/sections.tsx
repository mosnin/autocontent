"use client";

import { Download, Wallet } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState, useTransition } from "react";
import { AskPill, Button, Callout, ConfirmModal, EmptyLine, Input, KpiCard, List, ListRow, MoneyInput, NotAllowed, Notice, PlanOption, Section, Segmented, Switch, Table, cx, useAllowed, type Palette } from "@/design-system";
import { authClient } from "@/lib/auth/client";
import { setThemeCookie, type AppTheme } from "@/components/shell/theme";
import { createCheckoutAction, updateEmailNotificationsAction, updateUserSettingsAction } from "@/lib/actions";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatDateTime, formatUsd } from "@/lib/format";
import type { BillingBalance } from "@/lib/types";
import { safeExternalUrl } from "@/lib/security/urls";

type Note = { ok?: string; error?: string } | null;

/** One setting: title and one line on the left, its control on the right. */
function Row({ title, children, control, tone }: { title: ReactNode; children?: ReactNode; control?: ReactNode; tone?: "negative" }) {
  return (
    <ListRow>
      <div className="min-w-0 flex-1">
        <div className={cx("text-[13px] font-medium", tone === "negative" ? "text-negative" : "text-fg")}>{title}</div>
        {children && <div className="mt-0.5 text-[12.5px] text-fg-muted">{children}</div>}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </ListRow>
  );
}

/* ----------------------------------------------------------------- profile */

export function ProfileSection({ email, initialNotifications }: { email: string | null; initialNotifications: boolean }) {
  const [enabled, setEnabled] = useState(initialNotifications);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note>(null);

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
    <Section title="Profile">
      <List>
        <Row title="Email" control={<span className="text-[13px] text-fg-muted">{email ?? "Unavailable"}</span>} />
        <Row title="Email notifications" control={<Switch checked={enabled} onChange={onToggle} label="Email notifications" disabled={pending} />}>
          When a video is ready to review, a piece finishes or a run fails. Webhooks fire either way.
          {note && (
            <div className="mt-1.5">
              <Notice ok={note.ok} error={note.error} />
            </div>
          )}
        </Row>
      </List>
    </Section>
  );
}

/* -------------------------------------------------------------- appearance */

function readTheme(): AppTheme {
  return document.querySelector(".ds")?.classList.contains("ds-light") ? "light" : "dark";
}

export function AppearanceSection() {
  const [theme, setTheme] = useState<AppTheme>("dark");
  useEffect(() => setTheme(readTheme()), []);
  const pick = (t: AppTheme) => {
    if (t === theme) return;
    setTheme(t);
    setThemeCookie(t);
    window.location.reload();
  };
  return (
    <Section title="Appearance">
      <List>
        <Row
          title="Theme"
          control={
            <Segmented
              label="Theme"
              size="sm"
              value={theme}
              onChange={pick}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
          }
        />
      </List>
    </Section>
  );
}

/* --------------------------------------------------------------- spend cap */

// A representative playbook, used only to turn a dollar cap into "videos a day".
const PER_VIDEO_USD = estimateVideoCostUsd({ scene_count: 6, image_quality: "medium", video_resolution: "720p", scene_max_duration_sec: 5, target_duration_sec: 60 }).total;

export function SpendCapSection({ initialCap }: { initialCap: string | null }) {
  const canSet = useAllowed("spend:set_limits");
  const has = initialCap != null && initialCap.trim() !== "";
  const [enabled, setEnabled] = useState(has);
  const [cap, setCap] = useState(has ? initialCap!.trim() : "");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<Note>(null);

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
    <Section title="Daily spend cap">
      <form onSubmit={submit} className="space-y-3">
        <List>
          <Row
            title="Enforce a global daily cap"
            control={
              <Switch
                checked={enabled}
                label="Enforce a global daily cap"
                onChange={(v) => {
                  setEnabled(v);
                  if (v && cap === "") setCap("10");
                }}
              />
            }
          >
            A ceiling on generation spend across every playbook, checked before each run. Ad spend has its own caps on Paid media.
          </Row>
          {enabled ? (
            <Row title="Per day" control={<div className="w-28"><MoneyInput value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Global daily spend cap in US dollars" /></div>}>
              <span className="tabular">
                About {perDay} video{perDay === 1 ? "" : "s"} a day at ≈{formatUsd(PER_VIDEO_USD)} each.
              </span>
            </Row>
          ) : (
            <Row title="Uncapped">Spend is bounded only by each playbook's own daily cap.</Row>
          )}
        </List>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Notice ok={note?.ok} error={note?.error} />
          {!canSet && <NotAllowed>Owners and admins set spend caps.</NotAllowed>}
          <Button type="submit" variant="primary" loading={pending} disabled={!canSet} className="ml-auto">
            Save cap
          </Button>
        </div>
      </form>
    </Section>
  );
}

/* ----------------------------------------------------------------- billing */

const PACKS: { key: string; label: string; amount: number; blurb: string; palette: Palette }[] = [
  { key: "starter", label: "Starter", amount: 5, blurb: "One playbook.", palette: "lagoon" },
  { key: "creator", label: "Creator", amount: 20, blurb: "A daily channel.", palette: "sunrise" },
  { key: "studio", label: "Studio", amount: 50, blurb: "Several playbooks.", palette: "bloom" },
];

type Tx = BillingBalance["transactions"][number];

export function BillingSection({ billing }: { billing: BillingBalance | null }) {
  const canBuy = useAllowed("billing:manage");
  const [buying, setBuying] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [all, setAll] = useState(false);

  // Surface the Stripe checkout outcome once, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("purchase");
    if (outcome === "success") setNote({ ok: "Payment received. Credit lands as soon as Stripe confirms." });
    else if (outcome === "cancelled") setNote({ error: "Checkout cancelled." });
    if (outcome) window.history.replaceState({}, "", `${window.location.pathname}#billing`);
  }, []);

  if (billing === null) return <EmptyLine>Couldn't reach billing. Your credit is safe; refresh in a moment.</EmptyLine>;
  if (!billing.billing_enabled) return <EmptyLine>Billing is off on this deployment. You run on your own API keys, limited only by your caps.</EmptyLine>;

  const buy = async (pack: string) => {
    setBuying(pack);
    setNote(null);
    const fd = new FormData();
    fd.set("pack", pack);
    const res = await createCheckoutAction({ ok: false }, fd);
    // Only ever send the browser to an https checkout page.
    const checkout = res.ok ? safeExternalUrl(res.url) : null;
    if (checkout) {
      window.location.href = checkout;
      return;
    }
    setBuying(null);
    setNote({ error: res.error ?? "Checkout failed" });
  };

  const low = Number(billing.balance_usd) < 1;
  const margin = Math.round((billing.margin - 1) * 100);
  const txs = all ? billing.transactions : billing.transactions.slice(0, 5);

  return (
    <>
      <Section title="Credit">
        <div className="space-y-3">
          <KpiCard icon={<Wallet />} label="Available credit" value={formatUsd(billing.balance_usd)} />
          {low && <Callout tone="attention">Running low. The pipeline pauses at zero.</Callout>}
        </div>
      </Section>

      <Section title="Add credit">
        <div className="space-y-3">
          {!canBuy && <NotAllowed>Owners, admins and Billing buy credit.</NotAllowed>}
          <div className="grid gap-3 sm:grid-cols-3">
            {PACKS.map((p) => (
              <PlanOption
                key={p.key}
                palette={p.palette}
                title={p.label}
                price={`$${p.amount}`}
                description={p.blurb}
                highlighted={p.key === "creator"}
                features={[`About ${Math.floor(p.amount / PER_VIDEO_USD)} videos`, `Provider cost + ${margin}%`, "Prepaid, never owed"]}
                cta={{ label: buying === p.key ? "Opening checkout…" : `Buy $${p.amount}`, onClick: () => canBuy && buying === null && void buy(p.key), loading: buying !== null, disabled: !canBuy }}
              />
            ))}
          </div>
          <Notice ok={note?.ok} error={note?.error} />
        </div>
      </Section>

      {billing.transactions.length > 0 && (
        <Section
          title="History"
          action={
            billing.transactions.length > 5 ? (
              <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
                {all ? "Show fewer" : `Show all ${billing.transactions.length}`}
              </Button>
            ) : undefined
          }
        >
          <Table<Tx>
            rows={txs}
            rowKey={(t) => t.id}
            columns={[
              { key: "what", label: "Description", render: (t) => <span className="block truncate">{t.description || t.kind}</span> },
              { key: "when", label: "Date", hideOnPhone: true, render: (t) => <span className="text-fg-muted tabular">{formatDateTime(t.created_at)}</span> },
              {
                key: "amount",
                label: "Amount",
                align: "right",
                render: (t) => {
                  const amt = Number(t.amount_usd);
                  return (
                    <span className={amt > 0 ? "text-positive" : "text-fg-muted"}>
                      {amt > 0 ? "+" : ""}
                      {formatUsd(amt)}
                    </span>
                  );
                },
              },
            ]}
          />
        </Section>
      )}
      <AskPill label="Ask where your credit goes" href={`/sessions/new?dept=analytics&q=${encodeURIComponent("Where did my credit go this month, and what should I cut?")}`} />
    </>
  );
}

/* ----------------------------------------------------------------- privacy */

const DATA_ITEMS = ["Your profile and account details", "Every playbook and its configuration", "All videos, carousels and their spend records", "Generated articles and video metadata", "Access token prefixes (never the secrets)"];
const CONFIRM_WORD = "DELETE";

export function PrivacySection({ email }: { email: string | null }) {
  const canDelete = useAllowed("workspace:delete");
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<Note>(null);
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
      await authClient.signOut().catch(() => undefined);
      window.location.href = "/";
    } catch {
      setDeleting(false);
      setDelError("Couldn't delete your account. Please try again.");
    }
  };

  return (
    <Section title="Data and privacy">
      <List>
        <Row
          title="Export your data"
          control={
            <Button onClick={() => void onExport()} loading={exporting}>
              <Download /> Download
            </Button>
          }
        >
          A machine-readable copy of everything we hold about your account.
          {note && (
            <div className="mt-1.5">
              <Notice ok={note.ok} error={note.error} />
            </div>
          )}
        </Row>
        <Row
          title="Delete account"
          tone="negative"
          control={
            <Button variant="danger" onClick={() => setOpen(true)} disabled={!canDelete} title={canDelete ? undefined : "Only an owner can delete the workspace's data."}>
              Delete account
            </Button>
          }
        >
          Erases your account and everything tied to it, immediately. No recovery.
        </Row>
      </List>

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
        <p>This can't be undone. All of this is erased immediately:</p>
        <ul className="list-disc space-y-1 pl-5">
          {DATA_ITEMS.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <label className="block space-y-1.5">
          <span className="text-fg">
            To confirm, type {email ? <>your email <code className="font-mono text-[12.5px]">{email}</code> or </> : "the word "}
            <code className="font-mono text-[12.5px]">{CONFIRM_WORD}</code>
          </span>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={deleting} placeholder={email ?? CONFIRM_WORD} aria-invalid={t.length > 0 && !confirmed} />
        </label>
      </ConfirmModal>
    </Section>
  );
}
