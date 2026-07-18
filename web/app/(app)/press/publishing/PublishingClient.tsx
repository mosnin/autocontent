"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { AlertTriangle, Link2, Plus, Trash2 } from "lucide-react";

import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createTarget,
  deleteTarget,
  humanizePressError,
  pressKeys,
  targetsFetcher,
} from "@/lib/press-client";
import type { PublishTarget, PublishTargetKind } from "@/lib/types";

function AddTargetDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (target: PublishTarget) => void;
}) {
  const [kind, setKind] = React.useState<PublishTargetKind>("wordpress");
  const [name, setName] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setKind("wordpress");
      setName("");
      setBaseUrl("");
      setUsername("");
      setSecret("");
      setSubmitting(false);
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim() || !secret) {
      toast.error("Fill in every required field");
      return;
    }
    setSubmitting(true);
    try {
      const created = await createTarget({
        kind,
        name: name.trim(),
        base_url: baseUrl.trim(),
        username: kind === "wordpress" ? username.trim() : "",
        secret,
      });
      onCreated(created);
    } catch (err) {
      toast.error(humanizePressError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Add a publish target</DialogTitle>
            <DialogDescription>
              A WordPress site or a generic webhook a finished article can be
              pushed to. The secret is stored and never shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="target-kind">Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as PublishTargetKind)}>
                <SelectTrigger id="target-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wordpress">WordPress</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="target-name">Name</Label>
              <Input
                id="target-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={kind === "wordpress" ? "Main blog" : "CMS webhook"}
                maxLength={200}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="target-base-url">
                {kind === "wordpress" ? "Site URL" : "Webhook URL"}
              </Label>
              <Input
                id="target-base-url"
                type="url"
                inputMode="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  kind === "wordpress"
                    ? "https://example.com"
                    : "https://api.example.com/hooks/publish"
                }
                required
              />
              {kind === "wordpress" && (
                <p className="text-xs text-muted-foreground">
                  The WordPress REST API base. Posts are created under{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    /wp-json/wp/v2/posts
                  </code>
                  .
                </p>
              )}
            </div>

            {kind === "wordpress" && (
              <div className="space-y-2">
                <Label htmlFor="target-username">Username</Label>
                <Input
                  id="target-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="WordPress username"
                  maxLength={200}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="target-secret">
                {kind === "wordpress" ? "Application password" : "Signing secret"}
              </Label>
              <Input
                id="target-secret"
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={
                  kind === "wordpress" ? "xxxx xxxx xxxx xxxx xxxx xxxx" : "HMAC signing secret"
                }
                required
              />
              <p className="text-xs text-muted-foreground">
                Stored, never shown again.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} isLoading={submitting}>
              Add target
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TargetCard({
  target,
  onDelete,
}: {
  target: PublishTarget;
  onDelete: (t: PublishTarget) => void;
}) {
  return (
    <Card className={`p-4 ${target.disabled ? "border-dashed bg-muted/30" : ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{target.name}</span>
            <Badge variant="outline" className="font-mono uppercase">
              {target.kind}
            </Badge>
            {target.disabled && <Badge variant="secondary">Disabled</Badge>}
          </div>
          <p className="truncate text-sm text-muted-foreground" title={target.base_url}>
            {target.base_url}
          </p>
          {target.username && (
            <p className="text-xs text-muted-foreground">User: {target.username}</p>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(target)}
          aria-label={`Delete ${target.name}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}

export function PublishingClient({ initial }: { initial: PublishTarget[] }) {
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = useSWR<PublishTarget[]>(
    pressKeys.targets(),
    targetsFetcher,
    { fallbackData: initial, revalidateOnFocus: false },
  );

  const [addOpen, setAddOpen] = React.useState(false);
  const targets = data ?? [];
  const showError = error && targets.length === 0 && !isLoading;

  function handleCreated(created: PublishTarget) {
    setAddOpen(false);
    toast.success(`${created.name} added`);
    void mutate();
  }

  async function handleDelete(target: PublishTarget) {
    const ok = await confirm({
      title: `Delete ${target.name}?`,
      description:
        "Articles will no longer be able to publish to this target. This can't be undone.",
      confirmText: "Delete target",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTarget(target.id);
      toast.success("Target deleted");
      void mutate();
    } catch (err) {
      toast.error(humanizePressError(err));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
            Press
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Publishing</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Connect a WordPress site or a generic webhook, then publish
            finished articles from the article page.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add target
        </Button>
      </div>

      {showError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="rounded-full bg-destructive/10 p-3">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">Couldn&apos;t load targets</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {humanizePressError(error)}
            </p>
            <Button variant="outline" onClick={() => void mutate()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : targets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <Link2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">No publish targets yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add a WordPress site or a webhook so finished articles have
              somewhere to go.
            </p>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add your first target
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {targets.map((t) => (
            <TargetCard key={t.id} target={t} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <AddTargetDialog open={addOpen} onOpenChange={setAddOpen} onCreated={handleCreated} />
    </div>
  );
}
