"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronDown, X } from "lucide-react";

import {
  actionTone,
  formatDateTime,
  humanizeAction,
  relativeTime,
} from "@/components/admin/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminKeys } from "@/lib/admin-api";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import type { AuditEntry, AuditQuery } from "@/lib/admin-types";

export const AUDIT_PAGE_SIZE = 50;

type Filters = {
  action: string;
  target_type: string;
  target_id: string;
  actor_id: string;
};

function toFilters(q: AuditQuery): Filters {
  return {
    action: q.action ?? "",
    target_type: q.target_type ?? "",
    target_id: q.target_id ?? "",
    actor_id: q.actor_id ?? "",
  };
}

function toQuery(f: Filters): AuditQuery {
  return {
    action: f.action.trim() || undefined,
    target_type: f.target_type.trim() || undefined,
    target_id: f.target_id.trim() || undefined,
    actor_id: f.actor_id.trim() || undefined,
  };
}

export function AuditClient({
  initial,
  initialFilters,
}: {
  initial: AuditEntry[];
  initialFilters: AuditQuery;
}) {
  const [draft, setDraft] = React.useState<Filters>(toFilters(initialFilters));
  const [applied, setApplied] = React.useState<Filters>(
    toFilters(initialFilters),
  );
  const [entries, setEntries] = React.useState<AuditEntry[]>(initial);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(initial.length < AUDIT_PAGE_SIZE);
  const mounted = React.useRef(false);

  const load = React.useCallback(
    async (reset: boolean, filters: Filters, cursorId?: number) => {
      setLoading(true);
      try {
        const page = await clientFetch<AuditEntry[]>(
          adminKeys.audit({
            ...toQuery(filters),
            before_id: reset ? undefined : cursorId,
            limit: AUDIT_PAGE_SIZE,
          }),
        );
        setEntries((prev) => (reset ? page : [...prev, ...page]));
        setDone(page.length < AUDIT_PAGE_SIZE);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load audit log",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Reload from scratch whenever the applied filters change (but not on the
  // initial mount — the server already provided that page).
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void load(true, applied);
  }, [applied, load]);

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(applied) ||
    Object.values(applied).some(Boolean);

  function apply() {
    setApplied(draft);
  }
  function clearAll() {
    const empty = { action: "", target_type: "", target_id: "", actor_id: "" };
    setDraft(empty);
    setApplied(empty);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Append-only record of every privileged action. Newest first.
        </p>
      </div>

      {/* filters */}
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="text-sm font-medium">Filters</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field
              id="f-action"
              label="Action"
              value={draft.action}
              onChange={(v) => setDraft((d) => ({ ...d, action: v }))}
              placeholder="user.suspend"
            />
            <Field
              id="f-target-type"
              label="Target type"
              value={draft.target_type}
              onChange={(v) => setDraft((d) => ({ ...d, target_type: v }))}
              placeholder="user"
            />
            <Field
              id="f-target-id"
              label="Target ID"
              value={draft.target_id}
              onChange={(v) => setDraft((d) => ({ ...d, target_id: v }))}
              placeholder="usr_…"
            />
            <Field
              id="f-actor-id"
              label="Actor ID"
              value={draft.actor_id}
              onChange={(v) => setDraft((d) => ({ ...d, actor_id: v }))}
              placeholder="usr_…"
            />
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
              <Button type="submit" size="sm">
                Apply filters
              </Button>
              {dirty && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={clearAll}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Clear
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {entries.length === 0 ? (
        <EmptyState loading={loading} />
      ) : (
        <div className="overflow-x-auto">
          <Card className="min-w-[820px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="w-[220px]">Target</TableHead>
                  <TableHead className="w-[130px]">IP</TableHead>
                  <TableHead className="w-[110px]">Time</TableHead>
                  <TableHead className="w-[44px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <AuditRow key={e.id} entry={e} />
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex justify-center">
          {done ? (
            <p className="text-xs text-muted-foreground">
              End of log — {entries.length} entr
              {entries.length === 1 ? "y" : "ies"} shown.
            </p>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              isLoading={loading}
              onClick={() =>
                void load(false, applied, entries[entries.length - 1]?.id)
              }
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        size="sm"
        className="font-mono"
      />
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = React.useState(false);
  const hasMeta =
    (entry.metadata && Object.keys(entry.metadata).length > 0) ||
    Boolean(entry.user_agent);
  const detailId = `audit-detail-${entry.id}`;
  const label = `${open ? "Collapse" : "Expand"} details for ${humanizeAction(
    entry.action,
  )}`;

  return (
    <>
      <TableRow
        className={cn(hasMeta && "cursor-pointer")}
        onClick={hasMeta ? () => setOpen((v) => !v) : undefined}
      >
        <TableCell>
          <Badge variant={actionTone(entry.action)}>
            {humanizeAction(entry.action)}
          </Badge>
        </TableCell>
        <TableCell className="max-w-[220px] truncate">{entry.actor_email}</TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">
          <span className="text-foreground">{entry.target_type}</span>
          {entry.target_id ? ` · ${entry.target_id}` : ""}
        </TableCell>
        <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
          {entry.ip ?? "—"}
        </TableCell>
        <TableCell
          className="tabular-nums text-muted-foreground"
          title={formatDateTime(entry.created_at)}
        >
          {relativeTime(entry.created_at)}
        </TableCell>
        <TableCell className="text-right">
          {hasMeta && (
            <button
              type="button"
              // Row already toggles on click; stop the bubble so this
              // doesn't double-fire, and expose a real focusable control
              // so keyboard + AT users can operate the disclosure.
              onClick={(e) => {
                e.stopPropagation();
                setOpen((v) => !v);
              }}
              aria-expanded={open}
              aria-controls={detailId}
              aria-label={label}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  open && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          )}
        </TableCell>
      </TableRow>
      {open && hasMeta && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="bg-muted/30">
            <div id={detailId} className="space-y-2 py-1 text-xs">
              <div className="text-muted-foreground">
                {formatDateTime(entry.created_at)}
                {entry.user_agent ? ` · ${entry.user_agent}` : ""}
              </div>
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <pre className="overflow-x-auto rounded-md border border-border/60 bg-background p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <h3 className="text-lg font-semibold">
          {loading ? "Loading…" : "No entries"}
        </h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          {loading
            ? "Fetching the audit trail."
            : "No audit entries match these filters."}
        </p>
      </CardContent>
    </Card>
  );
}
