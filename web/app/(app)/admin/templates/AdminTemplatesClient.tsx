"use client";

// Template curation: upload a reference image + the exact prompt that
// produced it, then publish. Published templates appear on /templates
// for every user to remix with their own product photo.

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/square/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clientFetch } from "@/lib/client-fetcher";
import type { Template } from "@/app/(app)/templates/TemplatesClient";

function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function apiCall<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function AdminTemplatesClient() {
  const { data: templates, mutate } = useSWR<Template[]>(
    "/api/v1/templates/admin/all",
    clientFetch,
  );

  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<Template["kind"]>("image");
  const [description, setDescription] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [publishNow, setPublishNow] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const create = async () => {
    if (!name.trim() || !prompt.trim()) {
      toast.error("name and prompt are required");
      return;
    }
    setSaving(true);
    try {
      const reference_image_b64 = file ? await fileToB64(file) : "";
      await apiCall<Template>("/api/v1/templates", "POST", {
        kind,
        name: name.trim(),
        description: description.trim(),
        prompt,
        reference_image_b64,
        is_published: publishNow,
      });
      toast.success("template created");
      setName("");
      setDescription("");
      setPrompt("");
      setFile(null);
      setPublishNow(false);
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "create failed");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (t: Template) => {
    setBusyId(t.id);
    try {
      await apiCall<Template>(`/api/v1/templates/${t.id}`, "PUT", {
        is_published: !t.is_published,
      });
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "update failed");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (t: Template) => {
    if (!window.confirm(`Delete template "${t.name}"? This cannot be undone.`)) {
      return;
    }
    setBusyId(t.id);
    try {
      await apiCall<void>(`/api/v1/templates/${t.id}`, "DELETE");
      toast.success("template deleted");
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "delete failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New template</CardTitle>
          <CardDescription>
            Upload the reference look and the exact prompt that made it.
            Users remix it with their product photo for the same aesthetic.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Glossy studio product shot"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-kind">Kind</Label>
              <select
                id="tpl-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as Template["kind"])}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="image">Image</option>
                <option value="carousel">Carousel</option>
                <option value="video">Video (style reference)</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-description">Description</Label>
            <Input
              id="tpl-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this look is good for"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-prompt">Prompt</Label>
            <Textarea
              id="tpl-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="The full prompt that produced the reference image…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-reference">Reference image (PNG/JPG)</Label>
              <Input
                id="tpl-reference"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input
                type="checkbox"
                checked={publishNow}
                onChange={(e) => setPublishNow(e.target.checked)}
                className="size-4"
              />
              Publish immediately
            </label>
          </div>
          <Button onClick={create} disabled={saving}>
            {saving ? "Creating…" : "Create template"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All templates</CardTitle>
          <CardDescription>
            Drafts are only visible here — publish to put them in front of
            users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(templates ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No templates yet.</p>
          )}
          {(templates ?? []).map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
            >
              <Badge variant={t.is_published ? "default" : "secondary"}>
                {t.is_published ? "published" : "draft"}
              </Badge>
              <Badge variant="outline">{t.kind}</Badge>
              <span className="font-medium">{t.name}</span>
              {t.description ? (
                <span className="text-muted-foreground">{t.description}</span>
              ) : null}
              <span className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === t.id}
                  onClick={() => togglePublish(t)}
                >
                  {t.is_published ? "Unpublish" : "Publish"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyId === t.id}
                  onClick={() => remove(t)}
                >
                  Delete
                </Button>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
