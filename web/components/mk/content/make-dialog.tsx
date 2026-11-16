"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { enqueueJobAction } from "@/lib/actions";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd } from "@/lib/format";
import type { Niche, Platform, TodaySpend } from "@/lib/types";
import { Button, ButtonLink, Chip, Field, Input, Modal, Segmented, Select } from "../ui";
import { Note, postProxy } from "./bits";
import { platformLabel } from "./status";

export type MakeKind = "video" | "carousel";

/**
 * "Make something": start a video for a playbook on one platform (with the
 * cost estimate against today's cap, like the old run confirm), or a
 * carousel / still image. Used on Content and on every playbook.
 */
export function MakeDialog({
  open,
  onClose,
  niches,
  spend,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  niches: Niche[];
  spend: TodaySpend | null;
  initial?: { kind?: MakeKind; nicheId?: string; platform?: Platform; lockKind?: boolean };
}) {
  const router = useRouter();
  const active = niches.filter((n) => !n.archived_at);
  const [kind, setKind] = useState<MakeKind>(initial?.kind ?? "video");
  const [nicheId, setNicheId] = useState(initial?.nicheId ?? active[0]?.id ?? "");
  const niche = active.find((n) => n.id === nicheId);
  const [platform, setPlatform] = useState<Platform | null>(initial?.platform ?? niche?.platforms[0] ?? null);
  const [postKind, setPostKind] = useState<"carousel" | "single">("carousel");
  const [topic, setTopic] = useState("");
  const [slides, setSlides] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(initial?.kind ?? "video");
    const id = initial?.nicheId ?? active[0]?.id ?? "";
    setNicheId(id);
    setPlatform(initial?.platform ?? active.find((n) => n.id === id)?.platforms[0] ?? null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickNiche = (id: string) => {
    setNicheId(id);
    const n = active.find((x) => x.id === id);
    if (n && (!platform || !n.platforms.includes(platform))) setPlatform(n.platforms[0] ?? null);
  };

  const est = niche ? estimateVideoCostUsd(niche) : null;
  const spent = niche && spend ? Number(spend.by_niche[niche.id] ?? 0) : 0;
  const cap = niche ? Number(niche.daily_spend_cap_usd) : 0;
  const left = Math.max(0, cap - spent);
  const over = est && cap > 0 && est.total > left;

  const submit = async () => {
    if (!niche) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "video") {
        if (!platform) throw new Error("Pick a platform.");
        const fd = new FormData();
        fd.set("niche_id", niche.id);
        fd.set("platform", platform);
        const res = await enqueueJobAction({ ok: false }, fd);
        if (!res.ok) throw new Error(res.error ?? "Couldn't start the video.");
      } else {
        await postProxy("/api/v1/image-posts", { niche_id: niche.id, kind: postKind, topic: topic.trim(), slide_count: postKind === "single" ? 1 : slides });
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={kind === "video" ? (niche ? `Make a video for ${niche.title}` : "Make a video") : "Make a carousel"}>
      {active.length === 0 ? (
        <div className="space-y-4">
          <p className="text-[14px] text-muted-foreground">Everything Marketer makes starts from a playbook: who it's for, how it sounds, where it posts.</p>
          <ButtonLink href="/playbooks/new" variant="primary">Create a playbook</ButtonLink>
        </div>
      ) : (
        <div className="space-y-5">
          {!initial?.lockKind && (
            <Segmented value={kind} onChange={setKind} label="What to make" options={[{ value: "video", label: "Video" }, { value: "carousel", label: "Carousel" }]} className="w-full" />
          )}
          <Field label="Playbook">
            <Select value={nicheId} onChange={(e) => pickNiche(e.target.value)}>
              {active.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </Select>
          </Field>

          {kind === "video" ? (
            <>
              <div className="space-y-1.5">
                <span className="text-[13px] font-medium">Platform</span>
                <div className="flex flex-wrap gap-1.5">
                  {(niche?.platforms ?? []).map((p) => (
                    <Chip key={p} selected={platform === p} onClick={() => setPlatform(p)}>
                      {platformLabel(p)}
                    </Chip>
                  ))}
                </div>
              </div>
              {est && (
                <div className="rounded-[14px] bg-subtle p-4 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-muted-foreground">Estimated cost</span>
                    <span className="text-[22px] font-medium tracking-[-0.02em] tabular">{formatUsd(est.total)}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={over ? "h-full bg-queued" : "h-full bg-foreground/60"} style={{ width: `${cap > 0 ? Math.min(100, (spent / cap) * 100) : 0}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[12px] text-muted-foreground tabular">
                    <span>
                      {formatUsd(spent)} of {formatUsd(cap)} today
                    </span>
                    <span className={over ? "text-queued" : undefined}>{formatUsd(left)} left</span>
                  </div>
                  {over && <p className="mt-2 text-[12px] text-queued">This would go over the playbook's daily cap, so it may wait until tomorrow.</p>}
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-[12px] text-muted-foreground tabular sm:grid-cols-3">
                    <div className="flex justify-between gap-2"><dt>Keyframes</dt><dd>{formatUsd(est.image)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Animation</dt><dd>{formatUsd(est.video)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Voice</dt><dd>{formatUsd(est.tts)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Captions</dt><dd>{formatUsd(est.whisper)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Character</dt><dd>{formatUsd(est.character_sheet)}</dd></div>
                  </dl>
                </div>
              )}
              <p className="text-[13px] text-muted-foreground">
                {niche?.approve_before_post ? "It waits in your inbox for a yes before it posts." : "It posts at the playbook's next posting window."}
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Chip selected={postKind === "carousel"} onClick={() => setPostKind("carousel")}>Carousel</Chip>
                <Chip selected={postKind === "single"} onClick={() => setPostKind("single")}>Single image</Chip>
              </div>
              <Field label="Topic" hint="Optional. Leave it blank and the playbook picks one.">
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. 5 sauces in 15 minutes" maxLength={200} />
              </Field>
              {postKind === "carousel" && (
                <Field label="Slides">
                  <Input type="number" min={2} max={10} value={slides} onChange={(e) => setSlides(Math.min(10, Math.max(2, Number(e.target.value) || 5)))} />
                </Field>
              )}
            </>
          )}

          <Note tone="danger">{error}</Note>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!niche || (kind === "video" && !platform)}>
              {kind === "video" ? (est ? `Make it for ${formatUsd(est.total)}` : "Make it") : "Make it"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
