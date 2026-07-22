"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
// `isLoading` (the inline spinner) is an app-Button-only feature — Spinner
// has no square/ui counterpart (established precedent: dialog/label/
// textarea/select-in-forms/tabs/spinner/switch stay on app primitives).
// Call sites that rely on isLoading keep the app Button under this alias;
// every other button in this file uses the square/ui default above.
import { Button as LoadingButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import { Checkbox } from "@/components/square/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/square/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOKS_KEY,
  createWebhook,
  deleteWebhook,
  setWebhookEnabled,
  testWebhook,
  webhooksFetcher,
  type WebhookEndpoint,
  type WebhookEvent,
} from "@/lib/webhooks-client";

// --- helpers -----------------------------------------------------------

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Copy failed");
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    // Backend error bodies are usually short JSON/text; surface them verbatim.
    return e.message.replace(/^\d+\s*/, "") || `Request failed (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === "second") {
      return RELATIVE.format(Math.round(diffSec / secs), unit);
    }
  }
  return "";
}

// Square/ui Badge has no "success" variant, so status tone is expressed the
// same way the template's own status badges are (QueueClient / ArticlesClient
// StatusBadge): variant="outline" plus a tonal bg/text/border class.
const SUCCESS_BADGE_CLASS =
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900";
const DESTRUCTIVE_BADGE_CLASS =
  "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900";

/** Warm-ok for 2xx, destructive otherwise. */
function statusToneClass(status: number): string {
  return status >= 200 && status < 300
    ? SUCCESS_BADGE_CLASS
    : DESTRUCTIVE_BADGE_CLASS;
}

// --- signing helper card ----------------------------------------------

function SigningHelp() {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardContent className="space-y-3 pt-6 text-sm">
        <div className="font-medium">Verifying the signature</div>
        <p className="text-muted-foreground">
          Every delivery carries an{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            X-Marketer-Signature
          </code>{" "}
          header. Recompute the HMAC over the raw request body and compare in
          constant time — reject if it doesn&apos;t match or the timestamp is
          stale.
        </p>
        <pre className="overflow-x-auto rounded-md border bg-background p-3 text-xs leading-relaxed">
          <code>{`# header: X-Marketer-Signature: t=<unix>,v1=<sig>
t, v1     = parse(header)
signed    = f"{t}.{raw_request_body}"
expected  = hmac_sha256(secret, signed)          # hex digest
valid     = constant_time_eq(expected, v1) \\
            and abs(now() - t) < 300             # reject replays`}</code>
        </pre>
      </CardContent>
    </Card>
  );
}

// --- one-time secret reveal -------------------------------------------

