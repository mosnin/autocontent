"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, CodeBlock, ConfirmModal, EmptyLine, Facts, Field, Input, List, ListRow, Modal, Notice, SecretOnce, Section, Segmented, StatusBadge } from "@/design-system";
import { createTokenAction, revokeTokenAction } from "@/lib/actions";
import type { X402Config } from "@/lib/business";
import { formatRelative, formatUsd } from "@/lib/format";
import type { PersonalAccessToken } from "@/lib/types";

type Door = "mcp" | "sdk" | "cli" | "rest";

function snippets(base: string): Record<Door, { note: string; code: string }> {
  return {
    mcp: {
      note: "Install with pip install marketer-sh, then add this to Claude, Cursor or any MCP client.",
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
      note: "Bearer-auth with an access token.",
      code: `curl ${base}/api/v1/workspace/inbox \\
  -H "Authorization: Bearer $MARKETER_API_TOKEN"`,
    },
  };
}

/** How an agent reaches Marketer (MCP, SDK, CLI, REST), the tokens it uses, and x402. */
export function AgentAccess({ tokens, x402, apiBase }: { tokens: PersonalAccessToken[] | null; x402: X402Config | null; apiBase: string }) {
  const [door, setDoor] = useState<Door>("mcp");
  const s = snippets(apiBase)[door];
  return (
    <div className="space-y-10">
      <Section title="Agent access">
        <div className="space-y-3">
          <Segmented
            label="How your agent connects"
            value={door}
            onChange={setDoor}
            options={[
              { value: "mcp", label: "MCP" },
              { value: "sdk", label: "SDK" },
              { value: "cli", label: "CLI" },
              { value: "rest", label: "REST" },
            ]}
          />
          <p className="text-[13px] text-fg-muted">{s.note}</p>
          <CodeBlock code={s.code} />
        </div>
      </Section>
      <Tokens tokens={tokens} />
      <Section title="x402 payments">
        {x402 === null ? (
          <EmptyLine>Couldn't read the x402 config.</EmptyLine>
        ) : (
          <Facts
            items={[
              { label: "Status", value: <StatusBadge tone={x402.enabled ? "positive" : "neutral"}>{x402.enabled ? "On" : "Off"}</StatusBadge> },
              ...(x402.enabled
                ? [
                    { label: "Asset", value: `${x402.asset} on ${x402.network}` },
                    { label: "Top-up", value: `${formatUsd(x402.min_usd)} to ${formatUsd(x402.max_usd)}` },
                    { label: "Endpoint", value: <code className="font-mono text-[12px]">POST /api/v1/x402/credits</code> },
                  ]
                : [{ label: "Fallback", value: "Prepaid credit from Settings" }]),
            ]}
          />
        )}
      </Section>
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
    <Section
      title="Access tokens"
      action={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus /> New token
        </Button>
      }
    >
      <div className="space-y-3">
        {fresh && (
          <SecretOnce label="New token, shown once" value={fresh} onDismiss={() => setFresh(null)}>
            Put it in <code className="font-mono">MARKETER_API_TOKEN</code> now. It can do anything your account can, and we can't show it again.
          </SecretOnce>
        )}
        {tokens === null ? (
          <EmptyLine>Couldn't load your tokens.</EmptyLine>
        ) : tokens.length === 0 ? (
          <EmptyLine>No tokens yet. Make one per agent or job so you can revoke them one at a time.</EmptyLine>
        ) : (
          <List>
            {tokens.map((t) => (
              <ListRow key={t.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2 text-[13px]">
                    <span className="truncate font-medium">{t.name}</span>
                    <code className="hidden font-mono text-[12px] text-fg-faint sm:inline">{t.prefix}…</code>
                  </div>
                  <div className="truncate text-[12px] text-fg-muted">
                    {t.last_used_at ? `Used ${formatRelative(t.last_used_at)}` : "Never used"} · created {formatRelative(t.created_at)}
                    {t.expires_at ? ` · expires ${formatRelative(t.expires_at)}` : ""}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setRevoking(t)}>
                  Revoke
                </Button>
              </ListRow>
            ))}
          </List>
        )}
        <Notice error={error && !revoking ? error : null} />
      </div>
      <NewTokenModal open={open} onClose={() => setOpen(false)} onCreated={(tok) => (setFresh(tok), setOpen(false), router.refresh())} />
      <ConfirmModal open={revoking !== null} onClose={() => setRevoking(null)} title={`Revoke ${revoking?.name ?? "token"}?`} confirmLabel="Revoke" danger busy={busy} error={error} onConfirm={() => void revoke()}>
        <p>Anything using it stops working immediately. This can't be undone.</p>
      </ConfirmModal>
    </Section>
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
    <Modal
      open={open}
      onClose={onClose}
      title="New access token"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="new-token" variant="primary" loading={busy}>
            Create token
          </Button>
        </>
      }
    >
      <form id="new-token" onSubmit={submit} className="space-y-4">
        <Field label="Name" hint="Name it after what uses it.">
          <Input name="name" required placeholder="claude-desktop" autoComplete="off" />
        </Field>
        <Field label="Expires in days" hint="Optional. Leave blank for no expiry.">
          <Input name="expires_in_days" type="number" min={1} max={3650} />
        </Field>
        <p className="text-[12.5px] text-fg-muted">The token is shown once after you create it.</p>
        <Notice error={error} />
      </form>
    </Modal>
  );
}
