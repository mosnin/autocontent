"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Search,
  Unplug,
} from "lucide-react";

import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyticsKeys,
  deleteGscConnection,
  gscConnectFetcher,
  gscStatusFetcher,
  humanizeAnalyticsError,
  isGscNotConfigured,
  setGscSite,
  type GscStatus,
} from "@/lib/press-analytics-client";

const RETURN_TO = "/press/search";

export function SearchConsoleClient({ initial }: { initial: GscStatus }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data, mutate } = useSWR<GscStatus>(analyticsKeys.gscStatus(), gscStatusFetcher, {
    fallbackData: initial,
  });
  const status = data ?? initial;

  // Google redirects back to `${return_to}?gsc_connected=1` (see gsc.py's
  // callback) after a successful OAuth round trip.
  React.useEffect(() => {
    if (searchParams.get("gsc_connected") === "1") {
      toast.success("Search Console connected");
      void mutate();
      router.replace("/press/search");
    }
  }, [searchParams, mutate, router]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">Press</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Search Console</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Connect Google Search Console to pull rankings and find content
          gaps for a channel&apos;s site.
        </p>
      </div>

      {status.connected ? (
        <ConnectedCard status={status} onChanged={() => void mutate()} />
      ) : (
        <DisconnectedCard />
      )}

      {status.connected && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/press/rankings">
            <Card className="p-4 transition-colors hover:bg-muted/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Rankings</p>
                  <p className="text-xs text-muted-foreground">Top queries and position trend</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </div>
            </Card>
          </Link>
          <Link href="/press/gaps">
            <Card className="p-4 transition-colors hover:bg-muted/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Content gaps</p>
                  <p className="text-xs text-muted-foreground">Queries with no article yet</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </div>
            </Card>
          </Link>
        </div>
      )}
    </div>
  );
}

function ConnectedCard({
  status,
  onChanged,
}: {
  status: GscStatus;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState(status.site_url === "");
  const [siteUrl, setSiteUrl] = React.useState(status.site_url);
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!siteUrl.trim()) {
      toast.error("Enter a site URL");
      return;
    }
    setSaving(true);
    try {
      await setGscSite(siteUrl.trim());
      toast.success("Site connected");
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    const ok = await confirm({
      title: "Disconnect Search Console?",
      description:
        "Rankings and content gap data already synced stay put, but nothing new will sync until you reconnect.",
      confirmText: "Disconnect",
      destructive: true,
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      await deleteGscConnection();
      toast.success("Disconnected");
      onChanged();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-success/10 p-1.5">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            </div>
            <CardTitle className="text-base">Connected</CardTitle>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => void handleDisconnect()}
            disabled={disconnecting}
            isLoading={disconnecting}
          >
            <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
            Disconnect
          </Button>
        </div>
        <CardDescription>
          Search Console is authorized. Pick which verified site to sync.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {editing ? (
          <form onSubmit={handleSave} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gsc-site">Site URL</Label>
              <Input
                id="gsc-site"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="sc-domain:example.com or https://example.com/"
                required
              />
              <p className="text-xs text-muted-foreground">
                Must match a property you have access to in Google Search
                Console exactly, including any trailing slash.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              {status.site_url && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSiteUrl(status.site_url);
                    setEditing(false);
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={saving} isLoading={saving}>
                Save site
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Site</p>
              <p className="truncate font-mono text-sm">{status.site_url}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Change site
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DisconnectedCard() {
  const { data, error, isLoading, mutate } = useSWR(
    analyticsKeys.gscConnect(RETURN_TO),
    gscConnectFetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false },
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>
    );
  }

  if (error && isGscNotConfigured(error)) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="rounded-full bg-warning/10 p-3">
            <KeyRound className="h-6 w-6 text-warning" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold">Search Console needs Google OAuth keys</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            This deployment hasn&apos;t configured a Google OAuth client for
            Search Console yet. Ask whoever runs the backend to set it up,
            then come back here to connect.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold">Couldn&apos;t reach Search Console</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            {humanizeAnalyticsError(error)}
          </p>
          <Button variant="outline" onClick={() => void mutate()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold">Not connected</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Connect a Google account to pull Search Console rankings and find
          content gaps for a channel&apos;s site.
        </p>
        {data && (
          <Button asChild>
            <a href={data.authorize_url}>Connect Search Console</a>
          </Button>
        )}
        <Badge variant="outline" className="font-normal text-muted-foreground">
          Read-only access, we never modify your property
        </Badge>
      </CardContent>
    </Card>
  );
}
