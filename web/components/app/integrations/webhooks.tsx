"use client";

import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, Chip, CodeBlock, ConfirmModal, EmptyLine, Field, IconButton, Input, List, ListRow, MenuButton, MenuItem, Modal, Notice, SecretOnce, Section, StatusBadge, Switch, Textarea, cx } from "@/design-system";
import { formatRelative } from "@/lib/format";
import { createWebhook, deleteWebhook, setWebhookEnabled, testWebhook, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS, type WebhookEndpoint, type WebhookEvent } from "@/lib/webhooks-client";

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^\d+\s*/, "") || "Request failed";
  return "Something went wrong";
}

const SIGNING = `# header: X-Marketer-Signature: t=<unix>,v1=<sig>
t, v1     = parse(header)
signed    = f"{t}.{raw_request_body}"
expected  = hmac_sha256(secret, signed)          # hex digest
valid     = constant_time_eq(expected, v1) \\
            and abs(now() - t) < 300             # reject replays`;

/** Outbound webhooks: signed events when work finishes, fails or needs approval. */
export function Webhooks({ endpoints }: { endpoints: WebhookEndpoint[] | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<WebhookEndpoint | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setDeleting(null);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onTest = async (ep: WebhookEndpoint) => {
    setBusy(`test-${ep.id}`);
    setNote(null);
    try {
      const r = await testWebhook(ep.id);
      setNote({ id: ep.id, ok: r.delivered, text: r.delivered && r.status_code != null ? `Test delivered, HTTP ${r.status_code}` : r.status_code != null ? `Test failed, HTTP ${r.status_code}` : "Test failed, no response" });
      router.refresh();
    } catch (e) {
      setNote({ id: ep.id, ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Webhooks"
      action={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus /> Add endpoint
        </Button>
      }
    >
      <div className="space-y-3">
        {created?.secret && (
          <SecretOnce label="Signing secret, shown once" value={created.secret} onDismiss={() => setCreated(null)}>
            For <code className="break-all font-mono">{created.url}</code>. Verify the <code className="font-mono">X-Marketer-Signature</code> header with it. We can't show it again.
          </SecretOnce>
        )}
        <Notice error={error} />
        {endpoints === null ? (
          <EmptyLine>Couldn't load your endpoints.</EmptyLine>
        ) : endpoints.length === 0 ? (
          <EmptyLine>No endpoints yet. Add an https URL and we'll POST signed events to it.</EmptyLine>
        ) : (
          <List>
            {endpoints.map((ep) => {
              const ok = ep.last_status != null && ep.last_status >= 200 && ep.last_status < 300;
              return (
                <ListRow key={ep.id} className="flex-wrap">
                  <div className={cx("min-w-0 flex-1 basis-[220px]", !ep.enabled && "opacity-60")}>
                    <div className="truncate font-mono text-[12.5px] text-fg">{ep.url}</div>
                    <div className="truncate text-[12px] text-fg-muted">
                      {ep.events.length === 0 ? "All events" : ep.events.map((e) => WEBHOOK_EVENT_LABELS[e as WebhookEvent] ?? e).join(", ")}
                      {ep.description ? ` · ${ep.description}` : ""}
                      {" · "}
                      {ep.enabled ? "" : "Paused · "}
                      {ep.last_delivery_at ? `last delivery ${formatRelative(ep.last_delivery_at)}` : "no deliveries yet"}
                    </div>
                    {note?.id === ep.id && <Notice ok={note.ok ? note.text : null} error={note.ok ? null : note.text} />}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {ep.last_status != null && <StatusBadge tone={ok ? "positive" : "negative"}>HTTP {ep.last_status}</StatusBadge>}
                    <Switch checked={ep.enabled} label={ep.enabled ? "Pause delivery" : "Resume delivery"} onChange={(v) => void run(`toggle-${ep.id}`, () => setWebhookEnabled(ep.id, v))} />
                    {/* Test and Delete are occasional: one "more" menu instead of two more buttons per row. */}
                    <MenuButton
                      align="right"
                      label={`Actions for ${ep.url}`}
                      trigger={() => (
                        <IconButton label={`More for ${ep.url}`} disabled={busy === `test-${ep.id}`}>
                          {busy === `test-${ep.id}` ? <Loader2 className="ds-spin" /> : <MoreHorizontal />}
                        </IconButton>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem disabled={busy !== null || !ep.enabled} onClick={() => (close(), void onTest(ep))}>
                            Send a test event
                          </MenuItem>
                          <MenuItem onClick={() => (close(), setDeleting(ep))}>Delete endpoint</MenuItem>
                        </>
                      )}
                    </MenuButton>
                  </div>
                </ListRow>
              );
            })}
          </List>
        )}
      </div>

      <div className="mt-6">
        <Section title="Verify signatures" collapsible>
          <CodeBlock code={SIGNING} />
        </Section>
      </div>

      <AddEndpointModal open={open} onClose={() => setOpen(false)} onCreated={(ep) => (setCreated(ep), setOpen(false), router.refresh())} />
      <ConfirmModal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete this endpoint?" confirmLabel="Delete endpoint" danger busy={busy === "delete"} onConfirm={() => deleting && void run("delete", () => deleteWebhook(deleting.id))}>
        <p>
          We'll stop delivering to <code className="break-all font-mono text-[12.5px] text-fg">{deleting?.url}</code>. Re-adding it creates a new secret.
        </p>
      </ConfirmModal>
    </Section>
  );
}

function AddEndpointModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (ep: WebhookEndpoint) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add webhook endpoint"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="add-endpoint" variant="primary" loading={busy}>
            Create endpoint
          </Button>
        </>
      }
    >
      {open && <AddEndpointForm onBusy={setBusy} onCreated={onCreated} />}
    </Modal>
  );
}

function AddEndpointForm({ onBusy, onCreated }: { onBusy: (b: boolean) => void; onCreated: (ep: WebhookEndpoint) => void }) {
  const [url, setUrl] = useState("");
  const [all, setAll] = useState(true);
  const [selected, setSelected] = useState<Set<WebhookEvent>>(new Set());
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = (ev: WebhookEvent) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ev)) next.delete(ev);
      else next.add(ev);
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = url.trim();
    let ok = false;
    try {
      ok = new URL(trimmed).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) return setError("Enter a valid https:// URL.");
    if (!all && selected.size === 0) return setError("Choose at least one event, or All events.");
    onBusy(true);
    try {
      onCreated(await createWebhook({ url: trimmed, events: all ? [] : [...selected], description: description.trim() }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      onBusy(false);
    }
  };

  return (
    <form id="add-endpoint" onSubmit={submit} className="space-y-4">
      <Field label="Endpoint URL" hint="Must be https.">
        <Input type="url" inputMode="url" required autoComplete="off" placeholder="https://api.example.com/hooks/marketer" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
      </Field>
      <div className="space-y-1.5">
        <span className="text-[12.5px] font-medium text-fg">Events</span>
        <div className="flex flex-wrap gap-1.5">
          <Chip selected={all} onClick={() => setAll(true)}>
            All events
          </Chip>
          <Chip selected={!all} onClick={() => setAll(false)}>
            Choose events
          </Chip>
        </div>
        {all ? (
          <p className="text-[12px] text-fg-muted">Every event type, including ones added later.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {WEBHOOK_EVENTS.map((ev) => (
              <Chip key={ev} selected={selected.has(ev)} onClick={() => toggle(ev)}>
                {WEBHOOK_EVENT_LABELS[ev]}
              </Chip>
            ))}
          </div>
        )}
      </div>
      <Field label="Description" hint="Optional.">
        <Textarea rows={2} placeholder="What consumes this endpoint?" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <p className="text-[12.5px] text-fg-muted">The signing secret is shown once after you create it.</p>
      <Notice error={error} />
    </form>
  );
}
