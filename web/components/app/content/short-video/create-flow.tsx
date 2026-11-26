"use client";

import { ArrowLeft, Check, SlidersHorizontal, Upload as UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, Card, Chip, cx, Field, FieldGroup, Input, NotAllowed, Notice, Segmented, Select, Textarea, useAllowed } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import {
  type Aspect,
  type Draft,
  EMPTY_DRAFT,
  type Estimate,
  ideaProblem,
  type Options,
  patch,
  type ShortVideoBatch,
  STEPS,
  type StepId,
  summary,
  toRequest,
  type Upload,
} from "@/lib/short-video";
import { FineTuneSheet } from "./fine-tune-sheet";

/**
 * The create flow: one decision per step (topic or script → look & voice →
 * footage → subtitles & music → variants → render). Every step has a
 * default, so "Make it" on the first step is a complete request. Advanced
 * controls live in the Fine-tune sheet, reachable from any step.
 */
export function CreateFlow({
  options,
  uploads: initialUploads,
  preview,
  initialStep = "idea",
  initialDraft,
  previewEstimate,
  openFineTune,
}: {
  options: Options | null;
  uploads: Upload[];
  preview?: boolean;
  initialStep?: StepId;
  initialDraft?: Partial<Draft>;
  previewEstimate?: Estimate;
  openFineTune?: boolean;
}) {
  const router = useRouter();
  const canCreate = useAllowed("content:create");
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT, ...initialDraft, settings: { ...EMPTY_DRAFT.settings, ...(options?.defaults ?? {}), ...(initialDraft?.settings ?? {}) } });
  const [step, setStep] = useState(STEPS.findIndex((s) => s.id === initialStep));
  const [dir, setDir] = useState(1);
  const [fineTune, setFineTune] = useState(Boolean(openFineTune));
  const [estimate, setEstimate] = useState<Estimate | null>(previewEstimate ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<ShortVideoBatch | null>(null);
  const [uploads, setUploads] = useState(initialUploads);
  const problem = ideaProblem(draft);
  const current = STEPS[step]!;

  // Estimate the draft as it changes (debounced; free, no side effects).
  const seq = useRef(0);
  useEffect(() => {
    if (preview || problem) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      proxyFetch<Estimate>("/api/v1/short-videos/estimate", "POST", toRequest(draft))
        .then((e) => n === seq.current && setEstimate(e))
        .catch(() => n === seq.current && setEstimate(null));
    }, 400);
    return () => clearTimeout(t);
  }, [draft, preview, problem]);

  const go = (to: number) => {
    setDir(to >= step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, to)));
    setError(null);
  };

  const submit = async () => {
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    try {
      if (preview) throw new Error("Preview: nothing is sent.");
      const batch = await proxyFetch<ShortVideoBatch>("/api/v1/short-videos", "POST", toRequest(draft));
      setMade(batch);
      setDraft((d) => ({ ...d, topic: "", script: "" }));
      setStep(0);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the render.");
    } finally {
      setBusy(false);
    }
  };

  const set = (d: Partial<Draft>) => setDraft((x) => ({ ...x, ...d }));
  const s = draft.settings;
  const approval = estimate?.needs_approval ?? draft.variants > (options?.limits.approval_variants ?? 3);
  const sources = options?.footage_sources ?? ["pexels", "pixabay"];
  const stockReady = sources.includes("pexels") || sources.includes("pixabay");

  if (!canCreate) return <NotAllowed>Owners, admins and marketers make videos.</NotAllowed>;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
        {step > 0 ? (
          <button type="button" onClick={() => go(step - 1)} className="ds-press -ml-1 flex size-7 items-center justify-center rounded-ds-sm text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Back">
            <ArrowLeft className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-fg-faint tabular">
            Step {step + 1} of {STEPS.length}
          </div>
          <div className="truncate text-[13.5px] font-medium">{current.label}</div>
        </div>
        <Progress step={step} onGo={(i) => i < step && go(i)} />
        <Button variant="ghost" size="sm" onClick={() => setFineTune(true)}>
          <SlidersHorizontal className="size-3.5" />
          Fine-tune
        </Button>
      </div>

      <div key={step} className="ds-step px-4 py-5 sm:px-5" style={{ ["--ds-step" as string]: dir }}>
        {current.id === "idea" && (
          <div className="space-y-4">
            <Segmented
              value={draft.source}
              onChange={(v) => set({ source: v })}
              label="Start from"
              options={[
                { value: "topic", label: "A topic" },
                { value: "script", label: "My script" },
              ]}
            />
            {draft.source === "topic" ? (
              <Field label="What's the video about?" hint="Marketer writes the hook and narration. Each variant gets a different hook.">
                <Input value={draft.topic} onChange={(e) => set({ topic: e.target.value })} placeholder="Three coffee myths baristas wish you'd stop believing" maxLength={500} autoFocus />
              </Field>
            ) : (
              <Field label="Your script" hint="Read word for word. Footage is picked from what each sentence is about.">
                <Textarea value={draft.script} onChange={(e) => set({ script: e.target.value })} rows={6} maxLength={6000} placeholder="Most people brew coffee too hot…" />
              </Field>
            )}
            <Actions
              note={estimate && !problem ? `About $${Number(estimate.total_usd).toFixed(2)} · ${draft.variants === 1 ? "1 video" : `${draft.variants} variants`}` : undefined}
            >
              <Button variant="secondary" disabled={Boolean(problem)} onClick={() => go(1)}>
                Customize
              </Button>
              <Button variant="primary" disabled={Boolean(problem) || busy} loading={busy} onClick={submit}>
                Make it
              </Button>
            </Actions>
          </div>
        )}

        {current.id === "look" && (
          <div className="space-y-5">
            <FieldGroup label="Shape">
              <div role="radiogroup" aria-label="Shape" className="grid grid-cols-3 gap-2">
                {(["9:16", "1:1", "16:9"] as Aspect[]).map((a) => (
                  <Choice key={a} selected={s.look.aspect === a} onClick={() => set({ settings: patch(s, "look", { aspect: a }) })} label={a} detail={a === "9:16" ? "TikTok, Reels, Shorts" : a === "1:1" ? "Feed" : "YouTube"}>
                    <AspectGlyph aspect={a} />
                  </Choice>
                ))}
              </div>
            </FieldGroup>
            <FieldGroup label="Length">
              <div className="flex flex-wrap gap-2">
                {[15, 30, 45, 60].map((n) => (
                  <Chip key={n} selected={s.look.duration_sec === n} onClick={() => set({ settings: patch(s, "look", { duration_sec: n }) })}>
                    {n}s
                  </Chip>
                ))}
              </div>
            </FieldGroup>
            <Field label="Voice">
              <Select value={`${s.look.voice_provider}:${s.look.voice}`} onChange={(e) => {
                const [provider, voice] = e.target.value.split(":") as ["openai" | "elevenlabs", string];
                set({ settings: patch(s, "look", { voice_provider: provider, voice }) });
              }}>
                {(options?.voices.openai ?? ["onyx", "nova", "alloy"]).map((v) => (
                  <option key={v} value={`openai:${v}`}>
                    {v[0]!.toUpperCase() + v.slice(1)}
                  </option>
                ))}
                {(options?.voices.elevenlabs ?? []).map((v) => (
                  <option key={v} value={`elevenlabs:${v}`}>
                    ElevenLabs voice
                  </option>
                ))}
              </Select>
            </Field>
            <Next onNext={() => go(2)} />
          </div>
        )}

        {current.id === "footage" && (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="Footage" className="space-y-2">
              <Choice row selected={!s.footage.sources.includes("uploads")} disabled={!stockReady} onClick={() => set({ settings: patch(s, "footage", { sources: ["pexels", "pixabay"] }) })} label="Stock footage" detail={stockReady ? "Free clips from Pexels and Pixabay, matched to each sentence. Credits are kept per clip." : "Not set up on this workspace yet."} />
              <Choice row selected={s.footage.sources.length === 1 && s.footage.sources[0] === "uploads"} disabled={!sources.includes("uploads")} onClick={() => set({ settings: patch(s, "footage", { sources: ["uploads"] }) })} label="My own clips" detail={sources.includes("uploads") ? "Images and videos you upload. Checked before they're used." : "Uploads need object storage, which isn't set up."} />
              <Choice row selected={s.footage.sources.length > 1 && s.footage.sources.includes("uploads")} disabled={!sources.includes("uploads") || !stockReady} onClick={() => set({ settings: patch(s, "footage", { sources: ["pexels", "pixabay", "uploads"] }) })} label="Both" detail="Your clips first, stock fills the rest." />
            </div>
            {s.footage.sources.includes("uploads") && (
              <UploadPicker
                uploads={uploads}
                selected={s.footage.upload_ids}
                preview={preview}
                onAdded={(u) => setUploads((list) => [u, ...list])}
                onToggle={(id) => set({ settings: patch(s, "footage", { upload_ids: s.footage.upload_ids.includes(id) ? s.footage.upload_ids.filter((x) => x !== id) : [...s.footage.upload_ids, id] }) })}
              />
            )}
            <Next onNext={() => go(3)} disabled={s.footage.sources.length === 1 && s.footage.sources[0] === "uploads" && s.footage.upload_ids.length === 0} />
          </div>
        )}

        {current.id === "finish" && (
          <div className="space-y-5">
            <FieldGroup label="Subtitles" hint="Timed to the voiceover, spelled the way your script spells it.">
              <div className="flex flex-wrap gap-2">
                {([
                  ["highlight", "Highlight the spoken word"],
                  ["sentence", "Lines"],
                  ["word", "One word at a time"],
                  ["off", "None"],
                ] as const).map(([m, label]) => (
                  <Chip key={m} selected={m === "off" ? !s.subtitles.enabled : s.subtitles.enabled && s.subtitles.mode === m} onClick={() => set({ settings: patch(s, "subtitles", m === "off" ? { enabled: false } : { enabled: true, mode: m }) })}>
                    {label}
                  </Chip>
                ))}
              </div>
            </FieldGroup>
            <FieldGroup label="Music" hint="Kept under the voice and pushed down while it speaks.">
              <div className="flex flex-wrap gap-2">
                {([
                  ["library", "From the library"],
                  ["generated", "An original score"],
                  ["none", "None"],
                ] as const)
                  .filter(([m]) => m !== "generated" || (options?.music_modes ?? []).includes("generated"))
                  .map(([m, label]) => (
                    <Chip key={m} selected={s.music.mode === m} onClick={() => set({ settings: patch(s, "music", { mode: m }) })}>
                      {label}
                    </Chip>
                  ))}
              </div>
            </FieldGroup>
            <Next onNext={() => go(4)} />
          </div>
        )}

        {current.id === "variants" && (
          <div className="space-y-4">
            <FieldGroup label="How many versions?" hint={draft.source === "topic" ? "Each one gets its own hook and its own footage, so you can see which one lands." : "Same script, different footage and cuts."}>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 5, 10].map((n) => (
                  <Chip key={n} selected={draft.variants === n} onClick={() => set({ variants: n })}>
                    {n === 1 ? "Just one" : n}
                  </Chip>
                ))}
              </div>
            </FieldGroup>
            {draft.variants > (options?.limits.approval_variants ?? 3) && <p className="text-[12.5px] text-fg-muted">Batches over {options?.limits.approval_variants ?? 3} videos wait for an owner or admin to approve them before anything is spent.</p>}
            <Next onNext={() => go(5)} />
          </div>
        )}

        {current.id === "render" && (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-fg-muted">{summary(draft)}</p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Estimated" value={estimate ? `$${Number(estimate.total_usd).toFixed(2)}` : "—"} />
              <Stat label="Stops at" value={estimate ? `$${Number(estimate.cap_usd).toFixed(2)}` : "—"} hint="Batch cap" />
              <Stat label="Starts" value={approval ? "After approval" : "Right away"} />
            </dl>
            <Actions>
              <Button variant="primary" disabled={Boolean(problem) || busy} loading={busy} onClick={submit}>
                {approval ? "Send for approval" : draft.variants === 1 ? "Render video" : `Render ${draft.variants} videos`}
              </Button>
            </Actions>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Notice error={error} />
          </div>
        )}
        {made && step === 0 && !error && (
          <div className="mt-3 flex items-center gap-2 text-[12.5px] text-fg-muted" role="status">
            <Check className="size-3.5 text-positive" />
            {made.status === "awaiting_approval" ? "Sent for approval. It's in Recent below." : "Started. Follow it in Recent below."}
          </div>
        )}
      </div>
      <FineTuneSheet open={fineTune} onClose={() => setFineTune(false)} settings={s} onChange={(next) => set({ settings: next })} />
    </Card>
  );
}

