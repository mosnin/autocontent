"use client";

import { Copy, LayoutTemplate, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Card, EmptyLine, Notice, StatusBadge, Thumb } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
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
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [imgOk, setImgOk] = useState(Boolean(t.reference_key) && !preview);
  const input = useRef<HTMLInputElement>(null);

  const remix = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const product_image_b64 = file ? await fileToB64(file) : "";
      await proxyFetch(`/api/v1/templates/${t.id}/remix`, "POST", { product_image_b64, count: 2 });
      setMsg({ ok: "Remixing. Two images land in Deliverables in about a minute." });
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : "Remix failed" });
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(t.prompt);
      setMsg({ ok: "Prompt copied" });
    } catch {
      setMsg({ error: "Couldn't copy" });
    }
  };

  return (
    <Card className="flex min-w-0 flex-col p-2.5">
      <Thumb ratio="4/5">
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/proxy/api/v1/templates/${t.id}/reference`} alt={t.name} className="absolute inset-0 size-full object-cover" onError={() => setImgOk(false)} />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-fg-faint [&_svg]:size-5">
            <LayoutTemplate />
          </span>
        )}
      </Thumb>
      <div className="flex flex-1 flex-col gap-3 px-1 pb-1 pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13.5px] font-medium">{t.name}</h3>
            <StatusBadge>{t.kind[0].toUpperCase() + t.kind.slice(1)}</StatusBadge>
          </div>
          {t.description && <p className="mt-1 line-clamp-2 text-[12.5px] text-fg-muted">{t.description}</p>}
        </div>
        <div className="mt-auto space-y-2">
          {t.kind !== "video" ? (
            <>
              <input ref={input} type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label={`Product photo for ${t.name}`} />
              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="ghost" className="min-w-0 max-w-full shrink" onClick={() => input.current?.click()}>
                  <Upload />
                  <span className="truncate">{file ? file.name : "Product photo"}</span>
                </Button>
                <Button variant="primary" className="ml-auto" onClick={() => void remix()} loading={busy}>
                  Remix
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={() => void copyPrompt()}>
              <Copy />
              Copy prompt
            </Button>
          )}
          {msg && <Notice ok={msg.ok} error={msg.error} />}
        </div>
      </div>
    </Card>
  );
}

export function TemplatesGrid({ templates, preview }: { templates: Template[] | null; preview?: boolean }) {
  if (templates === null) return <EmptyLine>Couldn&apos;t load templates. Try again in a moment.</EmptyLine>;
  if (templates.length === 0) return <EmptyLine>No templates published yet.</EmptyLine>;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {templates.map((t) => (
        <TemplateCard key={t.id} t={t} preview={preview} />
      ))}
    </div>
  );
}
