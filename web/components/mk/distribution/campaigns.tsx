"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDate, formatUsd } from "@/lib/format";
import type { Campaign } from "@/lib/types";
import { Badge, Button, Empty, ErrorText, Field, IconTile, Input, Modal, Textarea, type Tone } from "../ui";
import { MoneyInput, proxyFetch } from "../settings/primitives";

const STATUS: Record<Campaign["status"], { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "live" },
  paused: { label: "Paused", tone: "muted" },
  draft: { label: "Draft", tone: "muted" },
  completed: { label: "Completed", tone: "muted" },
};

export function CampaignStatus({ status }: { status: Campaign["status"] }) {
  const s = STATUS[status] ?? { label: status, tone: "muted" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Cross-department campaigns: content, SEO and ads in one push against a budget and a window. */
export function CampaignsSection({ campaigns, hasPlaybooks }: { campaigns: Campaign[]; hasPlaybooks: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {campaigns.length === 0 ? (
        <Empty art="meetings" title="No campaigns yet" action={<Button variant="primary" onClick={() => setOpen(true)}>New campaign</Button>}>
          Set a budget and a window, then add lanes for videos, articles and ads. Marketer keeps them moving together.
        </Empty>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
          {campaigns.map((c) => (
            <Link key={c.id} href={`/distribution/campaigns/${c.id}`} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/50">
              <IconTile tone={c.status === "running" ? "live" : "muted"}>
                <span className="text-[13px] font-medium">{c.name.slice(0, 1).toUpperCase()}</span>
              </IconTile>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{c.name}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{c.objective || "No objective"}</span>
              </span>
              <span className="hidden shrink-0 text-right text-[13px] sm:block">
                <span className="block tabular">{formatUsd(c.budget_usd, { cents: false })} budget</span>
                <span className="block text-faint">{c.ends_at ? `ends ${formatDate(c.ends_at)}` : "no end date"}</span>
              </span>
              <CampaignStatus status={c.status} />
            </Link>
          ))}
          <button type="button" onClick={() => setOpen(true)} className="flex min-h-[44px] w-full items-center gap-2 px-4 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
            <Plus className="size-4" /> New campaign
          </button>
        </div>
      )}
      <NewCampaignModal open={open} onClose={() => setOpen(false)} hasPlaybooks={hasPlaybooks} />
    </>
  );
}

function NewCampaignModal({ open, onClose, hasPlaybooks }: { open: boolean; onClose: () => void; hasPlaybooks: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("50");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) {
      setError("Name the campaign.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await proxyFetch<Campaign>("/api/v1/campaigns", "POST", {
        name: name.trim(),
        objective,
        budget_usd: budget || "50",
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      });
      router.push(`/distribution/campaigns/${c.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New campaign">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 product launch" autoFocus />
        </Field>
        <Field label="Objective (optional)">
          <Textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Drive signups for the summer launch" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Credit budget" hint="Caps generation credits for videos and articles.">
            <MoneyInput min="1" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Field label="Ends (optional)">
            <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        </div>
        <p className="text-[12.5px] text-muted-foreground">Ad spend stays governed by Paid media's guardrails, not this budget.</p>
        {!hasPlaybooks && <p className="text-[12.5px] text-muted-foreground">Tip: create a playbook first. Video and article lanes pull from your playbooks.</p>}
        <ErrorText error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create campaign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
