"use client";

// Template curation: upload a reference image and the exact prompt that
// produced it, then publish. Published templates appear for every user to
// remix with their own product photo.

import { Plus } from "lucide-react";
import * as React from "react";
import useSWR from "swr";
import { AdminFrame } from "@/components/app/admin/admin-frame";
import { Button, Card, ConfirmModal, EmptyLine, Field, FilterPill, Input, List, ListRow, Modal, Notice, Select, Skeleton, StatusBadge, Switch, Table, Textarea } from "@/design-system";
import { clientFetch } from "@/lib/client-fetcher";
import { proxyFetch } from "@/lib/proxy-fetch";

export interface Template {
  id: string;
  kind: "video" | "image" | "carousel";
  name: string;
  description: string;
  prompt: string;
  reference_key: string;
  is_published: boolean;
  created_at: string;
}

const KIND_LABEL: Record<Template["kind"], string> = { image: "Image", carousel: "Carousel", video: "Video" };
type Show = "all" | "published" | "draft";

function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AdminTemplatesClient({ initial }: { initial?: Template[] }) {
  const { data: templates, error: loadError, isLoading, mutate } = useSWR<Template[]>("/api/v1/templates/admin/all", clientFetch, { fallbackData: initial });
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Template | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [show, setShow] = React.useState<Show>("all");
  const [note, setNote] = React.useState<{ ok?: string; error?: string } | null>(null);

  const rows = (templates ?? []).filter((t) => show === "all" || (show === "published" ? t.is_published : !t.is_published));

  const togglePublish = async (t: Template) => {
    setBusyId(t.id);
    setNote(null);
    try {
      await proxyFetch<Template>(`/api/v1/templates/${t.id}`, "PUT", { is_published: !t.is_published });
      await mutate();
    } catch (e) {
      setNote({ error: e instanceof Error ? e.message : "Update failed" });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await proxyFetch(`/api/v1/templates/${deleting.id}`, "DELETE");
      setNote({ ok: "Template deleted." });
      setDeleting(null);
      await mutate();
    } catch (e) {
      setNote({ error: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminFrame
      crumbs={[{ label: "Templates" }]}
      actions={
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus /> New template
        </Button>
      }
      toolbar={
        <FilterPill
          label="Status"
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: "All templates" },
            { value: "published", label: "Published" },
            { value: "draft", label: "Drafts" },
          ]}
        />
      }
    >
      {note && <Notice ok={note.ok} error={note.error} />}
      {!templates && loadError ? (
        <EmptyLine action={<Button size="sm" onClick={() => void mutate()}>Try again</Button>}>Couldn&apos;t load templates. The API didn&apos;t answer.</EmptyLine>
      ) : !templates && isLoading ? (
        <Card className="space-y-3 p-3.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-2/3" />
          ))}
        </Card>
      ) : (
      <Table<Template>
        rows={rows}
        rowKey={(t) => t.id}
        empty={<EmptyLine action={<Button size="sm" onClick={() => setCreating(true)}>New template</Button>}>{show === "all" ? "No templates yet." : "Nothing in this view."}</EmptyLine>}
        columns={[
          {
            key: "name",
            label: "Template",
            render: (t) => (
              <div className="min-w-0 py-1.5">
                <div className="truncate font-medium">{t.name}</div>
                {t.description && <div className="max-w-[420px] truncate text-[12px] text-fg-muted">{t.description}</div>}
              </div>
            ),
          },
          { key: "kind", label: "Kind", hideOnPhone: true, render: (t) => <span className="text-fg-muted">{KIND_LABEL[t.kind]}</span> },
          { key: "status", label: "Status", render: (t) => <StatusBadge tone={t.is_published ? "positive" : "neutral"}>{t.is_published ? "Published" : "Draft"}</StatusBadge> },
          {
            key: "actions",
            label: <span className="sr-only">Actions</span>,
            align: "right",
            render: (t) => (
              <span className="inline-flex gap-1">
                <Button size="sm" variant="ghost" loading={busyId === t.id} disabled={busyId !== null} onClick={() => void togglePublish(t)}>
                  {t.is_published ? "Unpublish" : "Publish"}
                </Button>
                <Button size="sm" variant="ghost" disabled={busyId !== null} onClick={() => setDeleting(t)}>
                  Delete
                </Button>
              </span>
            ),
          },
        ]}
      />
      )}
      <NewTemplateModal open={creating} onClose={() => setCreating(false)} onCreated={() => (setCreating(false), setNote({ ok: "Template created." }), void mutate())} />
      <ConfirmModal open={deleting !== null} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? "template"}?`} confirmLabel="Delete" danger busy={busyId === deleting?.id} onConfirm={() => void remove()}>
        <p>This can't be undone.</p>
      </ConfirmModal>
    </AdminFrame>
  );
}

function NewTemplateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<Template["kind"]>("image");
  const [description, setDescription] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [publishNow, setPublishNow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) (setName(""), setKind("image"), setDescription(""), setPrompt(""), setFile(null), setPublishNow(false), setError(null));
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return setError("Name and prompt are required.");
    setBusy(true);
    setError(null);
    try {
      const reference_image_b64 = file ? await fileToB64(file) : "";
      await proxyFetch<Template>("/api/v1/templates", "POST", { kind, name: name.trim(), description: description.trim(), prompt, reference_image_b64, is_published: publishNow });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="New template"
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="template-form" variant="primary" loading={busy}>
            Create template
          </Button>
        </>
      }
    >
      <form id="template-form" onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-fg-muted">The reference look and the exact prompt that made it. Users remix it with their product photo.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Glossy studio product shot" />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Template["kind"])}>
              <option value="image">Image</option>
              <option value="carousel">Carousel</option>
              <option value="video">Video (style reference)</option>
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this look is good for" />
        </Field>
        <Field label="Prompt">
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder="The full prompt that produced the reference image…" />
        </Field>
        <Field label="Reference image" hint="PNG, JPG or WebP.">
          <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-1 file:mr-2 file:rounded-ds-sm file:border-0 file:bg-surface-3 file:px-2 file:py-0.5 file:text-[12px] file:text-fg" />
        </Field>
        <List>
          <ListRow>
            <span className="min-w-0 flex-1 text-[13px]">Publish immediately</span>
            <Switch checked={publishNow} onChange={setPublishNow} label="Publish immediately" />
          </ListRow>
        </List>
        <Notice error={error} />
      </form>
    </Modal>
  );
}
