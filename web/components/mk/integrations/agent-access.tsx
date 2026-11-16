"use client";

import { Bot, KeyRound, Plus, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { createTokenAction, revokeTokenAction } from "@/lib/actions";
import type { X402Config } from "@/lib/business";
import { formatRelative, formatUsd } from "@/lib/format";
import type { PersonalAccessToken } from "@/lib/types";
import { Badge, Button, ErrorText, Field, IconTile, Input, Modal, Segmented } from "../ui";
import { CodeBlock, ConfirmModal, SecretOnce } from "../settings/primitives";

type Door = "mcp" | "sdk" | "cli" | "rest";

function snippets(base: string): Record<Door, { note: string; code: string }> {
  return {
    mcp: {
      note: "Add Marketer to Claude, Cursor or any MCP client. Install with pip install marketer-sh, then:",
      code: `{
  "mcpServers": {
    "marketer": {
      "command": "marketer-mcp",
      "env": {
        "MARKETER_API_BASE_URL": "${base}",
        "MARKETER_API_TOKEN": "mkt_…"
      }
    }
  }
}`,
    },
    sdk: {
      note: "The Python SDK covers playbooks, videos, articles, ads, the inbox and x402.",
      code: `from marketer.sdk import MarketerClient

# reads MARKETER_API_BASE_URL and MARKETER_API_TOKEN
async with MarketerClient() as m:
    inbox = await m.workspace_inbox()
    ads = await m.ads_overview()
    await m.decide_inbox_item("ad_change", inbox["items"][0]["ref_id"], "approve")`,
    },
    cli: {
      note: "The same surface from a terminal or a cron job.",
      code: `pip install marketer-sh
export MARKETER_API_BASE_URL=${base}
export MARKETER_API_TOKEN=mkt_…

marketer jobs list
marketer articles generate --help
marketer spend today`,
    },
    rest: {
      note: "Every page in this app is an endpoint first. Bearer-auth with a token.",
      code: `curl ${base}/api/v1/workspace/inbox \\
  -H "Authorization: Bearer $MARKETER_API_TOKEN"`,
    },
  };
}

/**
 * The agent-facing door: how an AI agent reaches Marketer (MCP, SDK, CLI,
 * REST), the tokens it authenticates with, and x402 for paying its own way.
 */
export function AgentAccess({ tokens, x402, apiBase }: { tokens: PersonalAccessToken[] | null; x402: X402Config | null; apiBase: string }) {
  const [door, setDoor] = useState<Door>("mcp");
  const s = snippets(apiBase)[door];
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Segmented
          label="How your agent connects"
          value={door}
          onChange={setDoor}
          className="w-full sm:w-[320px]"
          options={[
            { value: "mcp", label: "MCP" },
            { value: "sdk", label: "SDK" },
            { value: "cli", label: "CLI" },
            { value: "rest", label: "REST" },
          ]}
        />
        <p className="text-[13px] text-muted-foreground">{s.note}</p>
        <CodeBlock code={s.code} />
      </div>
      <Tokens tokens={tokens} />
      <X402Row config={x402} />
    </div>
  );
}

