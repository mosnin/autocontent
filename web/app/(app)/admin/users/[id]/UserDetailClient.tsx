"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  RotateCcw,
  ScrollText,
  Shield,
  Wallet,
} from "lucide-react";

import { AccountStatusBadge, RoleBadge } from "@/components/admin/badges";
import {
  actionTone,
  formatDateTime,
  humanizeAction,
  relativeTime,
} from "@/components/admin/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  adminGrantCredits,
  adminKeys,
  adminSetRole,
  adminSetSuspension,
} from "@/lib/admin-api";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AdminUserRow, AuditEntry } from "@/lib/admin-types";

const POLL_MS = 20_000;

export function UserDetailClient({
  initialUser,
  initialAudit,
}: {
  initialUser: AdminUserRow;
  initialAudit: AuditEntry[];
}) {
  const id = initialUser.user.id;

  const { data: row, mutate: mutateUser } = useSWR<AdminUserRow>(
    adminKeys.user(id),
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initialUser },
  );
  const { data: audit, mutate: mutateAudit } = useSWR<AuditEntry[]>(
    adminKeys.audit({ target_type: "user", target_id: id, limit: 20 }),
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initialAudit },
  );

  const [dialog, setDialog] = React.useState<
    "suspend" | "unsuspend" | "role" | "credits" | null
  >(null);

  const data = row ?? initialUser;
  const user = data.user;
  const suspended = Boolean(user.suspended_at);
  const entries = audit ?? [];

  function refresh() {
    void mutateUser();
    void mutateAudit();
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/users">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to users
        </Link>
      </Button>

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
            User
          </p>
          <h1 className="mt-1 break-all text-2xl font-semibold tracking-tight">
            {user.email}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RoleBadge role={user.role} />
            <AccountStatusBadge user={user} />
            <span className="font-mono text-xs text-muted-foreground">
              {user.id}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {suspended ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialog("unsuspend")}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Reinstate
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDialog("suspend")}
            >
              <Ban className="h-3.5 w-3.5" aria-hidden />
              Suspend
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setDialog("role")}>
            <Shield className="h-3.5 w-3.5" aria-hidden />
            Change role
          </Button>
          <Button size="sm" onClick={() => setDialog("credits")}>
            <Wallet className="h-3.5 w-3.5" aria-hidden />
            Grant credits
          </Button>
        </div>
      </div>

      {suspended && user.suspended_reason && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-4">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <div className="text-sm">
              <span className="font-medium">Suspended</span>{" "}
              <span className="text-muted-foreground">
                {formatDateTime(user.suspended_at as string)} —{" "}
                {user.suspended_reason}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* rollups */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Niches" value={String(data.niche_count)} />
        <StatCard label="Jobs" value={String(data.job_count)} />
        <StatCard label="Articles" value={String(data.article_count)} />
        <StatCard label="Total spend" value={formatUsd(data.spend_total_usd)} mono />
        <StatCard
          label="Credit balance"
          value={formatUsd(user.credit_balance_usd)}
          mono
        />
        <StatCard
          label="Daily cap"
          value={
            user.global_daily_cap_usd
              ? formatUsd(user.global_daily_cap_usd)
              : "none"
          }
          mono={Boolean(user.global_daily_cap_usd)}
        />
      </div>

      {/* recent audit */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ScrollText className="h-4 w-4 text-muted-foreground" aria-hidden />
            Recent admin actions
          </h2>
          <Link
            href={`/admin/audit?target_type=user&target_id=${id}`}
            className="text-xs font-medium text-brand hover:underline"
          >
            View all →
          </Link>
        </div>
        {entries.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No admin actions recorded for this user yet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border/60 p-0">
              {entries.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                >
                  <Badge
                    variant={actionTone(e.action)}
                    className="font-mono lowercase"
                  >
                    {humanizeAction(e.action)}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    by <span className="text-foreground">{e.actor_email}</span>
                  </span>
                  <span
                    className="ml-auto text-xs tabular-nums text-muted-foreground"
                    title={formatDateTime(e.created_at)}
                  >
                    {relativeTime(e.created_at)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <SuspendDialog
        open={dialog === "suspend"}
        onOpenChange={(v) => setDialog(v ? "suspend" : null)}
        email={user.email}
        onDone={refresh}
        userId={id}
      />
      <UnsuspendDialog
        open={dialog === "unsuspend"}
        onOpenChange={(v) => setDialog(v ? "unsuspend" : null)}
        email={user.email}
        onDone={refresh}
        userId={id}
      />
      <RoleDialog
        open={dialog === "role"}
        onOpenChange={(v) => setDialog(v ? "role" : null)}
        email={user.email}
        currentRole={user.role}
        onDone={refresh}
        userId={id}
      />
      <CreditsDialog
        open={dialog === "credits"}
        onOpenChange={(v) => setDialog(v ? "credits" : null)}
        email={user.email}
        balance={user.credit_balance_usd}
        onDone={refresh}
        userId={id}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="space-y-1 p-4">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "text-lg font-semibold tabular-nums",
            mono && "font-mono",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

// --- Dialogs ------------------------------------------------------------

const AUDIT_NOTE =
  "This action is recorded in the append-only audit log with your identity.";

function SuspendDialog({
  open,
  onOpenChange,
  email,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: string;
  userId: string;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("A reason is required to suspend an account");
      return;
    }
    setSubmitting(true);
    try {
      await adminSetSuspension(userId, true, trimmed);
      toast.success("Account suspended");
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suspend failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <DialogHeader>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
              Suspend account
            </p>
            <DialogTitle>Suspend {email}?</DialogTitle>
            <DialogDescription>
              The user immediately loses access and no new pipeline runs will
              start. You can reinstate them at any time. {AUDIT_NOTE}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="suspend-reason">Reason (required)</Label>
            <Textarea
              id="suspend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Abuse report #1234 — pending review"
              maxLength={500}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!reason.trim() || submitting}
              isLoading={submitting}
            >
              Suspend account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UnsuspendDialog({
  open,
  onOpenChange,
  email,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: string;
  userId: string;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);

  async function onConfirm() {
    setSubmitting(true);
    try {
      await adminSetSuspension(userId, false, "");
      toast.success("Account reinstated");
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reinstate failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
            Reinstate account
          </p>
          <DialogTitle>Reinstate {email}?</DialogTitle>
          <DialogDescription>
            Access is restored immediately and the account can run pipelines
            again. {AUDIT_NOTE}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={submitting} isLoading={submitting}>
            Reinstate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({
  open,
  onOpenChange,
  email,
  currentRole,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: string;
  currentRole: "user" | "admin";
  userId: string;
  onDone: () => void;
}) {
  const nextRole = currentRole === "admin" ? "user" : "admin";
  const promoting = nextRole === "admin";
  const [submitting, setSubmitting] = React.useState(false);

  async function onConfirm() {
    setSubmitting(true);
    try {
      await adminSetRole(userId, nextRole);
      toast.success(
        promoting ? "Granted admin access" : "Revoked admin access",
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Role change failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
            Change role
          </p>
          <DialogTitle>
            {promoting ? "Make" : "Demote"} {email} {promoting ? "an admin" : "to user"}?
          </DialogTitle>
          <DialogDescription>
            {promoting
              ? "Admins can view and administer every account on the platform, including suspending users, changing roles, and granting credits."
              : "This user will lose all administrative access and privileged routes will return 403 for them."}{" "}
            {AUDIT_NOTE}
          </DialogDescription>
        </DialogHeader>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            promoting
              ? "border-brand/40 bg-brand/5 text-brand"
              : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          <Shield className="size-4 shrink-0" aria-hidden />
          Role will change from{" "}
          <span className="font-mono">{currentRole}</span> to{" "}
          <span className="font-mono">{nextRole}</span>.
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={submitting}
            isLoading={submitting}
            variant={promoting ? "default" : "destructive"}
          >
            {promoting ? "Grant admin" : "Revoke admin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditsDialog({
  open,
  onOpenChange,
  email,
  balance,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: string;
  balance: string;
  userId: string;
  onDone: () => void;
}) {
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setAmount("");
      setNote("");
    }
  }, [open]);

  const parsed = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(parsed) && parsed !== 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validAmount) {
      toast.error("Enter a non-zero amount");
      return;
    }
    if (!note.trim()) {
      toast.error("A note is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminGrantCredits(userId, parsed, note.trim());
      toast.success(`New balance: ${formatUsd(res.new_balance_usd)}`);
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Credit grant failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <DialogHeader>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
              Adjust credits
            </p>
            <DialogTitle>Grant credits to {email}</DialogTitle>
            <DialogDescription>
              Current balance {formatUsd(balance)}. Enter a positive amount to
              grant, or a negative amount to deduct. {AUDIT_NOTE}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="credit-amount">Amount (USD)</Label>
              <Input
                id="credit-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 25.00"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credit-note">Note (required)</Label>
              <Input
                id="credit-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Goodwill credit — support ticket #987"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!validAmount || !note.trim() || submitting}
              isLoading={submitting}
            >
              {parsed < 0 ? "Deduct credits" : "Grant credits"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
