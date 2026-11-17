"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink, Field, Input, Modal, Notice, Select } from "@/design-system";
import { createArticleAction } from "@/lib/actions";
import type { Niche } from "@/lib/types";

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

  if (active.length === 0)
    return (
      <Modal open={open} onClose={onClose} title="Write an article" footer={<ButtonLink href="/playbooks/new" variant="primary">Create a playbook</ButtonLink>}>
        <p className="text-[13px] text-fg-muted">Articles are written from a playbook: its audience, voice and writing kit.</p>
      </Modal>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Write an article"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="write-article" variant="primary" loading={busy} disabled={!nicheId}>
            Write it
          </Button>
        </>
      }
    >
      <form
        id="write-article"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Playbook">
          <Select value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
            {active.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Topic or keyword" hint="Optional. Leave it blank and the editor picks one.">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. best flour for fresh pasta" maxLength={200} autoFocus />
        </Field>
        <Notice error={error} />
      </form>
    </Modal>
  );
}