function Tokens({ tokens }: { tokens: PersonalAccessToken[] | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<PersonalAccessToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("token_id", revoking.id);
    const res = await revokeTokenAction({ ok: false }, fd);
    setBusy(false);
    if (res.ok) {
      setRevoking(null);
      router.refresh();
    } else setError(res.error ?? "Revoke failed");
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <KeyRound className="size-[14px]" /> Access tokens
        </span>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus /> New token
        </Button>
      </div>
      {fresh && (
        <SecretOnce label="New token, shown once" value={fresh} onDismiss={() => setFresh(null)}>
          Put it in <code className="font-mono">MARKETER_API_TOKEN</code> now. We don't store the plaintext and can't show it again. Treat it like a password: it can do anything your account can.
        </SecretOnce>
      )}
      {tokens === null ? (
        <p className="rounded-[14px] bg-subtle px-4 py-4 text-[13px] text-muted-foreground">We couldn't load your tokens right now.</p>
      ) : tokens.length === 0 ? (
        <p className="rounded-[14px] bg-subtle px-4 py-4 text-[13px] text-muted-foreground">No tokens yet. Create one for each agent, laptop or job so you can revoke them one at a time.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
          {tokens.map((t) => (
            <div key={t.id} className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <IconTile>
                <KeyRound />
              </IconTile>
              <div className="min-w-0 flex-1 basis-[160px]">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{t.name}</span>
                  <code className="font-mono text-[12px] text-muted-foreground">{t.prefix}…</code>
                </div>
                <div className="truncate text-[13px] text-muted-foreground">
                  {t.last_used_at ? `Used ${formatRelative(t.last_used_at)}` : "Never used"} · created {formatRelative(t.created_at)}
                  {t.expires_at ? ` · expires ${formatRelative(t.expires_at)}` : ""}
                </div>
              </div>
              <Button size="sm" variant="ghost" className="ml-auto hover:text-destructive" onClick={() => setRevoking(t)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
      <ErrorText error={error && !revoking ? error : null} />
      <NewTokenModal open={open} onClose={() => setOpen(false)} onCreated={(tok) => (setFresh(tok), setOpen(false), router.refresh())} />
      <ConfirmModal open={revoking !== null} onClose={() => setRevoking(null)} title={`Revoke ${revoking?.name ?? "token"}?`} confirmLabel="Revoke" danger busy={busy} error={error} onConfirm={() => void revoke()}>
        <p>Anything using it stops working immediately. This can't be undone.</p>
      </ConfirmModal>
    </div>
  );
}

function NewTokenModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (token: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // The plaintext lives only in component state, never in the URL.
    const res = await createTokenAction({ ok: false }, new FormData(e.currentTarget));
    setBusy(false);
    if (res.ok && res.token) onCreated(res.token);
    else setError(res.error ?? "Couldn't create the token");
  };
  return (
    <Modal open={open} onClose={onClose} title="New access token">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" hint="Name it after what uses it.">
          <Input name="name" required placeholder="claude-desktop" autoComplete="off" />
        </Field>
        <Field label="Expires in days (optional)">
          <Input name="expires_in_days" type="number" min={1} max={3650} placeholder="Leave blank for no expiry" />
        </Field>
        <p className="text-[12.5px] text-muted-foreground">The token is shown once after you create it.</p>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create token
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function X402Row({ config }: { config: X402Config | null }) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-[14px] bg-subtle px-4 py-3 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
      <IconTile tone={config?.enabled ? "live" : "muted"}>
        <Wallet />
      </IconTile>
      <div className="min-w-0 flex-1 basis-[220px]">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium">x402 agent payments</span>
          <Badge tone={config?.enabled ? "live" : "muted"}>{config === null ? "Unknown" : config.enabled ? "On" : "Off"}</Badge>
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {config?.enabled ? (
            <>
              Agents fund their own credit over HTTP 402: {config.asset} on {config.network}, {formatUsd(config.min_usd)} to {formatUsd(config.max_usd)} per top-up. They call <code className="font-mono text-[12px]">POST /api/v1/x402/credits</code> and pay the envelope it returns.
            </>
          ) : config ? (
            "Off on this deployment. Agents can still use prepaid credit you add in Settings."
          ) : (
            "We couldn't read the x402 config right now."
          )}
        </p>
      </div>
    </div>
  );
}

export function AgentsHeader() {
  return (
    <div className="flex items-start gap-3">
      <IconTile size={40} tone="live">
        <Bot />
      </IconTile>
      <div className="min-w-0">
        <h3 className="text-[15px] font-medium">For AI agents</h3>
        <p className="mt-0.5 max-w-[60ch] text-[13px] text-muted-foreground">An agent is a first-class user here. It gets the same tools, budgets and approvals you do, and anything that spends or publishes still waits in your inbox.</p>
      </div>
    </div>
  );
}
