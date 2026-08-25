"use client";

// Headshot Studio: source photos + a style -> a batch of consistent portraits.
//
// Uploading is step one and it is the step that most often goes wrong, so the
// picker does real drag/click upload with per-file state and surfaces the
// server's own rejection text (type, size, magic-byte sniff) verbatim rather
// than a generic "upload failed" - those messages are the only way a user
// learns *why* a photo was refused.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import type { Niche } from "@/lib/types";
import {
  ALLOWED_SOURCE_TYPES,
  canRetryBatch,
  createHeadshotBatch,
  deleteHeadshotBatch,
  deleteHeadshotSource,
  headshotKeys,
  isBatchActive,
  isNotConfigured,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_IMAGES,
  MAX_SUBJECT_NOTES_CHARS,
  MAX_VARIANTS,
  MIN_VARIANTS,
  readableError,
  uploadHeadshotSource,
  type HeadshotBatch,
  type HeadshotBatchStatus,
  type HeadshotStyle,
} from "@/lib/headshots-client";

const POLL_MS = 8_000;

// ------------------------------------------------------------------ badges

const BATCH_TONE: Record<HeadshotBatchStatus, string> = {
  queued: "border text-muted-foreground bg-transparent",
  running: "border-brand/50 text-brand bg-transparent",
  done: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  partial:
    "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  failed:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
};

export function BatchStatusBadge({ status }: { status: HeadshotBatchStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-mono text-xs", BATCH_TONE[status])}
    >
      {status === "running" && (
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-brand" />
      )}
      {status}
    </Badge>
  );
}

// ---------------------------------------------------------------- uploader

type UploadStatus = "uploading" | "ready" | "rejected";

interface Upload {
  key: string;
  name: string;
  preview: string;
  status: UploadStatus;
  sourceId?: string;
  error?: string;
}

let uploadSeq = 0;

/** Client-side mirror of the server's first two checks. The server is still
 *  the authority (it also sniffs magic bytes); this only saves an obviously
 *  doomed round trip. */
function preReject(file: File): string | null {
  if (!(ALLOWED_SOURCE_TYPES as readonly string[]).includes(file.type)) {
    return `unsupported file type ${file.type || "unknown"}; upload a JPEG, PNG, or WebP`;
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return `photo is larger than the ${MAX_SOURCE_BYTES / (1024 * 1024)}MB limit`;
  }
  return null;
}

// -------------------------------------------------------------------- page

