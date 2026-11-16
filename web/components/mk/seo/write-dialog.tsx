"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createArticleAction } from "@/lib/actions";
import type { Niche } from "@/lib/types";
import { Button, ButtonLink, Field, Input, Modal, Select } from "../ui";
import { Note } from "../content/bits";

/** "Write an article": playbook + optional topic, then open the new article. */
export function WriteDialog({ open, onClose, niches }: { open: boolean; onClose: () => void; niches: Niche[] }) {
  const router = useRouter();
  const active = niches.filter((n) => !n.archived_at);
  const [nicheId, setNicheId] = useState(active[0]?.id ?? "");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("niche_id", nicheId);
    fd.set("topic", topic.trim());
    const res = await createArticleAction({ ok: false }, fd);
    setBusy(false);
    if (res.ok && res.article) {
      setTopic("");
      onClose();
      router.push(`/seo/${res.article.id}`);
    } else setError(res.error ?? "Couldn't start the article.");
  };

  return (
    <Modal open={open} onClose={onClose} title="Write an article">
      {active.length === 0 ? (
        <div className="space-y-4">
          <p className="text-[14px] text-muted-foreground">Articles are written from a playbook: its audience, voice and writing kit.</p>
          <ButtonLink href="/playbooks/new" variant="primary">Create a playbook</ButtonLink>
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-[14px] text-muted-foreground">The SEO editor researches what ranks, outlines, writes, scores it and adds metadata and a hero image.</p>
          <Field label="Playbook">
            <Select value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
              {active.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Topic or keyword" hint="Optional. Leave it blank and the editor picks one for the playbook.">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. best flour for fresh pasta" maxLength={200} autoFocus />
          </Field>
          <Note tone="danger">{error}</Note>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!nicheId}>
              Write it
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
