"use client";

// Upload a file straight into the media library. Streams through
// lib/studio-client.ts's uploadMedia (XMLHttpRequest, so we get real
// progress), inserts a media_assets row with source="upload" server-side,
// and refreshes the grid on success. 413 (too large) and 415 (bad type)
// come back humanized via humanizeStudioError.

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { humanizeStudioError, uploadMedia } from "@/lib/studio-client";

export function UploadButton({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<number | null>(null);

  function onPick() {
    inputRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input immediately so picking the same file twice in a row
    // still fires a change event.
    e.target.value = "";
    if (!file) return;

    setProgress(0);
    try {
      await uploadMedia(file, setProgress);
      toast.success("Uploaded");
      onUploaded();
    } catch (err) {
      toast.error(humanizeStudioError(err));
    } finally {
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  return (
    <div className="flex items-center gap-2">
      {uploading ? (
        <div className="flex w-40 items-center gap-2">
          <Progress value={progress} />
          <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {progress}%
          </span>
        </div>
      ) : null}
      <Button variant="outline" onClick={onPick} disabled={uploading}>
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        Upload
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={onFileChange}
      />
    </div>
  );
}
