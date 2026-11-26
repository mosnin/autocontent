"use client";

import { ChevronDown, Clapperboard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, cx, EmptyLine, Meter, Notice, PlanCard, StatusBadge, StepList, Time, useAllowed, usePending } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import { batchLabel, batchTone, credits, itemProgress, type ShortVideoBatch, type ShortVideoItem, STAGES, summary, usdFromMicros } from "@/lib/short-video";

const media = (item: ShortVideoItem, what: "video" | "srt" | "vtt") =>
  what === "video" ? `/api/proxy/api/v1/short-videos/items/${item.id}/video` : `/api/proxy/api/v1/short-videos/items/${item.id}/subtitles?format=${what}`;

/** Recent batches: each variant's stage as it runs, the finished videos with their credits. */
export function BatchList({ batches, preview }: { batches: ShortVideoBatch[] | null; preview?: boolean }) {
  if (batches === null) return <EmptyLine>Couldn&apos;t load your short videos. Try again in a moment.</EmptyLine>;
  if (batches.length === 0) return <EmptyLine>Nothing made yet. Your videos appear here as they render.</EmptyLine>;
  return (
    <div className="space-y-3">
      {batches.map((b) => (
        <BatchCard key={b.id} batch={b} preview={preview} />
      ))}
    </div>
  );
}

function BatchCard({ batch: b, preview }: { batch: ShortVideoBatch; preview?: boolean }) {
  const router = useRouter();
  const canApprove = useAllowed("content:approve");
  const { busy, error, run } = usePending<"approve" | "cancel">();
  const act = (kind: "approve" | "cancel") =>
    run(kind, async () => {
      if (preview) throw new Error("Preview: nothing is sent.");
      await proxyFetch(`/api/v1/short-videos/${b.id}/${kind}`, "POST");
      router.refresh();
    });

  if (b.status === "awaiting_approval") {
    return (
      <div className="space-y-2">
        <PlanCard
          title={b.title || "Short videos"}
          icon={<Clapperboard />}
          steps={[
            { label: summary({ source: b.source, topic: b.topic, script: "", variants: b.variants, settings: b.settings }) },
            { label: `Estimated ${usdFromMicros(b.estimate_micros)}, never more than ${usdFromMicros(b.cap_micros)}` },
          ]}
          meta={<span>Waiting for approval{b.created_at ? <> · <Time iso={b.created_at} /></> : null}</span>}
          approveLabel={`Approve ${b.variants} videos`}
          onApprove={() => act("approve")}
          onDismiss={() => act("cancel")}
          approving={busy === "approve"}
          dismissing={busy === "cancel"}
          blocked={canApprove ? undefined : "Owners and admins approve large batches."}
        />
        {error && <Notice error={error} />}
      </div>
    );
  }

  const done = b.items.filter((i) => i.status === "done").length;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-4 py-3">
        <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{b.title || "Short videos"}</h3>
        <StatusBadge tone={batchTone(b.status)}>{batchLabel(b.status)}</StatusBadge>
        <span className="w-full text-[12px] text-fg-muted tabular sm:w-auto">
          {done} of {b.items.length} ready · {usdFromMicros(b.spent_micros)} of {usdFromMicros(b.cap_micros)}
          {b.created_at ? <> · <Time iso={b.created_at} /></> : null}
        </span>
      </div>
      <ul className="divide-y divide-hairline">
        {b.items.map((item) => (
          <ItemRow key={item.id} item={item} aspect={b.settings.look.aspect} preview={preview} />
        ))}
      </ul>
      {(b.status === "queued" || b.status === "running") && (
        <div className="flex justify-end border-t border-hairline px-4 py-2">
          <Button size="sm" variant="ghost" loading={busy === "cancel"} onClick={() => act("cancel")}>
            Stop the rest
          </Button>
        </div>
      )}
      {error && (
        <div className="px-4 pb-3">
          <Notice error={error} />
        </div>
      )}
    </Card>
  );
}

function ItemRow({ item, aspect, preview }: { item: ShortVideoItem; aspect: string; preview?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { busy, error, run } = usePending<"retry">();
  const p = itemProgress(item);
  const stageLabel = STAGES[Math.min(p.current, STAGES.length - 1)]?.label ?? "";
  const retry = () =>
    run("retry", async () => {
      if (preview) throw new Error("Preview: nothing is sent.");
      await proxyFetch(`/api/v1/short-videos/items/${item.id}/retry`, "POST");
      router.refresh();
    });
  const ratio = aspect === "16:9" ? "16 / 9" : aspect === "1:1" ? "1 / 1" : "9 / 16";

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-5 shrink-0 text-[12px] text-fg-faint tabular">{item.variant}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className={cx("text-[13px]", item.hook ? "text-fg" : "text-fg-muted")}>{item.hook || (item.status === "queued" ? "Waiting to start" : "Writing the script")}</p>

          {item.status === "done" ? (
            <div className="flex flex-wrap items-start gap-4">
              <video
                className="w-40 shrink-0 rounded-ds-md border border-hairline bg-surface-2 object-cover"
                style={{ aspectRatio: ratio }}
                src={preview ? undefined : media(item, "video")}
                controls
                preload="metadata"
                aria-label={`Variant ${item.variant}`}
              />
              <div className="min-w-0 space-y-2 text-[12px] text-fg-muted">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <a className="text-ds-accent hover:underline" href={preview ? undefined : media(item, "video")} download>
                    Download
                  </a>
                  {item.srt_path && (
                    <a className="text-ds-accent hover:underline" href={preview ? undefined : media(item, "srt")}>
                      SRT
                    </a>
                  )}
                  {item.vtt_path && (
                    <a className="text-ds-accent hover:underline" href={preview ? undefined : media(item, "vtt")}>
                      VTT
                    </a>
                  )}
                  <span className="tabular">{usdFromMicros(item.spent_micros)}</span>
                </div>
                {credits(item.clips).length > 0 && <p className="leading-relaxed">Footage: {credits(item.clips).join(", ")}</p>}
              </div>
            </div>
          ) : item.status === "failed" ? (
            <div className="space-y-2">
              <p className="text-[12.5px] text-negative">
                Stopped at {stageLabel.toLowerCase()}: {item.error ?? "something went wrong"}
              </p>
              <Button size="sm" variant="secondary" loading={busy === "retry"} onClick={retry}>
                Try again
              </Button>
            </div>
          ) : item.status === "cancelled" ? (
            <p className="text-[12.5px] text-fg-muted">Stopped before it finished.</p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px] text-fg-muted">
                <span>{item.status === "queued" ? "Queued" : stageLabel}</span>
                <span className="tabular">
                  {Math.min(p.current + 1, STAGES.length)} of {STAGES.length}
                </span>
              </div>
              <Meter value={item.progress} label={`Variant ${item.variant} progress`} />
            </div>
          )}

          {item.status !== "queued" && (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="ds-press inline-flex items-center gap-1 text-[12px] text-fg-faint hover:text-fg-muted">
              Stages
              <ChevronDown className={cx("size-3.5 transition-transform duration-200", open && "rotate-180")} />
            </button>
          )}
          {open && (
            <div className="ds-enter">
              <StepList
                steps={STAGES.map((s) => ({ id: s.id, label: s.label, detail: item.stages[s.id]?.state === "skipped" ? "Skipped" : item.stages[s.id]?.detail || undefined }))}
                current={p.current}
                complete={p.complete}
                failed={p.failed}
              />
            </div>
          )}
          {error && <Notice error={error} />}
        </div>
      </div>
    </li>
  );
}