export function HeadshotsClient({
  initialStyles,
  initialBatches,
  niches,
}: {
  initialStyles: HeadshotStyle[];
  initialBatches: HeadshotBatch[];
  niches: Niche[];
}) {
  const router = useRouter();
  const { data: styles } = useSWR<{ styles: HeadshotStyle[] }>(
    headshotKeys.styles(),
    clientFetch,
    { fallbackData: { styles: initialStyles }, revalidateOnFocus: false },
  );
  const catalog = styles?.styles ?? initialStyles;

  const { data: batches, mutate } = useSWR<HeadshotBatch[]>(
    headshotKeys.batches(),
    clientFetch,
    {
      fallbackData: initialBatches,
      refreshInterval: (latest) => ((latest ?? []).some(isBatchActive) ? POLL_MS : 0),
    },
  );
  const list = batches ?? [];

  const [uploads, setUploads] = React.useState<Upload[]>([]);
  const [styleKey, setStyleKey] = React.useState(catalog[0]?.key ?? "");
  const [variantCount, setVariantCount] = React.useState(4);
  const [notes, setNotes] = React.useState("");
  const [nicheId, setNicheId] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notConfigured, setNotConfigured] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const ready = uploads.filter((u) => u.status === "ready" && u.sourceId);
  const selectedStyle = catalog.find((s) => s.key === styleKey);

  // Object URLs are per-upload and must be released, or a long session in the
  // picker leaks every photo it previewed.
  const previewsRef = React.useRef<string[]>([]);
  React.useEffect(
    () => () => {
      for (const url of previewsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  // Photos currently uploading or already stored. Kept in a ref so the
  // per-batch cap is enforced across a multi-file drop, where several uploads
  // are in flight before any state update has landed.
  const acceptedRef = React.useRef(0);

  const addFiles = React.useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `u${uploadSeq++}`;
      const preview = URL.createObjectURL(file);
      previewsRef.current.push(preview);

      const reject = (error: string) =>
        setUploads((prev) => [
          ...prev,
          { key, name: file.name, preview, status: "rejected", error },
        ]);

      const local = preReject(file);
      if (local) {
        reject(local);
        continue;
      }
      if (acceptedRef.current >= MAX_SOURCE_IMAGES) {
        reject(`at most ${MAX_SOURCE_IMAGES} reference photos per batch`);
        continue;
      }

      acceptedRef.current += 1;
      setUploads((prev) => [
        ...prev,
        { key, name: file.name, preview, status: "uploading" },
      ]);

      try {
        const source = await uploadHeadshotSource(file);
        setUploads((prev) =>
          prev.map((u) =>
            u.key === key ? { ...u, status: "ready", sourceId: source.id } : u,
          ),
        );
      } catch (err) {
        acceptedRef.current -= 1;
        if (isNotConfigured(err)) setNotConfigured(true);
        const message = readableError(err, "upload failed");
        setUploads((prev) =>
          prev.map((u) =>
            u.key === key ? { ...u, status: "rejected", error: message } : u,
          ),
        );
      }
    }
  }, []);

  async function removeUpload(item: Upload) {
    if (item.status !== "rejected") acceptedRef.current -= 1;
    setUploads((prev) => prev.filter((u) => u.key !== item.key));
    URL.revokeObjectURL(item.preview);
    previewsRef.current = previewsRef.current.filter((u) => u !== item.preview);
    if (item.sourceId) {
      try {
        await deleteHeadshotSource(item.sourceId);
      } catch {
        // The row is already off the picker; a stale source is harmless and
        // the erasure sweep cleans it up.
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (ready.length === 0) {
      toast.error("Upload at least one photo of the subject first.");
      return;
    }
    if (!styleKey) {
      toast.error("Pick a style.");
      return;
    }
    setBusy(true);
    try {
      const batch = await createHeadshotBatch({
        style_key: styleKey,
        source_image_ids: ready.map((u) => u.sourceId as string),
        variant_count: variantCount,
        subject_notes: notes.trim(),
        niche_id: nicheId || null,
      });
      toast.success(`Rendering ${variantCount} portraits`);
      await mutate();
      router.push(`/ads/headshots/${batch.id}`);
    } catch (err) {
      if (isNotConfigured(err)) setNotConfigured(true);
      else toast.error(readableError(err, "Could not start the batch"));
      setBusy(false);
    }
  }

  async function removeBatch(id: string) {
    setDeleting(id);
    try {
      await deleteHeadshotBatch(id);
      toast.success("Batch deleted");
      await mutate();
    } catch (err) {
      toast.error(readableError(err, "Delete failed"));
    } finally {
      setDeleting(null);
    }
  }

  const styleLabel = React.useCallback(
    (key: string) => catalog.find((s) => s.key === key)?.label ?? key,
    [catalog],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Headshot studio</h1>
        <p className="text-sm text-muted-foreground">
          Upload a few photos of one person, pick a look, and get a batch of
          consistent professional portraits. Reference photos stay yours - you
          can delete them here at any time.
        </p>
      </div>

      {notConfigured ? (
        <Card>
          <CardContent className="space-y-2 py-8 text-center">
            <h3 className="text-base font-semibold">
              Headshot studio isn&apos;t configured here
            </h3>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              This deployment has no image key, so uploads and new batches
              can&apos;t be accepted. The style catalog below is still readable.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <form onSubmit={submit} className="space-y-6">
        {/* -------------------------------------------------- 1. photos */}
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="text-sm font-semibold">1 · Reference photos</h2>
              <p className="text-xs text-muted-foreground">
                Up to {MAX_SOURCE_IMAGES} photos of the same person, JPEG / PNG
                / WebP, {MAX_SOURCE_BYTES / (1024 * 1024)}MB each. A few angles
                beat one perfect shot; the first photo is the primary face
                reference.
              </p>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!notConfigured) void addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "hover:border-primary/60",
              )}
            >
              <p className="text-sm font-medium">Drop photos here</p>
              <p className="text-xs text-muted-foreground">or click to choose files</p>
              <input
                ref={inputRef}
                type="file"
                accept={ALLOWED_SOURCE_TYPES.join(",")}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {uploads.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {uploads.map((u) => (
                  <div
                    key={u.key}
                    className={cn(
                      "overflow-hidden rounded-lg border bg-card",
                      u.status === "rejected" && "border-destructive/50",
                    )}
                  >
                    <div className="relative aspect-square w-full bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u.preview}
                        alt={u.name}
                        className={cn(
                          "h-full w-full object-cover",
                          u.status !== "ready" && "opacity-50",
                        )}
                      />
                      {u.status === "uploading" ? (
                        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">
                          Uploading…
                        </span>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Remove ${u.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeUpload(u);
                        }}
                        className="absolute right-1 top-1 rounded-md bg-background/85 px-1.5 py-0.5 text-xs font-medium backdrop-blur hover:bg-background"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="space-y-0.5 p-2">
                      <p className="truncate text-[11px] font-medium" title={u.name}>
                        {u.name}
                      </p>
                      {u.status === "rejected" ? (
                        <p className="text-[11px] text-destructive" title={u.error}>
                          {u.error}
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          {u.status === "ready" ? "ready" : "uploading"}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* --------------------------------------------------- 2. style */}
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="text-sm font-semibold">2 · Style</h2>
              <p className="text-xs text-muted-foreground">
                Each style is art direction across four axes - wardrobe,
                lighting, background, lens. Expand one to read the exact prompt
                language it contributes.
              </p>
            </div>

            {catalog.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                The style catalog is unavailable right now.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.map((s) => {
                  const active = s.key === styleKey;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setStyleKey(s.key)}
                      aria-pressed={active}
                      className={cn(
                        "flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors",
                        active
                          ? "border-primary ring-1 ring-primary"
                          : "hover:border-primary/50",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{s.label}</span>
                        {active ? (
                          <Badge variant="default" className="text-[10px]">
                            selected
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {s.description}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">Best for: </span>
                        {s.best_for}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedStyle ? (
              <details className="rounded-lg border bg-muted/40 p-3">
                <summary className="cursor-pointer list-none text-xs font-medium">
                  Prompt language for {selectedStyle.label} ▾
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  {selectedStyle.prompt_preview}
                </p>
              </details>
            ) : null}
          </CardContent>
        </Card>

        {/* ------------------------------------------------- 3. options */}
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="text-sm font-semibold">3 · The batch</h2>
              <p className="text-xs text-muted-foreground">
                Each variant is a separate render and a separate charge, so a
                partial batch still keeps the portraits that landed.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="variants">Variants</Label>
                <select
                  id="variants"
                  value={variantCount}
                  onChange={(e) => setVariantCount(Number(e.target.value))}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm focus-visible:border-primary focus-visible:outline-none"
                >
                  {Array.from(
                    { length: MAX_VARIANTS - MIN_VARIANTS + 1 },
                    (_, i) => i + MIN_VARIANTS,
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="niche">
                  Bill to niche <span className="text-muted-foreground">(optional)</span>
                </Label>
                <select
                  id="niche"
                  value={nicheId}
                  onChange={(e) => setNicheId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm focus-visible:border-primary focus-visible:outline-none"
                >
                  <option value="">Account spend</option>
                  {niches.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">
                Subject notes <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, MAX_SUBJECT_NOTES_CHARS))}
                rows={3}
                placeholder="Keeps her glasses on. Prefers a warmer, less formal look than a suit."
              />
              <p className="text-xs text-muted-foreground">
                {notes.length}/{MAX_SUBJECT_NOTES_CHARS} - facts about the
                subject, not a credential the portrait should imply.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {ready.length} photo{ready.length === 1 ? "" : "s"} ready
                {selectedStyle ? ` · ${selectedStyle.label}` : ""} ·{" "}
                {variantCount} variants
              </p>
              <Button
                type="submit"
                disabled={busy || notConfigured || ready.length === 0 || !styleKey}
              >
                {busy ? "Starting…" : "Generate portraits"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* ----------------------------------------------------- batches */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Batches</h2>
        {list.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <h3 className="text-lg font-semibold">No batches yet</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Upload a photo, pick a style, and the first set of portraits
                lands a minute or two later.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col rounded-lg border bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                      Style
                    </TableHead>
                    <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                      Variants
                    </TableHead>
                    <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                      Created
                    </TableHead>
                    <TableHead className="h-10 text-right text-xs font-medium text-muted-foreground">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((b) => (
                    <TableRow key={b.id} className="border-b last:border-0 hover:bg-muted/30">
                      <TableCell className="py-3 text-sm font-medium">
                        <Link
                          href={`/ads/headshots/${b.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {styleLabel(b.style_key)}
                        </Link>
                        {b.subject_notes ? (
                          <p
                            className="max-w-[280px] truncate text-xs text-muted-foreground"
                            title={b.subject_notes}
                          >
                            {b.subject_notes}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-3 font-mono text-xs tabular-nums text-muted-foreground">
                        {b.variant_count}
                      </TableCell>
                      <TableCell className="py-3">
                        <BatchStatusBadge status={b.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-3 text-xs text-muted-foreground">
                        {new Date(b.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={deleting === b.id}
                          onClick={() => void removeBatch(b.id)}
                        >
                          {deleting === b.id ? "…" : "Delete"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        {list.some(canRetryBatch) ? (
          <p className="text-xs text-muted-foreground">
            A failed or partial batch can be resumed from its own page - retry
            only re-renders the portraits that are missing.
          </p>
        ) : null}
      </section>
    </div>
  );
}
