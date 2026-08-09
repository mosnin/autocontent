"use client";

// AI SEO audit. The POST is synchronous and routinely takes ~30s — there is
// no job row to poll — so the whole pending experience lives here: the button
// disables with a spinner, an honest elapsed counter runs, and the form says
// up front how long it takes. Nothing polls in the background because nothing
// is in flight in the background.
//
// The auditor is fail-closed on configuration: an unconfigured deployment
// answers the POST with 409. That is a deployment state, not a user error, so
// it renders as a calm panel instead of a red toast.

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { Info, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  auditErrorMessage,
  bandClass,
  deleteSeoAudit,
  isNotConfigured,
  isVendorOutage,
  runSeoAudit,
  seoAuditKeys,
  seoAuditsFetcher,
  type SeoAuditSummary,
  type StoredAudit,
} from "@/lib/seo-audit-client";
import { AuditResultView } from "./AuditResultView";

/** What the backend actually takes, said out loud rather than hidden behind
 *  an indeterminate spinner. */
const EXPECTED_SECONDS = 30;

function ElapsedNote() {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      Fetching and scoring the page — this takes about {EXPECTED_SECONDS} seconds.{" "}
      <span className="font-mono tabular-nums">{seconds}s</span> elapsed. Keep this
      tab open.
    </p>
  );
}

function NotConfiguredCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex gap-3">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium">The AI SEO auditor is not switched on here</p>
          <p className="text-sm text-muted-foreground">
            {message} Auditing needs the page-fetch vendor configured on this
            deployment. Nothing is wrong with your account, and no audit was
            charged — this surface will start working as soon as it is enabled.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SeoAuditClient({ initial }: { initial: SeoAuditSummary[] }) {
  const { data, mutate } = useSWR<SeoAuditSummary[]>(
    seoAuditKeys.list(),
    seoAuditsFetcher,
    { fallbackData: initial, revalidateOnFocus: false },
  );
  const recent = data ?? [];

  const [url, setUrl] = React.useState("");
  const [refresh, setRefresh] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<StoredAudit | null>(null);
  const [notConfigured, setNotConfigured] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    const target = url.trim();
    if (!target) {
      toast.error("Enter a URL to audit");
      return;
    }
    setRunning(true);
    setNotConfigured(null);
    try {
      const stored = await runSeoAudit(target, refresh);
      setResult(stored);
      void mutate();
      toast.success(
        stored.cached
          ? "Served from your recent audit of this URL"
          : `Scored ${stored.score.toFixed(1)} — ${stored.band}`,
      );
    } catch (err) {
      const message = auditErrorMessage(err);
      if (isNotConfigured(err)) {
        setNotConfigured(message);
      } else if (isVendorOutage(err)) {
        toast.error(`Could not fetch that page right now: ${message}`);
      } else {
        toast.error(message);
      }
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteSeoAudit(id);
      if (result?.id === id) setResult(null);
      await mutate(
        (rows) => (rows ?? []).filter((r) => r.id !== id),
        { revalidate: true },
      );
      toast.success("Audit deleted");
    } catch (err) {
      toast.error(auditErrorMessage(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Answer-engine readiness
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">AI SEO audit</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Score any page 0-100 on how readable it is to AI answer engines, across
          six weighted categories. Every finding comes with the evidence behind it
          and a copy-paste prompt your coding agent can act on.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Audit a page</CardTitle>
          <CardDescription>
            One page at a time — enter the exact URL you want scored, not just the
            domain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRun} className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1 space-y-1">
                <Label htmlFor="audit-url" className="sr-only">
                  Page URL
                </Label>
                <Input
                  id="audit-url"
                  name="url"
                  type="text"
                  inputMode="url"
                  placeholder="https://example.com/pricing"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={running}
                  autoComplete="url"
                />
              </div>
              <Button type="submit" disabled={running || !url.trim()}>
                {running ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Auditing…
                  </>
                ) : (
                  <>
                    <Search aria-hidden />
                    Run audit
                  </>
                )}
              </Button>
            </div>
            <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={refresh}
                disabled={running}
                onChange={(e) => setRefresh(e.target.checked)}
              />
              Re-scrape even if this URL was audited recently
            </label>
            {running ? (
              <ElapsedNote />
            ) : (
              <p className="text-sm text-muted-foreground">
                Runs in the foreground and takes about {EXPECTED_SECONDS} seconds —
                the page is fetched twice (rendered HTML and markdown) and every
                rule is scored before you get a result.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {notConfigured ? <NotConfiguredCard message={notConfigured} /> : null}

      {result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              {result.host}
            </h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/seo-audit/${result.id}`}>Open permalink</Link>
            </Button>
          </div>
          <AuditResultView stored={result} />
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent audits
        </h2>
        {recent.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <h3 className="text-base font-semibold">No audits yet</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Score your highest-intent page first — pricing, a product page, or
                the post you most want cited.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recent.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <span
                  className={cn(
                    "w-14 shrink-0 font-mono text-xl font-semibold tabular-nums",
                    bandClass(row.band),
                  )}
                >
                  {row.score.toFixed(1)}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/seo-audit/${row.id}`}
                    className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {row.url}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {row.host} · {new Date(row.created_at).toLocaleString()}
                  </p>
                </div>
                <Badge variant="outline" className={cn("text-xs", bandClass(row.band))}>
                  {row.band}
                </Badge>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete audit of ${row.url}`}
                  disabled={deleting === row.id}
                  onClick={() => void handleDelete(row.id)}
                >
                  {deleting === row.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Trash2 aria-hidden />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