function Progress({ step, onGo }: { step: number; onGo: (i: number) => void }) {
  return (
    <ol className="hidden items-center gap-1 sm:flex" aria-label="Steps">
      {STEPS.map((st, i) => (
        <li key={st.id}>
          <button
            type="button"
            onClick={() => onGo(i)}
            disabled={i >= step}
            aria-label={`${st.label}${i < step ? ", done" : i === step ? ", current" : ""}`}
            aria-current={i === step ? "step" : undefined}
            className={cx("block h-1 w-5 rounded-full transition-colors duration-200", i < step ? "bg-fg-muted hover:bg-fg" : i === step ? "bg-fg" : "bg-surface-3")}
          />
        </li>
      ))}
    </ol>
  );
}

function Actions({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
      {note && <span className="mr-auto text-[12px] text-fg-faint tabular">{note}</span>}
      {children}
    </div>
  );
}

function Next({ onNext, disabled }: { onNext: () => void; disabled?: boolean }) {
  return (
    <Actions>
      <Button variant="primary" onClick={onNext} disabled={disabled}>
        Continue
      </Button>
    </Actions>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-ds-md border border-hairline bg-surface-2 px-3 py-2">
      <dt className="text-[12px] text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-fg tabular">{value}</dd>
      {hint && <dd className="text-[11.5px] text-fg-faint">{hint}</dd>}
    </div>
  );
}

