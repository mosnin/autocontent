"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink, cx, Field, List, Meter, Modal, Notice, Section, Select, StatusBadge, Textarea, Time, useAllowed, usePending } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import { type ArticleBatch, type BatchItem, parseKeywords } from "@/lib/seo";
import type { Niche } from "@/lib/types";

const MAX_KEYWORDS = 50;
const EST_PER_ARTICLE = 0.8;

/** Bulk generate: a keyword per line becomes one article each. One focused sheet. */
export function BulkGenerateModal({ open, onClose, niches }: { open: boolean; onClose: () => void; niches: Niche[] }) {
  const router = useRouter();
  const active = niches.filter((n) => !n.archived_at);
  const [nicheId, setNicheId] = useState(active[0]?.id ?? "");
  const [raw, setRaw] = useState("");
  const { busy, error, run } = usePending<"go">();
  const keywords = parseKeywords(raw);
  const over = keywords.length > MAX_KEYWORDS;
  const niche = active.find((n) => n.id === nicheId);
  const cap = niche?.daily_spend_cap_usd != null ? Number(niche.daily_spend_cap_usd) : null;
  const perDay = cap != null && cap > 0 ? Math.max(1, Math.floor(cap / EST_PER_ARTICLE)) : null;

  const go = () =>
    run("go", async () => {
      await proxyFetch<ArticleBatch>("/api/v1/article-batches", "POST", { niche_id: nicheId, keywords });
      setRaw("");
      router.refresh();
      onClose();
    });

  if (active.length === 0)
    return (
      <Modal open={open} onClose={onClose} title="Bulk generate" footer={<ButtonLink href="/playbooks/new" variant="primary">Create a playbook</ButtonLink>}>
        <p className="text-[13px] text-fg-muted">Articles are written from a playbook: its audience, voice and spend cap.</p>
      </Modal>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk generate"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bulk-generate" variant="primary" loading={busy === "go"} disabled={keywords.length === 0 || over || !nicheId}>
            {keywords.length > 1 ? `Write ${keywords.length} articles` : "Write article"}
          </Button>
        </>
      }
    >
      <form
        id="bulk-generate"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Field label="Playbook">
          <Select value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
            {active.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Keywords"
          hint={
            <span className="flex justify-between gap-2">
              <span>One per line. Each becomes a researched article.</span>
              <span className={cx("tabular", over ? "text-negative" : "text-fg-faint")}>
                {keywords.length}/{MAX_KEYWORDS}
              </span>
            </span>
          }
        >
          <Textarea rows={7} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"best flour for fresh pasta\nhow to store fresh pasta\npasta machine vs rolling pin"} autoFocus />
        </Field>
        {keywords.length > 0 && (
          <p className="ds-enter text-[12.5px] text-fg-muted">
            About ${(keywords.length * EST_PER_ARTICLE).toFixed(2)} in total.
            {perDay != null && keywords.length > perDay ? ` This playbook's cap fits about ${perDay} a day; the rest wait and start as the cap allows.` : " Two are written at a time."}
          </p>
        )}
        <Notice error={error} />
      </form>
    </Modal>
  );
}

const ITEM_TONE: Record<BatchItem["status"], "neutral" | "positive" | "negative" | "accent"> = { queued: "neutral", running: "accent", done: "positive", failed: "negative", cancelled: "neutral" };
const ITEM_LABEL: Record<BatchItem["status"], string> = { queued: "Waiting", running: "Writing", done: "Ready", failed: "Failed", cancelled: "Cancelled" };

function BatchRow({ batch, niche, preview }: { batch: ArticleBatch; niche?: string; preview?: boolean }) {
  const router = useRouter();
  const canCancel = useAllowed("content:update");
  const [open, setOpen] = useState(batch.status !== "done" && batch.status !== "cancelled");
  const { busy, error, run } = usePending<"cancel">();
  const done = batch.items.filter((i) => i.status === "done" || i.status === "failed" || i.status === "cancelled").length;
  const held = batch.status === "paused_cap";
  const openBatch = batch.status === "running" || held;
  const cancel = () =>
    run("cancel", async () => {
      await proxyFetch(`/api/v1/article-batches/${batch.id}/cancel`, "POST");
      router.refresh();
    });
  return (
    <div className="px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="block text-[13px] font-medium">
            {batch.total} keyword{batch.total === 1 ? "" : "s"}
            {niche ? <span className="font-normal text-fg-muted"> · {niche}</span> : null}
          </span>
          <span className="block text-[12px] text-fg-muted">
            {held ? "Waiting for today's spend cap" : batch.status === "done" ? "Finished" : batch.status === "cancelled" ? "Cancelled" : `${done} of ${batch.total} done`} · <Time iso={batch.created_at} />
          </span>
        </button>
        {held && <StatusBadge tone="attention">Paused at cap</StatusBadge>}
        {openBatch && canCancel && !preview && (
          <Button size="sm" variant="ghost" onClick={() => void cancel()} loading={busy === "cancel"}>
            Stop
          </Button>
        )}
      </div>
      {openBatch && (
        <div className="mt-2">
          <Meter value={(done / Math.max(1, batch.total)) * 100} tone={held ? "attention" : "accent"} label="Batch progress" />
        </div>
      )}
      {open && (
        <ul className="ds-enter mt-2.5 space-y-1">
          {batch.items.map((i) => (
            <li key={i.id} className="flex min-h-7 items-center gap-2 text-[12.5px]">
              <span className="w-5 shrink-0 text-right text-fg-faint tabular">{i.position}</span>
              {i.article_id ? (
                <Link href={`/seo/${i.article_id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {i.keyword}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-fg-muted">{i.keyword}</span>
              )}
              <StatusBadge tone={ITEM_TONE[i.status]}>{i.status === "queued" && i.held_reason === "spend_cap" ? "At cap" : ITEM_LABEL[i.status]}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
      <Notice error={error} />
    </div>
  );
}

/** Recent bulk batches, shown only when there are some. */
export function Batches({ batches, niches, preview }: { batches: ArticleBatch[] | null; niches: Niche[]; preview?: boolean }) {
  if (!batches || batches.length === 0) return null;
  const titles = new Map(niches.map((n) => [n.id, n.title]));
  return (
    <Section title="Bulk batches">
      <List>
        {batches.slice(0, 5).map((b) => (
          <BatchRow key={b.id} batch={b} niche={titles.get(b.niche_id)} preview={preview} />
        ))}
      </List>
    </Section>
  );
}
