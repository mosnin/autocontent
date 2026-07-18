"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Eye, Inbox, Mail, Send, Sparkles } from "lucide-react";

import { ArticleMarkdown } from "@/components/article-markdown";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/client-fetcher";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import {
  analyticsKeys,
  composeDigest,
  humanizeAnalyticsError,
  newsletterDigestsFetcher,
  newsletterSettingsFetcher,
  putNewsletterSettings,
  sendDigest,
  type NewsletterCadence,
  type NewsletterDigest,
  type NewsletterSettings,
} from "@/lib/press-analytics-client";

const CADENCES: { value: NewsletterCadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "monthly", label: "Monthly" },
];

export function NewslettersClient({
  initialSettings,
  initialDigests,
}: {
  initialSettings: NewsletterSettings;
  initialDigests: NewsletterDigest[];
}) {
  const { data: settingsData, mutate: mutateSettings } = useSWR<NewsletterSettings>(
    analyticsKeys.newsletterSettings(),
    newsletterSettingsFetcher,
    { fallbackData: initialSettings },
  );
  const settings = settingsData ?? initialSettings;

  const { data: digestsData, mutate: mutateDigests } = useSWR<NewsletterDigest[]>(
    analyticsKeys.newsletterDigests(),
    newsletterDigestsFetcher,
    { fallbackData: initialDigests },
  );
  const digests = (digestsData ?? []).slice().sort(
    (a, b) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  );

  const [composing, setComposing] = React.useState(false);
  const [preview, setPreview] = React.useState<NewsletterDigest | null>(null);

  async function handleCompose() {
    setComposing(true);
    try {
      const digest = await composeDigest();
      toast.success("Digest composed as a draft");
      setPreview(digest);
      void mutateDigests();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Nothing new to send yet");
      } else {
        toast.error(humanizeAnalyticsError(err));
      }
    } finally {
      setComposing(false);
    }
  }

  function handleSent(updated: NewsletterDigest) {
    void mutateDigests(
      (digests ?? []).map((d) => (d.id === updated.id ? updated : d)),
      false,
    );
    void mutateSettings();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">Press</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Newsletters</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Roll up recently done articles into a digest email on a
            cadence, or compose one on demand.
          </p>
        </div>
        <Button onClick={() => void handleCompose()} disabled={composing} isLoading={composing}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Compose now
        </Button>
      </div>

      <SettingsCard settings={settings} onSaved={() => void mutateSettings()} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Digest history</h2>
        {digests.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="rounded-full bg-muted p-3">
                <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold">No digests yet</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Compose one from your recently done articles above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <ul className="divide-y divide-border/60">
              {digests.map((d) => (
                <DigestRow
                  key={d.id}
                  digest={d}
                  onPreview={() => setPreview(d)}
                  onSent={handleSent}
                />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <PreviewDialog digest={preview} onOpenChange={(open) => !open && setPreview(null)} />
    </div>
  );
}

function SettingsCard({
  settings,
  onSaved,
}: {
  settings: NewsletterSettings;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = React.useState(settings.enabled);
  const [cadence, setCadence] = React.useState<NewsletterCadence>(settings.cadence);
  const [sendTo, setSendTo] = React.useState(settings.send_to);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setEnabled(settings.enabled);
    setCadence(settings.cadence);
    setSendTo(settings.send_to);
  }, [settings]);

  const dirty =
    enabled !== settings.enabled || cadence !== settings.cadence || sendTo !== settings.send_to;

  async function handleSave() {
    setSaving(true);
    try {
      await putNewsletterSettings({ enabled, cadence, send_to: sendTo.trim() });
      toast.success("Settings saved");
      onSaved();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Settings</CardTitle>
        <CardDescription>
          Autopilot composes and sends a digest on this cadence when
          enabled. Compose-now always works regardless of this setting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="newsletter-enabled">Automatic sending</Label>
            <p className="text-xs text-muted-foreground">
              Send a digest automatically on the cadence below.
            </p>
          </div>
          <Switch id="newsletter-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="newsletter-cadence">Cadence</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as NewsletterCadence)}>
              <SelectTrigger id="newsletter-cadence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CADENCES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newsletter-send-to">Send to</Label>
            <Input
              id="newsletter-send-to"
              type="email"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              placeholder="Falls back to your account email"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void handleSave()} disabled={!dirty || saving} isLoading={saving}>
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function statusVariant(status: NewsletterDigest["status"]): BadgeVariant {
  if (status === "sent") return "success";
  if (status === "failed") return "destructive";
  return "outline";
}

function DigestRow({
  digest,
  onPreview,
  onSent,
}: {
  digest: NewsletterDigest;
  onPreview: () => void;
  onSent: (d: NewsletterDigest) => void;
}) {
  const [sending, setSending] = React.useState(false);

  async function handleSend() {
    setSending(true);
    try {
      const sent = await sendDigest(digest.id);
      toast.success("Digest sent");
      onSent(sent);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("This digest was already sent");
      } else {
        toast.error(humanizeAnalyticsError(err));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <button
        type="button"
        onClick={onPreview}
        className="min-w-0 flex-1 space-y-1 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {digest.subject || "(no subject)"}
          </span>
          <Badge variant={statusVariant(digest.status)}>{digest.status}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {digest.article_ids.length} article{digest.article_ids.length === 1 ? "" : "s"}
          {digest.created_at &&
            ` · composed ${new Date(digest.created_at).toLocaleDateString()}`}
          {digest.sent_at && ` · sent ${new Date(digest.sent_at).toLocaleDateString()}`}
        </p>
        {digest.status === "failed" && digest.error && (
          <p className="text-xs text-destructive">{digest.error}</p>
        )}
      </button>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onClick={onPreview}>
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          Preview
        </Button>
        {digest.status === "draft" && (
          <Button size="sm" onClick={() => void handleSend()} disabled={sending} isLoading={sending}>
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Send
          </Button>
        )}
      </div>
    </li>
  );
}

function PreviewDialog({
  digest,
  onOpenChange,
}: {
  digest: NewsletterDigest | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={digest !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {digest && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {digest.subject || "(no subject)"}
              </DialogTitle>
              <DialogDescription>
                {digest.article_ids.length} article{digest.article_ids.length === 1 ? "" : "s"}{" "}
                included
              </DialogDescription>
            </DialogHeader>
            {digest.markdown ? (
              <ArticleMarkdown markdown={digest.markdown} />
            ) : (
              <p className="text-sm text-muted-foreground">No content stored for this digest.</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
