"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, EmptyLine, Field, Input, Modal, MoneyInput, Notice, StatusBadge, Table, Textarea, type StatusTone } from "@/design-system";
import { formatDate, formatUsd } from "@/lib/format";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { Campaign } from "@/lib/types";

const STATUS: Record<Campaign["status"], { label: string; tone: StatusTone }> = {
  running: { label: "Running", tone: "positive" },
  paused: { label: "Paused", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  completed: { label: "Completed", tone: "neutral" },
};

export function CampaignStatus({ status }: { status: Campaign["status"] }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

/** "New campaign" button that opens the create modal. */
export function NewCampaignButton({ hasPlaybooks, variant = "ghost" }: { hasPlaybooks: boolean; variant?: "ghost" | "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <Plus /> New campaign
      </Button>
      <NewCampaignModal open={open} onClose={() => setOpen(false)} hasPlaybooks={hasPlaybooks} />
    </>
  );
}

/** Cross-department campaigns: content, SEO and ads in one push against a budget and a window. */
export function CampaignsTable({ campaigns, hasPlaybooks }: { campaigns: Campaign[]; hasPlaybooks: boolean }) {
  return (
    <Table
      rows={campaigns}
      rowKey={(c) => c.id}
      rowHref={(c) => `/distribution/campaigns/${c.id}`}
      empty={<EmptyLine action={<NewCampaignButton hasPlaybooks={hasPlaybooks} variant="secondary" />}>No campaigns yet. Set a budget and a window, then add lanes.</EmptyLine>}
      columns={[
        {
          key: "name",
          label: "Campaign",
          render: (c) => (
            <span className="block min-w-0">
              <span className="block truncate">{c.name}</span>
              <span className="block truncate text-[12px] text-fg-muted">{c.objective || "No objective"}</span>
            </span>
          ),
        },
        { key: "budget", label: "Credit budget", align: "right", hideOnPhone: true, render: (c) => formatUsd(c.budget_usd, { cents: false }) },
        { key: "ends", label: "Ends", align: "right", hideOnPhone: true, render: (c) => <span className="text-fg-muted">{c.ends_at ? formatDate(c.ends_at) : "No end date"}</span> },
        { key: "status", label: "Status", align: "right", width: "100px", render: (c) => <CampaignStatus status={c.status} /> },
      ]}
    />
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
    <Modal
      open={open}
      onClose={onClose}
      title="New campaign"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="new-dist-campaign" variant="primary" loading={busy}>
            Create campaign
          </Button>
        </>
      }
    >
      <form
        id="new-dist-campaign"
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
        <p className="text-[12px] text-fg-muted">Ad spend stays under Paid media's caps and approvals, not this budget.</p>
        {!hasPlaybooks && <p className="text-[12px] text-fg-muted">Create a playbook first. Video and article lanes pull from your playbooks.</p>}
        <Notice error={error} />
      </form>
    </Modal>
  );
}