function SecretReveal({
  endpoint,
  onDismiss,
}: {
  endpoint: WebhookEndpoint;
  onDismiss: () => void;
}) {
  const secret = endpoint.secret ?? "";
  return (
    <Card className="border-success/40 bg-success/5">
      <CardContent className="space-y-3 pt-6">
        <div className="text-sm font-medium">Signing secret — shown once</div>
        <p className="text-xs text-muted-foreground">
          Endpoint{" "}
          <code className="rounded bg-muted px-1 py-0.5">{endpoint.url}</code>{" "}
          was created. Store this secret now.
        </p>
        <div className="flex items-center gap-2 rounded-md border bg-background p-2">
          <code className="flex-1 overflow-x-auto font-mono text-xs">
            {secret}
          </code>
          <Button size="sm" variant="ghost" onClick={() => copy(secret)}>
            Copy
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          We don&apos;t store the plaintext and can&apos;t show it again. Use it
          to verify the{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            X-Marketer-Signature
          </code>{" "}
          header:
        </p>
        <pre className="overflow-x-auto rounded-md border bg-background p-3 text-xs leading-relaxed">
          <code>{`X-Marketer-Signature: t=<unix>,v1=<hmac_sha256(secret, "<t>.<rawbody>")>`}</code>
        </pre>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onDismiss}>
            I&apos;ve stored it
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- add-endpoint dialog ----------------------------------------------

function AddEndpointDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (created: WebhookEndpoint) => void;
}) {
  const [url, setUrl] = React.useState("");
  const [allEvents, setAllEvents] = React.useState(true);
  const [selected, setSelected] = React.useState<Set<WebhookEvent>>(new Set());
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form each time the dialog opens.
  React.useEffect(() => {
    if (open) {
      setUrl("");
      setAllEvents(true);
      setSelected(new Set());
      setDescription("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  function toggleEvent(ev: WebhookEvent) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ev)) next.delete(ev);
      else next.add(ev);
      return next;
    });
  }

  function isValidHttps(value: string): boolean {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (!isValidHttps(trimmed)) {
      setError("Enter a valid https:// URL.");
      return;
    }
    if (!allEvents && selected.size === 0) {
      setError("Choose at least one event, or select “All events”.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createWebhook({
        url: trimmed,
        events: allEvents ? [] : [...selected],
        description: description.trim(),
      });
      onCreated(created);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>Add endpoint</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add webhook endpoint</DialogTitle>
          <DialogDescription>
            We&apos;ll POST signed events here. The signing secret is shown once
            after creation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wh-url">Endpoint URL</Label>
            <Input
              id="wh-url"
              name="url"
              type="url"
              inputMode="url"
              required
              autoComplete="off"
              placeholder="https://api.example.com/hooks/marketer"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-describedby="wh-url-hint"
            />
            <p id="wh-url-hint" className="text-xs text-muted-foreground">
              Must be https. We reject plaintext http endpoints.
            </p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Events</legend>
            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                allEvents
                  ? "border-brand/50 bg-brand/5"
                  : "border-input hover:border-brand/30",
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={allEvents}
                onCheckedChange={(checked) => setAllEvents(checked === true)}
                aria-label="Subscribe to all events"
              />
              <span>
                <span className="block text-sm font-medium">All events</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Receive every event type, including ones added later.
                </span>
              </span>
            </label>

            {!allEvents && (
              <div
                className="grid gap-2 sm:grid-cols-2"
                role="group"
                aria-label="Specific events"
              >
                {WEBHOOK_EVENTS.map((ev) => {
                  const on = selected.has(ev);
                  return (
                    <label
                      key={ev}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 text-sm transition-colors",
                        on
                          ? "border-brand/50 bg-brand/5"
                          : "border-input hover:border-brand/30",
                      )}
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={() => toggleEvent(ev)}
                        aria-label={WEBHOOK_EVENT_LABELS[ev]}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium leading-none">
                          {WEBHOOK_EVENT_LABELS[ev]}
                        </span>
                        <code className="mt-1 block truncate text-xs text-muted-foreground">
                          {ev}
                        </code>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="wh-desc">Description (optional)</Label>
            <Textarea
              id="wh-desc"
              name="description"
              placeholder="What consumes this endpoint?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <LoadingButton type="submit" disabled={submitting} isLoading={submitting}>
              Create endpoint
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- delete confirm dialog --------------------------------------------

function DeleteDialog({
  target,
  onOpenChange,
  onConfirmed,
}: {
  target: WebhookEndpoint | null;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => void;
}) {
  const [deleting, setDeleting] = React.useState(false);

  async function onConfirm() {
    if (!target) return;
    setDeleting(true);
    try {
      await deleteWebhook(target.id);
      toast.success("Endpoint deleted");
      onConfirmed();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this endpoint?</DialogTitle>
          <DialogDescription>
            We&apos;ll stop delivering events to{" "}
            <code className="break-all rounded bg-muted px-1 py-0.5 text-xs">
              {target?.url}
            </code>
            . This can&apos;t be undone — you&apos;ll need to re-add it (with a
            new secret) to resume delivery.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <LoadingButton
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={deleting}
            isLoading={deleting}
          >
            Delete endpoint
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- endpoint card -----------------------------------------------------

function EndpointCard({
  endpoint,
  onDelete,
  onTested,
  onChanged,
}: {
  endpoint: WebhookEndpoint;
  onDelete: (e: WebhookEndpoint) => void;
  onTested: () => void;
  onChanged: () => void;
}) {
  const [testing, setTesting] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);

  async function onTest() {
    setTesting(true);
    try {
      const res = await testWebhook(endpoint.id);
      if (res.delivered && res.status_code != null) {
        toast.success(`Test delivered — HTTP ${res.status_code}`);
      } else if (res.status_code != null) {
        toast.error(`Test failed — HTTP ${res.status_code}`);
      } else {
        toast.error("Test failed — no response");
      }
      onTested();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  async function onToggle() {
    setToggling(true);
    try {
      await setWebhookEnabled(endpoint.id, !endpoint.enabled);
      toast.success(endpoint.enabled ? "Delivery paused" : "Delivery resumed");
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setToggling(false);
    }
  }

  return (
    <Card className={cn("p-4", !endpoint.enabled && "border-dashed bg-muted/30")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <code
              className={cn(
                "max-w-full truncate font-mono text-sm font-medium",
                !endpoint.enabled && "text-muted-foreground",
              )}
              title={endpoint.url}
            >
              {endpoint.url}
            </code>
            <Badge
              variant="outline"
              className={endpoint.enabled ? SUCCESS_BADGE_CLASS : ""}
            >
              {endpoint.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>

          {endpoint.description && (
            <p className="text-sm text-muted-foreground">
              {endpoint.description}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {endpoint.events.length === 0 ? (
              <Badge variant="outline">All events</Badge>
            ) : (
              endpoint.events.map((ev) => (
                <Badge key={ev} variant="outline" className="font-mono">
                  {ev}
                </Badge>
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Last delivery:</span>
            {endpoint.last_status != null ? (
              <Badge
                variant="outline"
                className={cn("font-mono", statusToneClass(endpoint.last_status))}
              >
                HTTP {endpoint.last_status}
              </Badge>
            ) : (
              <span>none yet</span>
            )}
            {endpoint.last_delivery_at && (
              <span title={new Date(endpoint.last_delivery_at).toLocaleString()}>
                {formatRelative(endpoint.last_delivery_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <LoadingButton
            size="sm"
            variant="outline"
            onClick={onToggle}
            disabled={toggling}
            isLoading={toggling}
            aria-label={
              endpoint.enabled
                ? `Pause delivery to ${endpoint.url}`
                : `Resume delivery to ${endpoint.url}`
            }
          >
            {endpoint.enabled ? "Pause" : "Resume"}
          </LoadingButton>
          <LoadingButton
            size="sm"
            variant="outline"
            onClick={onTest}
            disabled={testing || !endpoint.enabled}
            isLoading={testing}
            aria-label={`Send a test delivery to ${endpoint.url}`}
            title={
              endpoint.enabled ? undefined : "Resume the endpoint to send a test"
            }
          >
            Send test
          </LoadingButton>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(endpoint)}
            aria-label={`Delete endpoint ${endpoint.url}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

// --- root --------------------------------------------------------------

export function WebhooksClient({ initial }: { initial: WebhookEndpoint[] }) {
  const { data, error, isLoading, mutate } = useSWR<WebhookEndpoint[]>(
    WEBHOOKS_KEY,
    webhooksFetcher,
    { fallbackData: initial, revalidateOnFocus: false },
  );

  const [addOpen, setAddOpen] = React.useState(false);
  const [freshEndpoint, setFreshEndpoint] = React.useState<WebhookEndpoint | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = React.useState<WebhookEndpoint | null>(
    null,
  );

  const endpoints = data ?? [];

  function handleCreated(created: WebhookEndpoint) {
    setAddOpen(false);
    setFreshEndpoint(created);
    toast.success("Webhook endpoint created");
    void mutate();
  }

  function handleDeleted() {
    setDeleteTarget(null);
    void mutate();
  }

  // Error only matters if we have nothing to show (fallbackData failed to
  // revalidate but was seeded server-side, so this is genuinely empty).
  const showError = error && endpoints.length === 0 && !isLoading;

  return (
    <div className="space-y-6">
      {freshEndpoint && (
        <SecretReveal
          endpoint={freshEndpoint}
          onDismiss={() => setFreshEndpoint(null)}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Endpoints</h2>
        <AddEndpointDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onCreated={handleCreated}
        />
      </div>

      {showError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <h3 className="text-lg font-semibold">Couldn&apos;t load webhooks</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {errorMessage(error)}
            </p>
            <Button variant="outline" onClick={() => void mutate()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : endpoints.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <h3 className="text-lg font-semibold">No webhooks yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Register an HTTPS endpoint to get signed, real-time events when
              jobs and articles finish, fail, or need approval — so agents and
              automation can react without polling.
            </p>
            <Button onClick={() => setAddOpen(true)}>
              Add your first endpoint
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {endpoints.map((ep) => (
            <EndpointCard
              key={ep.id}
              endpoint={ep}
              onDelete={setDeleteTarget}
              onTested={() => void mutate()}
              onChanged={() => void mutate()}
            />
          ))}
        </div>
      )}

      <SigningHelp />

      <DeleteDialog
        target={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirmed={handleDeleted}
      />
    </div>
  );
}
