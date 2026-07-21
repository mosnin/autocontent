"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { formatDateTime, relativeTime } from "@/components/admin/format";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminKeys, adminUpsertFlag } from "@/lib/admin-api";
import { clientFetch } from "@/lib/client-fetcher";
import type { FeatureFlag } from "@/lib/admin-types";

const POLL_MS = 30_000;

const AUDIT_NOTE =
  "Every flag change is written to the append-only audit log with your identity.";

export function FlagsClient({ initial }: { initial: FeatureFlag[] }) {
  const key = adminKeys.flags();
  const { data, error, isLoading, mutate } = useSWR<FeatureFlag[]>(
    key,
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initial },
  );

  const [addOpen, setAddOpen] = React.useState(false);
  // Keys currently mid-flight, so we can disable just that row's switch.
  const [pending, setPending] = React.useState<Set<string>>(new Set());

  const errorToastedRef = React.useRef(false);
  React.useEffect(() => {
    if (error && !errorToastedRef.current) {
      errorToastedRef.current = true;
      toast.error(`Live updates paused: ${error.message ?? "fetch failed"}`);
    }
    if (!error) errorToastedRef.current = false;
  }, [error]);

  const flags = data ?? [];
  const sorted = React.useMemo(
    () => [...flags].sort((a, b) => a.key.localeCompare(b.key)),
    [flags],
  );
  const showInitialSkeleton = isLoading && !data;

  const setPendingFor = React.useCallback((k: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
  }, []);

  const onToggle = React.useCallback(
    async (flag: FeatureFlag, nextEnabled: boolean) => {
      setPendingFor(flag.key, true);
      // Optimistically flip the row; revalidate on settle.
      const optimistic = (list: FeatureFlag[] | undefined) =>
        (list ?? []).map((f) =>
          f.key === flag.key ? { ...f, enabled: nextEnabled } : f,
        );
      try {
        await mutate(
          async () => {
            const updated = await adminUpsertFlag(flag.key, {
              enabled: nextEnabled,
              description: flag.description,
            });
            return (data ?? []).map((f) =>
              f.key === flag.key ? updated : f,
            );
          },
          {
            optimisticData: optimistic,
            rollbackOnError: true,
            revalidate: false,
            populateCache: true,
          },
        );
        toast.success(
          `“${flag.key}” ${nextEnabled ? "enabled" : "disabled"} — change audited`,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Update failed");
      } finally {
        setPendingFor(flag.key, false);
      }
    },
    [data, mutate, setPendingFor],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Feature flags
          </h1>
          <p className="text-sm text-muted-foreground">
            Toggle platform capabilities in real time. {AUDIT_NOTE}
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          Add flag
        </Button>
      </div>

      {error && (
        <p className="text-sm text-muted-foreground">
          Live updates paused — {error.message ?? "fetch failed"}
        </p>
      )}

      {showInitialSkeleton ? (
        <LoadingTable />
      ) : sorted.length === 0 ? (
        <EmptyState onAdd={() => setAddOpen(true)} />
      ) : (
        <div className="overflow-x-auto">
          <Card className="min-w-[720px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Flag</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[190px]">Last updated</TableHead>
                  <TableHead className="w-[90px] text-right">Enabled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((flag) => (
                  <FlagRow
                    key={flag.key}
                    flag={flag}
                    pending={pending.has(flag.key)}
                    onToggle={onToggle}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      <AddFlagDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingKeys={flags.map((f) => f.key)}
        onCreated={(created) => {
          void mutate(
            (list) => {
              const rest = (list ?? []).filter((f) => f.key !== created.key);
              return [...rest, created];
            },
            { revalidate: false },
          );
        }}
      />
    </div>
  );
}

function FlagRow({
  flag,
  pending,
  onToggle,
}: {
  flag: FeatureFlag;
  pending: boolean;
  onToggle: (flag: FeatureFlag, next: boolean) => void;
}) {
  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm font-medium">{flag.key}</code>
          <Badge
            variant={flag.enabled ? "success" : "secondary"}
            className="font-mono lowercase"
          >
            {flag.enabled ? "on" : "off"}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">
        {flag.description || (
          <span className="italic text-muted-foreground/70">
            No description
          </span>
        )}
      </TableCell>
      <TableCell className="align-top text-xs text-muted-foreground">
        <div className="tabular-nums" title={formatDateTime(flag.updated_at)}>
          {relativeTime(flag.updated_at)}
        </div>
        <div className="truncate">
          {flag.updated_by ? (
            <>by {flag.updated_by}</>
          ) : (
            <span className="text-muted-foreground/70">never edited</span>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top text-right">
        <div className="flex justify-end">
          <Switch
            checked={flag.enabled}
            disabled={pending}
            onCheckedChange={(v) => onToggle(flag, v)}
            aria-label={`${flag.enabled ? "Disable" : "Enable"} ${flag.key}`}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function AddFlagDialog({
  open,
  onOpenChange,
  existingKeys,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingKeys: string[];
  onCreated: (flag: FeatureFlag) => void;
}) {
  const [key, setKey] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [enabled, setEnabled] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setKey("");
      setDescription("");
      setEnabled(false);
    }
  }, [open]);

  const trimmedKey = key.trim();
  const duplicate = existingKeys.includes(trimmedKey);
  const validKey = /^[a-z0-9][a-z0-9._-]*$/.test(trimmedKey);
  const canSubmit = trimmedKey !== "" && validKey && !duplicate && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmedKey) {
      toast.error("A flag key is required");
      return;
    }
    if (!validKey) {
      toast.error("Use lowercase letters, numbers, dots, dashes or underscores");
      return;
    }
    if (duplicate) {
      toast.error("A flag with that key already exists");
      return;
    }
    setSubmitting(true);
    try {
      const created = await adminUpsertFlag(trimmedKey, {
        enabled,
        description: description.trim(),
      });
      toast.success(`Flag “${created.key}” created — change audited`);
      onCreated(created);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
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
              New feature flag
            </p>
            <DialogTitle>Add a flag</DialogTitle>
            <DialogDescription>
              Create a new flag by key. It takes effect as soon as you save.{" "}
              {AUDIT_NOTE}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="flag-key">Key</Label>
              <Input
                id="flag-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. new_editor"
                className="font-mono"
                autoFocus
                aria-invalid={
                  trimmedKey !== "" && (!validKey || duplicate)
                    ? true
                    : undefined
                }
              />
              {trimmedKey !== "" && !validKey && (
                <p className="text-xs text-destructive">
                  Lowercase letters, numbers, dots, dashes or underscores only.
                </p>
              )}
              {duplicate && (
                <p className="text-xs text-destructive">
                  A flag with this key already exists.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="flag-description">Description</Label>
              <Textarea
                id="flag-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this flag gate?"
                maxLength={500}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <Label htmlFor="flag-enabled" className="text-sm font-medium">
                  Enabled
                </Label>
                <p className="text-xs text-muted-foreground">
                  Start this flag switched {enabled ? "on" : "off"}.
                </p>
              </div>
              <Switch
                id="flag-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Initial enabled state"
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
            <Button type="submit" disabled={!canSubmit} isLoading={submitting}>
              Create flag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LoadingTable() {
  return (
    <Card className="min-w-[720px]">
      <CardContent className="space-y-3 py-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="ml-auto h-6 w-11 rounded-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <h3 className="text-lg font-semibold">No feature flags yet</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create your first flag to gate a capability behind an admin toggle.
        </p>
        <Button size="sm" variant="outline" onClick={onAdd}>
          Add flag
        </Button>
        <p className="pt-1 text-xs text-muted-foreground">{AUDIT_NOTE}</p>
      </CardContent>
    </Card>
  );
}
