"use client";

import * as React from "react";
import { useClerk } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { DangerZone } from "@/components/settings/danger-zone";

interface Props {
  /** The signed-in user's email, fetched server-side. `null` if the
   *  lookup failed — the delete confirmation then falls back to DELETE. */
  email: string | null;
}

// What the export bundle contains / what deletion erases. Kept in one
// place so both cards read from the same source of truth.
const DATA_ITEMS = [
  "Your profile and account details",
  "Every niche and its configuration",
  "All pipeline jobs and their spend records",
  "Generated articles and video metadata",
  "Personal access token prefixes (never the secrets)",
] as const;

const CONFIRM_WORD = "DELETE";

export function PrivacyClient({ email }: Props) {
  const { signOut } = useClerk();

  const [exporting, setExporting] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);

  // Enable the destructive confirm only once the user has typed their
  // exact email (case-insensitive — emails are) or the word DELETE.
  const typed = confirmText.trim();
  const matchesEmail =
    !!email && typed.toLowerCase() === email.toLowerCase();
  const matchesWord = typed === CONFIRM_WORD;
  const confirmed = matchesEmail || matchesWord;

  // Reset the input whenever the dialog is dismissed so a re-open starts
  // clean and the confirm button is disabled again.
  function onOpenChange(next: boolean) {
    if (deleting) return; // don't let it close mid-flight
    setDialogOpen(next);
    if (!next) setConfirmText("");
  }

  async function onExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/proxy/api/v1/users/me/export", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status}`);

      const blob = await res.blob();
      // Prefer the server's suggested filename, fall back to a sane default.
      const disposition = res.headers.get("content-disposition");
      const match = disposition?.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] ?? "marketer-data-export.json";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success("Your data export has downloaded");
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function onDelete() {
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/proxy/api/v1/users/me", {
        method: "DELETE",
      });
      if (res.status !== 204 && !res.ok) throw new Error(`${res.status}`);

      // Point of no return — tear down the session and land on home.
      toast.success("Your account has been deleted");
      try {
        await signOut({ redirectUrl: "/" });
      } catch {
        window.location.href = "/";
      }
    } catch {
      setDeleting(false);
      toast.error("Couldn't delete your account. Please try again.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Export ------------------------------------------------------ */}
      <Card className="border-border/60 bg-card/40">
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Export your data
          </CardTitle>
          <CardDescription>
            Under the GDPR right to data portability, you can download a
            machine-readable copy of everything we hold about your account at
            any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
              Included in the bundle
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {DATA_ITEMS.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={onExport}
              disabled={exporting}
              className="min-w-40"
            >
              {exporting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Preparing…
                </>
              ) : (
                "Download my data"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete ------------------------------------------------------ */}
      <DangerZone
        title="Delete account"
        description="Permanently erase your account and everything tied to it. This is your GDPR right to erasure — and it can't be undone."
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-md text-sm text-muted-foreground">
            All of your niches, jobs, articles, spend history, and access
            tokens are wiped immediately. There is no recovery and no grace
            period.
          </p>
          <Button
            variant="destructive"
            onClick={() => setDialogOpen(true)}
            className="shrink-0"
          >
            Delete account
          </Button>
        </div>
      </DangerZone>

      {/* Confirmation dialog ---------------------------------------- */}
      <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
        <DialogContent className="border-destructive/40">
          <DialogHeader>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-destructive">
              Danger zone
            </p>
            <DialogTitle>Delete your account permanently?</DialogTitle>
            <DialogDescription>
              This action is <strong>irreversible</strong>. Once confirmed,
              your account and all associated data are erased immediately and
              cannot be restored.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                This will delete
              </p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {DATA_ITEMS.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1 shrink-0 rounded-full bg-destructive/60"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="delete-confirm">
                To confirm, type{" "}
                {email ? (
                  <>
                    your email{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      {email}
                    </code>
                  </>
                ) : (
                  <>
                    the word{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      {CONFIRM_WORD}
                    </code>
                  </>
                )}
              </Label>
              <Input
                id="delete-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={deleting}
                placeholder={email ?? CONFIRM_WORD}
                aria-describedby="delete-confirm-hint"
                aria-invalid={typed.length > 0 && !confirmed}
              />
              {email ? (
                <p
                  id="delete-confirm-hint"
                  className="text-xs text-muted-foreground"
                >
                  You can also type{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    {CONFIRM_WORD}
                  </code>{" "}
                  instead.
                </p>
              ) : (
                <p id="delete-confirm-hint" className="sr-only">
                  Type {CONFIRM_WORD} to enable the delete button.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={!confirmed || deleting}
              className="min-w-44"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Deleting…
                </>
              ) : (
                "Permanently delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
