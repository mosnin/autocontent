"use client";

import { Copy, LayoutTemplate, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, Empty } from "../ui";
import { Note, postProxy } from "./bits";
import type { Template } from "./types";

function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function TemplateCard({ t, preview }: { t: Template; preview?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "live" | "danger" } | null>(null);
  const [imgOk, setImgOk] = useState(Boolean(t.reference_key) && !preview);
  const input = useRef<HTMLInputElement>(null);

  const remix = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const product_image_b64 = file ? await fileToB64(file) : "";
      await postProxy(`/api/v1/templates/${t.id}/remix`, { product_image_b64, count: 2 });
      setMsg({ text: "Remixing. Two images land in Library in about a minute.", tone: "live" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Remix failed", tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(t.prompt);
      setMsg({ text: "Prompt copied. Paste it into a playbook's visual style.", tone: "live" });
    } catch {
      setMsg({ text: "Couldn't copy.", tone: "danger" });
    }
  };

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-card">
      <div className="relative aspect-[4/3] bg-muted">
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/proxy/api/v1/templates/${t.id}/reference`} alt={t.name} className="size-full object-cover" onError={() => setImgOk(false)} />
        ) : (
          <div className="flex size-full items-center justify-center text-faint">
            <LayoutTemplate className="size-8 stroke-[1.4]" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-medium">{t.name}</h3>
            <Badge className="capitalize">{t.kind}</Badge>
          </div>
          {t.description && <p className="mt-1 text-[13px] text-muted-foreground">{t.description}</p>}
        </div>
        <div className="mt-auto space-y-2">
          {t.kind !== "video" ? (
            <>
              <input ref={input} type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label={`Product photo for ${t.name}`} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
                  <Upload />
                  <span className="max-w-[140px] truncate">{file ? file.name : "Your product photo"}</span>
                </Button>
                <Button size="sm" variant="primary" className="ml-auto" onClick={() => void remix()} loading={busy}>
                  Remix
                </Button>
              </div>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void copyPrompt()}>
              <Copy />
              Copy prompt
            </Button>
          )}
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        </div>
      </div>
    </article>
  );
}

export function TemplatesGrid({ templates, preview }: { templates: Template[] | null; preview?: boolean }) {
  if (templates === null) return <Empty art="activity" title="Couldn't load templates">The API didn't answer. Try again in a moment.</Empty>;
  if (templates.length === 0) return <Empty art="apps" title="No templates yet">Curated looks with their exact prompt attached show up here once they're published.</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">Curated looks with the exact prompt attached. Remix one with your product photo: same look, your product. Results land in Library.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <TemplateCard key={t.id} t={t} preview={preview} />
        ))}
      </div>
    </div>
  );
}
