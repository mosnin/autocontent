"use client";

import Link from "next/link";
import * as React from "react";
import useSWR from "swr";
import { AdminFrame } from "@/components/app/admin/admin-frame";
import { AccountStatusBadge, RoleBadge } from "@/components/app/admin/badges";
import { actionTone, formatDateTime, humanizeAction, relativeTime } from "@/components/app/admin/format";
import { Button, Callout, ConfirmModal, EmptyLine, Facts, Field, Input, KpiCard, Modal, MoneyInput, Notice, Section, StatusBadge, Table, Textarea } from "@/design-system";
import { adminGrantCredits, adminKeys, adminSetRole, adminSetSuspension } from "@/lib/admin-api";
import type { AdminUserRow, AuditEntry } from "@/lib/admin-types";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";

const POLL_MS = 20_000;
const AUDIT_NOTE = "Recorded in the audit log with your identity.";
type Dialog = "suspend" | "unsuspend" | "role" | "credits" | null;

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function UserDetailClient({ initialUser, initialAudit }: { initialUser: AdminUserRow; initialAudit: AuditEntry[] }) {
  const id = initialUser.user.id;
  const { data: row, mutate: mutateUser } = useSWR<AdminUserRow>(adminKeys.user(id), clientFetch, { refreshInterval: POLL_MS, fallbackData: initialUser });
  const { data: audit, mutate: mutateAudit } = useSWR<AuditEntry[]>(adminKeys.audit({ target_type: "user", target_id: id, limit: 20 }), clientFetch, { refreshInterval: POLL_MS, fallbackData: initialAudit });

  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [done, setDone] = React.useState<string | null>(null);

  const data = row ?? initialUser;
  const user = data.user;
  const suspended = Boolean(user.suspended_at);

  const finished = (msg: string) => {
    setDialog(null);
    setDone(msg);
    void mutateUser();
    void mutateAudit();
  };

  return (
    <AdminFrame
      crumbs={[{ label: "Users", href: "/admin/users" }, { label: user.email }]}
      actions={
        <>
          {suspended ? (
            <Button size="sm" onClick={() => setDialog("unsuspend")}>
              Reinstate
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setDialog("suspend")}>
              Suspend
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDialog("role")} className="hidden sm:inline-flex">
            Change role
          </Button>
          <Button size="sm" variant="primary" onClick={() => setDialog("credits")}>
            Grant credits
          </Button>
        </>
      }
    >
      {done && <Notice ok={done} />}
      {suspended && (
        <Callout tone="negative" title="Suspended">
          {formatDateTime(user.suspended_at as string)}
          {user.suspended_reason ? ` · ${user.suspended_reason}` : ""}
        </Callout>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total spend" value={formatUsd(data.spend_total_usd)} />
        <KpiCard label="Credit balance" value={formatUsd(user.credit_balance_usd)} />
        <KpiCard label="Jobs" value={data.job_count} />
        <KpiCard label="Articles" value={data.article_count} />
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Section title="Account">
          <Facts
            items={[
              { label: "Role", value: <RoleBadge role={user.role} /> },
              { label: "Status", value: <AccountStatusBadge user={user} /> },
              { label: "Niches", value: data.niche_count },
              { label: "Daily cap", value: user.global_daily_cap_usd ? formatUsd(user.global_daily_cap_usd) : "None" },
              { label: "Joined", value: formatDateTime(user.created_at) },
              { label: "ID", value: <code className="font-mono text-[12px] text-fg-muted">{user.id}</code> },
            ]}
          />
        </Section>
        <Section
          title="Recent admin actions"
          action={
            <Link href={`/admin/audit?target_type=user&target_id=${id}`} className="text-[12.5px] text-ds-accent hover:underline">
              View all
            </Link>
          }
        >
          <Table<AuditEntry>
            rows={audit ?? []}
            rowKey={(e) => String(e.id)}
            empty={<EmptyLine>No admin actions recorded for this user.</EmptyLine>}
            columns={[
              { key: "action", label: "Action", render: (e) => <span className="whitespace-nowrap"><StatusBadge tone={actionTone(e.action)}>{humanizeAction(e.action)}</StatusBadge></span> },
              { key: "actor", label: "By", hideOnPhone: true, render: (e) => <span className="block max-w-[200px] truncate text-fg-muted">{e.actor_email}</span> },
              { key: "when", label: "When", align: "right", render: (e) => <span className="whitespace-nowrap text-fg-muted" title={formatDateTime(e.created_at)}>{relativeTime(e.created_at)}</span> },
            ]}
          />
        </Section>
      </div>

      <SuspendModal open={dialog === "suspend"} onClose={() => setDialog(null)} email={user.email} userId={id} onDone={() => finished("Account suspended.")} />
      <UnsuspendModal open={dialog === "unsuspend"} onClose={() => setDialog(null)} email={user.email} userId={id} onDone={() => finished("Account reinstated.")} />
      <RoleModal open={dialog === "role"} onClose={() => setDialog(null)} email={user.email} currentRole={user.role} userId={id} onDone={(promoted) => finished(promoted ? "Granted admin access." : "Revoked admin access.")} />
      <CreditsModal open={dialog === "credits"} onClose={() => setDialog(null)} email={user.email} balance={user.credit_balance_usd} userId={id} onDone={(bal) => finished(`New balance: ${formatUsd(bal)}.`)} />
    </AdminFrame>
  );
}

/* ------------------------------------------------------------- dialogs */

function SuspendModal({ open, onClose, email, userId, onDone }: { open: boolean; onClose: () => void; email: string; userId: string; onDone: () => void }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) (setReason(""), setError(null));
  }, [open]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return setError("A reason is required to suspend an account.");
    setBusy(true);
    setError(null);
    try {
      await adminSetSuspension(userId, true, trimmed);
      onDone();
    } catch (err) {
      setError(errText(err, "Suspend failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmModal open={open} onClose={onClose} title={`Suspend ${email}?`} confirmLabel="Suspend account" danger busy={busy} disabled={!reason.trim()} error={error} onConfirm={() => void submit()}>
      <p>They lose access immediately and no new runs start. You can reinstate them any time. {AUDIT_NOTE}</p>
      <form onSubmit={submit}>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Abuse report #1234, pending review" maxLength={500} rows={3} autoFocus />
        </Field>
      </form>
    </ConfirmModal>
  );
}

function UnsuspendModal({ open, onClose, email, userId, onDone }: { open: boolean; onClose: () => void; email: string; userId: string; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminSetSuspension(userId, false, "");
      onDone();
    } catch (err) {
      setError(errText(err, "Reinstate failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmModal open={open} onClose={onClose} title={`Reinstate ${email}?`} confirmLabel="Reinstate" busy={busy} error={error} onConfirm={() => void confirm()}>
      <p>Access is restored immediately and the account can run pipelines again. {AUDIT_NOTE}</p>
    </ConfirmModal>
  );
}

function RoleModal({ open, onClose, email, currentRole, userId, onDone }: { open: boolean; onClose: () => void; email: string; currentRole: "user" | "admin"; userId: string; onDone: (promoted: boolean) => void }) {
  const nextRole = currentRole === "admin" ? "user" : "admin";
  const promoting = nextRole === "admin";
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminSetRole(userId, nextRole);
      onDone(promoting);
    } catch (err) {
      setError(errText(err, "Role change failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmModal open={open} onClose={onClose} title={promoting ? `Make ${email} an admin?` : `Demote ${email} to user?`} confirmLabel={promoting ? "Grant admin" : "Revoke admin"} danger={!promoting} busy={busy} error={error} onConfirm={() => void confirm()}>
      <p>
        {promoting ? "Admins can view and administer every account, including suspensions, roles and credits." : "They lose all admin access; privileged routes return 403 for them."} {AUDIT_NOTE}
      </p>
      <p>
        Role changes from <code className="font-mono text-fg">{currentRole}</code> to <code className="font-mono text-fg">{nextRole}</code>.
      </p>
    </ConfirmModal>
  );
}

function CreditsModal({ open, onClose, email, balance, userId, onDone }: { open: boolean; onClose: () => void; email: string; balance: string; userId: string; onDone: (newBalance: string) => void }) {
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) (setAmount(""), setNote(""), setError(null));
  }, [open]);

  const parsed = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(parsed) && parsed !== 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validAmount) return setError("Enter a non-zero amount.");
    if (!note.trim()) return setError("A note is required.");
    setBusy(true);
    setError(null);
    try {
      const res = await adminGrantCredits(userId, parsed, note.trim());
      onDone(res.new_balance_usd);
    } catch (err) {
      setError(errText(err, "Credit grant failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={`Adjust credits for ${email}`}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="credits-form" variant="primary" loading={busy} disabled={!validAmount || !note.trim()}>
            {parsed < 0 ? "Deduct credits" : "Grant credits"}
          </Button>
        </>
      }
    >
      <form id="credits-form" onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-fg-muted">
          Current balance {formatUsd(balance)}. A negative amount deducts. {AUDIT_NOTE}
        </p>
        <Field label="Amount (USD)">
          <MoneyInput min={undefined} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" autoFocus />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Goodwill credit, ticket #987" maxLength={200} />
        </Field>
        <Notice error={error} />
      </form>
    </Modal>
  );
}