function Choice({ selected, onClick, label, detail, children, row, disabled }: { selected: boolean; onClick: () => void; label: string; detail?: string; children?: ReactNode; row?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "ds-press w-full rounded-ds-md border text-left disabled:cursor-not-allowed disabled:opacity-50",
        row ? "flex items-start gap-3 px-3 py-2.5" : "flex flex-col items-center gap-2 px-2 py-3 text-center",
        selected ? "border-hairline-strong bg-surface-3" : "border-hairline bg-surface-2 hover:border-hairline-strong",
      )}
    >
      {row && <span className={cx("mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full border", selected ? "border-fg" : "border-hairline-strong")}>{selected && <span className="size-1.5 rounded-full bg-fg" />}</span>}
      {children}
      <span className="min-w-0">
        <span className="block text-[13px] text-fg">{label}</span>
        {detail && <span className="block text-[12px] text-fg-muted">{detail}</span>}
      </span>
    </button>
  );
}

function AspectGlyph({ aspect }: { aspect: Aspect }) {
  const [w, h] = aspect === "9:16" ? [18, 32] : aspect === "16:9" ? [32, 18] : [26, 26];
  return (
    <span aria-hidden className="flex h-8 items-center justify-center">
      <span className="block rounded-ds-xs border-2 border-fg-muted" style={{ width: w, height: h }} />
    </span>
  );
}

