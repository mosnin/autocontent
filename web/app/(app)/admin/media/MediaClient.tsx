"use client";

import * as React from "react";
import { Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { MediaSlot, useMediaManifest } from "@/components/media-slot";
import {
  DashHeading,
  DashPanel,
} from "@/components/hub/dashboard-kit";
import { Button } from "@/components/ui/button";
import { MEDIA_SLOTS } from "@/lib/media-slots";
import { cn } from "@/lib/utils";

/**
 * The Media manager: upload, replace, or clear the image behind every
 * managed slot on the marketing site and the dashboards. Slots without an
 * upload fall back to their duotone placeholder everywhere they appear.
 */
export function MediaClient() {
  const { data, mutate } = useMediaManifest();
  const [busy, setBusy] = React.useState<string | null>(null);

  const upload = async (id: string, file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Keep uploads under 8 MB");
      return;
    }
    setBusy(id);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, dataUrl }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      toast.success("Image updated everywhere it appears");
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const clear = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/media?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      toast.success("Reverted to the placeholder");
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const groups = ["Marketing site", "Dashboards"] as const;

  return (
    <div className="space-y-10">
      <DashHeading
        as="h1"
        sub="Swap the image behind any managed surface. Uploads go live immediately on the landing page and the dashboards; cleared slots fall back to their placeholder art."
      >
        Media
      </DashHeading>

      {groups.map((group, gi) => (
        <DashPanel delay={0.06 * (gi + 1)} key={group} title={group}>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {MEDIA_SLOTS.filter((s) => s.group === group).map((slot) => {
              const filled = Boolean(data?.slots?.[slot.id]);
              return (
                <div
                  className="flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03),0_10px_32px_-22px_rgb(0_0_0/0.2)]"
                  key={slot.id}
                >
                  <div className="group aspect-[16/10] overflow-hidden border-b border-border/60">
                    <MediaSlot id={slot.id} showChip={false} />
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div>
                      <p className="text-sm font-semibold leading-snug">
                        {slot.label}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {slot.hint}
                      </p>
                    </div>
                    <div className="mt-auto flex items-center gap-2">
                      <label
                        className={cn(
                          "inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-zinc-800",
                          busy === slot.id && "pointer-events-none opacity-60",
                        )}
                      >
                        <Upload aria-hidden className="size-3.5" />
                        {filled ? "Replace" : "Upload"}
                        <input
                          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void upload(slot.id, f);
                            e.target.value = "";
                          }}
                          type="file"
                        />
                      </label>
                      {filled && (
                        <Button
                          aria-label={`Clear ${slot.label}`}
                          disabled={busy === slot.id}
                          onClick={() => void clear(slot.id)}
                          size="sm"
                          variant="outline"
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DashPanel>
      ))}

      <p className="text-xs text-muted-foreground">
        Images are stored on the web server&apos;s disk. On ephemeral hosting
        they survive until the instance recycles — re-upload or move storage
        to a bucket before relying on them in production.
      </p>
    </div>
  );
}
