"use client";

import { Trash2 } from "lucide-react";
import * as React from "react";
import { AdminFrame } from "@/components/app/admin/admin-frame";
import { useMediaManifest } from "@/components/media-slot";
import { buttonClass, Card, cx, IconButton, Notice, Section, Thumb } from "@/design-system";
import { MEDIA_SLOTS, mediaFileUrl } from "@/lib/media-slots";

const GROUPS = ["Marketing site", "Dashboards"] as const;

/**
 * The media manager: upload, replace or clear the image behind every managed
 * slot on the marketing site and the dashboards. Empty slots fall back to a
 * flat placeholder wherever they appear.
 */
export function MediaClient() {
  const { data, mutate } = useMediaManifest();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<{ ok?: string; error?: string } | null>(null);

  const upload = async (id: string, file: File) => {
    if (file.size > 8 * 1024 * 1024) return setNote({ error: "Keep uploads under 8 MB." });
    setBusy(id);
    setNote(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, dataUrl }) });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setNote({ ok: "Image updated everywhere it appears." });
      await mutate();
    } catch (e) {
      setNote({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const clear = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      const res = await fetch(`/api/media?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setNote({ ok: "Reverted to the placeholder." });
      await mutate();
    } catch (e) {
      setNote({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminFrame crumbs={[{ label: "Media" }]}>
      {note && <Notice ok={note.ok} error={note.error} />}
      {GROUPS.map((group) => (
        <Section key={group} title={group}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {MEDIA_SLOTS.filter((s) => s.group === group).map((slot) => {
              const entry = data?.slots?.[slot.id];
              return (
                <Card key={slot.id} className="flex flex-col p-2.5">
                  <Thumb ratio="16/9" src={entry ? mediaFileUrl(slot.id, entry.updatedAt) : null} alt={slot.label}>
                    {!entry && <span className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-faint">Empty</span>}
                  </Thumb>
                  <div className="mt-2.5 min-w-0 flex-1 px-1">
                    <div className="truncate text-[13px] font-medium">{slot.label}</div>
                    <div className="line-clamp-2 text-[12px] text-fg-muted">{slot.hint}</div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5 px-1 pb-1">
                    <label className={cx(buttonClass("secondary", "sm", "flex-1 cursor-pointer"), busy === slot.id && "pointer-events-none opacity-45")}>
                      {entry ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void upload(slot.id, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {entry && (
                      <IconButton label={`Clear ${slot.label}`} disabled={busy === slot.id} onClick={() => void clear(slot.id)}>
                        <Trash2 />
                      </IconButton>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>
      ))}
      <p className="text-[12px] text-fg-faint">Images are stored on the web server's disk. On ephemeral hosting they last until the instance recycles.</p>
    </AdminFrame>
  );
}