async function uploadOne(file: File): Promise<Upload> {
  const started = await proxyFetch<{ upload: Upload; put_url: string; headers: Record<string, string> }>("/api/v1/short-videos/uploads", "POST", { filename: file.name, content_type: file.type, size_bytes: file.size });
  const put = await fetch(started.put_url, { method: "PUT", headers: started.headers, body: file });
  if (!put.ok) throw new Error("The upload didn't go through. Try again.");
  return proxyFetch<Upload>(`/api/v1/short-videos/uploads/${started.upload.id}/complete`, "POST");
}

function UploadPicker({ uploads, selected, onToggle, onAdded, preview }: { uploads: Upload[]; selected: string[]; onToggle: (id: string) => void; onAdded: (u: Upload) => void; preview?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length || preview) return;
    setBusy(true);
    setError(null);
    for (const f of Array.from(files).slice(0, 10)) {
      try {
        const u = await uploadOne(f);
        if (u.status === "rejected") setError(`${f.name}: ${u.error ?? "rejected"}`);
        else {
          onAdded(u);
          onToggle(u.id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
    }
    setBusy(false);
  };
  const ready = uploads.filter((u) => u.status === "ready");
  return (
    <div className="space-y-2 rounded-ds-md border border-hairline bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-fg-muted">{ready.length ? `${selected.length} of ${ready.length} chosen` : "No clips yet"}</span>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
          <UploadIcon className="size-3.5" />
          Add files
        </Button>
        <input ref={input} type="file" multiple accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => add(e.target.files)} />
      </div>
      {ready.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {ready.map((u) => (
            <li key={u.id}>
              <Chip selected={selected.includes(u.id)} onClick={() => onToggle(u.id)}>
                {u.filename || (u.kind === "video" ? "Video" : "Image")}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11.5px] text-fg-faint">MP4, MOV or WebM up to 200 MB and 3 minutes; JPEG, PNG or WebP up to 15 MB.</p>
      {error && <Notice error={error} />}
    </div>
  );
}
