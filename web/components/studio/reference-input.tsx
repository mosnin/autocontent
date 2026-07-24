"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/square/ui/button";
import { uploadReference, type StudioUpload } from "@/lib/studio/client";
import { cn } from "@/lib/utils";

export interface ReferenceItem extends StudioUpload {
  /** Local preview so the thumbnail shows before the presigned URL loads. */
  preview: string;
}

/**
 * Reference media for a generation: upload one or many, keep their order
 * (the order badge is the order the model receives them in), drop any of
 * them. Attaching the first item is what switches a studio from its
 * text-to-X models to its X-to-X models.
 */
export function ReferenceInput({
  items,
  onChange,
  max = 1,
  accept = "image/png,image/jpeg,image/webp",
  label,
  disabled,
}: {
  items: ReferenceItem[];
  onChange: (next: ReferenceItem[]) => void;
  max?: number;
  accept?: string;
  label: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();

  const add = async (files: FileList) => {
    const room = max - items.length;
    if (room <= 0) return;
    setBusy(true);
    setError(null);
    const added: ReferenceItem[] = [];
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const uploaded = await uploadReference(file);
        added.push({ ...uploaded, preview: URL.createObjectURL(file) });
      }
      onChange([...items, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (added.length) onChange([...items, ...added]);
    } finally {
      setBusy(false);
    }
  };

  const remove = (key: string) => {
    const target = items.find((i) => i.key === key);
    if (target) URL.revokeObjectURL(target.preview);
    onChange(items.filter((i) => i.key !== key));
  };

  const full = items.length >= max;
  const isVideo = accept.includes("video");
  const isAudio = accept.includes("audio") && !accept.includes("image");

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {max > 1 ? (
          <span className="text-xs text-muted-foreground">
            {items.length} of {max}
          </span>
        ) : null}
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <li
              className="relative size-20 overflow-hidden rounded-md border bg-muted"
              key={item.key}
            >
              {isAudio ? (
                <span className="flex h-full items-center justify-center px-1 text-center text-[11px] text-muted-foreground">
                  {item.key.split("/").pop()}
                </span>
              ) : isVideo && item.content_type.startsWith("video/") ? (
                <video className="size-full object-cover" muted src={item.preview} />
              ) : (
                // Local object URL of the user's own file — next/image would
                // add nothing and cannot optimize a blob.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="size-full object-cover"
                  src={item.preview}
                />
              )}
              {max > 1 ? (
                <span className="absolute left-1 top-1 rounded bg-background/90 px-1 text-[11px] font-medium tabular-nums">
                  {index + 1}
                </span>
              ) : null}
              <button
                aria-label={`Remove reference ${index + 1}`}
                className="absolute right-1 top-1 rounded bg-background/90 p-0.5 text-foreground hover:bg-background"
                disabled={disabled}
                onClick={() => remove(item.key)}
                type="button"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label
        className={cn(
          "block",
          (full || disabled || busy) && "pointer-events-none opacity-60",
        )}
        htmlFor={inputId}
      >
        <Button asChild className="w-full" size="sm" variant="outline">
          <span>
            {busy
              ? "Uploading…"
              : items.length === 0
                ? "Add"
                : full
                  ? "Limit reached"
                  : "Add another"}
          </span>
        </Button>
        <input
          accept={accept}
          className="sr-only"
          disabled={disabled || busy || full}
          id={inputId}
          multiple={max > 1}
          onChange={(e) => {
            if (e.target.files?.length) void add(e.target.files);
            e.target.value = "";
          }}
          type="file"
        />
      </label>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
