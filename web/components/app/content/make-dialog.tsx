"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink, Chip, Facts, Field, Input, Meter, Modal, Notice, Segmented, Select } from "@/design-system";
import { enqueueJobAction } from "@/lib/actions";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd } from "@/lib/format";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { Niche, Platform, TodaySpend } from "@/lib/types";
import { platformLabel } from "./status";

export type MakeKind = "video" | "carousel";

/**
 * "Make something": a video for a playbook on one platform (with the cost
 * estimate against today's cap), or a carousel / still image. Used on
 * Content and on every playbook.
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
  const over = Boolean(est && cap > 0 && est.total > left);

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
        await proxyFetch("/api/v1/image-posts", "POST", { niche_id: niche.id, kind: postKind, topic: topic.trim(), slide_count: postKind === "single" ? 1 : slides });
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const title = kind === "video" ? (niche ? `Make a video for ${niche.title}` : "Make a video") : "Make a carousel";

  if (active.length === 0)
    return (
      <Modal open={open} onClose={onClose} title={title} footer={<ButtonLink href="/playbooks/new" variant="primary">Create a playbook</ButtonLink>}>
        <p className="text-[13px] text-fg-muted">Everything starts from a playbook: who it&apos;s for, how it sounds, where it posts.</p>
      </Modal>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!niche || (kind === "video" && !platform)}>
            {kind === "video" && est ? `Make it for ${formatUsd(est.total)}` : "Make it"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!initial?.lockKind && (
          <Segmented
            value={kind}
            onChange={setKind}
            label="What to make"
            className="flex w-full"
            options={[
              { value: "video", label: "Video" },
              { value: "carousel", label: "Carousel" },
            ]}
          />
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
            <div role="group" aria-label="Platform" className="space-y-1.5">
              <span className="text-[12.5px] font-medium">Platform</span>
              <div className="flex flex-wrap gap-1.5">
                {(niche?.platforms ?? []).map((p) => (
                  <Chip key={p} selected={platform === p} onClick={() => setPlatform(p)}>
                    {platformLabel(p)}
                  </Chip>
                ))}
                {niche && niche.platforms.length === 0 && <span className="text-[12.5px] text-fg-muted">This playbook doesn&apos;t post anywhere yet.</span>}
              </div>
            </div>
            {est && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-fg-muted">Estimated cost</span>
                  <span className="text-[20px] font-medium tabular">{formatUsd(est.total)}</span>
                </div>
                <Meter value={cap > 0 ? (spent / cap) * 100 : 0} tone={over ? "attention" : "accent"} label="Today's spend against the cap" />
                <div className="flex justify-between text-[12px] text-fg-muted tabular">
                  <span>
                    {formatUsd(spent)} of {formatUsd(cap)} today
                  </span>
                  <span className={over ? "text-attention" : undefined}>{formatUsd(left)} left</span>
                </div>
                {over && <p className="text-[12px] text-attention">This goes over the playbook&apos;s daily cap, so it may wait until tomorrow.</p>}
                <Facts
                  items={[
                    { label: "Keyframes", value: formatUsd(est.image) },
                    { label: "Animation", value: formatUsd(est.video) },
                    { label: "Voice", value: formatUsd(est.tts) },
                    { label: "Captions", value: formatUsd(est.whisper) },
                    { label: "Character", value: formatUsd(est.character_sheet) },
                  ]}
                />
              </div>
            )}
            <p className="text-[12.5px] text-fg-muted">{niche?.approve_before_post ? "It waits in Activity for a yes before it posts." : "It posts at the playbook's next posting window."}</p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Chip selected={postKind === "carousel"} onClick={() => setPostKind("carousel")}>
                Carousel
              </Chip>
              <Chip selected={postKind === "single"} onClick={() => setPostKind("single")}>
                Single image
              </Chip>
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
        <Notice error={error} />
      </div>
    </Modal>
  );
}
