"use client";

import * as React from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Check, Layers, Sparkles, Trash2 } from "lucide-react";

import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyticsKeys,
  clusterFetcher,
  clustersFetcher,
  deleteCluster,
  humanizeAnalyticsError,
  planCluster,
  promoteClusterItem,
  type ClusterWithItems,
  type ContentCluster,
  type ContentClusterItem,
} from "@/lib/press-analytics-client";
import type { Niche } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ClustersClient({
  initial,
  niches,
}: {
  initial: ContentCluster[];
  niches: Niche[];
}) {
  const active = niches.filter((n) => !n.archived_at);
  const [nicheId, setNicheId] = React.useState<string>(active[0]?.id ?? "");
  const [pillarKeyword, setPillarKeyword] = React.useState("");
  const [planning, setPlanning] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(initial[0]?.id ?? null);

  const { data, mutate } = useSWR<ContentCluster[]>(
    analyticsKeys.clusters(),
    clustersFetcher,
    { fallbackData: initial },
  );
  const clusters = (data ?? []).slice().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const nicheTitles = React.useMemo(
    () => new Map(niches.map((n) => [n.id, n.title])),
    [niches],
  );

  async function handlePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!nicheId) {
      toast.error("Pick a channel first");
      return;
    }
    if (!pillarKeyword.trim()) {
      toast.error("Enter a pillar keyword");
      return;
    }
    setPlanning(true);
    try {
      const created = await planCluster(nicheId, pillarKeyword.trim());
      toast.success(`Planned "${created.title}" with ${created.items.length} spokes`);
      void globalMutate(analyticsKeys.cluster(created.id), created, false);
      setSelectedId(created.id);
      setPillarKeyword("");
      void mutate();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setPlanning(false);
    }
  }

  function handleDeleted(id: string) {
    void mutate(
      (clusters ?? []).filter((c) => c.id !== id),
      false,
    );
    if (selectedId === id) setSelectedId(null);
    void mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clusters</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Plan a pillar page and its supporting spokes around a keyword for
          a channel, then promote the spokes worth writing into the topic
          queue.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handlePlan} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Channel</Label>
              <Select value={nicheId} onValueChange={setNicheId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a channel" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[220px] flex-[2] space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Pillar keyword</Label>
              <Input
                value={pillarKeyword}
                onChange={(e) => setPillarKeyword(e.target.value)}
                placeholder="e.g. content marketing strategy"
              />
            </div>
            <Button type="submit" disabled={!nicheId || planning} isLoading={planning}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Plan cluster
            </Button>
          </form>
        </CardContent>
      </Card>

      {clusters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <Layers className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">No clusters yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Pick a channel and a pillar keyword above, then plan your
              first cluster.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="space-y-2 lg:w-2/5">
            {clusters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "block w-full rounded-xl border border-border/60 bg-card p-3 text-left transition-colors hover:bg-muted/40",
                  selectedId === c.id && "border-primary/60 bg-muted/60",
                )}
              >
                <p className="truncate text-sm font-semibold">{c.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {c.pillar_keyword && (
                    <Badge variant="outline" className="font-normal">
                      {c.pillar_keyword}
                    </Badge>
                  )}
                  <span>{nicheTitles.get(c.niche_id) ?? "-"}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            {selectedId ? (
              <ClusterDetail clusterId={selectedId} onDeleted={handleDeleted} />
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-sm text-muted-foreground">
                  Pick a cluster to see its spokes.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ClusterDetail({
  clusterId,
  onDeleted,
}: {
  clusterId: string;
  onDeleted: (id: string) => void;
}) {
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = useSWR<ClusterWithItems>(
    analyticsKeys.cluster(clusterId),
    clusterFetcher,
  );
  const [deleting, setDeleting] = React.useState(false);
  const [promotingId, setPromotingId] = React.useState<string | null>(null);

  async function handleDelete() {
    if (!data) return;
    const ok = await confirm({
      title: `Delete "${data.title}"?`,
      description: "The cluster and its spoke list are removed. This can't be undone.",
      confirmText: "Delete cluster",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteCluster(clusterId);
      toast.success("Cluster deleted");
      onDeleted(clusterId);
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setDeleting(false);
    }
  }

  async function handlePromote(item: ContentClusterItem) {
    setPromotingId(item.id);
    const prev = data;
    if (prev) {
      void mutate(
        {
          ...prev,
          items: prev.items.map((i) =>
            i.id === item.id ? { ...i, status: "covered" as const } : i,
          ),
        },
        false,
      );
    }
    try {
      await promoteClusterItem(clusterId, item.id);
      toast.success("Promoted to topic queue");
      void mutate();
    } catch (err) {
      void mutate(prev, false);
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setPromotingId(null);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <h3 className="text-lg font-semibold">Couldn&apos;t load this cluster</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            {error ? humanizeAnalyticsError(error) : "It may have been deleted."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-snug">{data.title}</h3>
            {data.description && (
              <p className="mt-1 text-sm text-muted-foreground">{data.description}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => void handleDelete()}
            disabled={deleting}
            isLoading={deleting}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
            Spokes ({data.items.length})
          </p>
          {data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No spokes were proposed.</p>
          ) : (
            <ul className="space-y-2">
              {data.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.proposed_title}</p>
                    {item.focus_keyword && (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.focus_keyword}
                      </p>
                    )}
                  </div>
                  {item.status === "covered" ? (
                    <Badge variant="success">Covered</Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Proposed</Badge>
                      <Button
                        size="sm"
                        disabled={promotingId !== null}
                        isLoading={promotingId === item.id}
                        onClick={() => void handlePromote(item)}
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Promote
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
