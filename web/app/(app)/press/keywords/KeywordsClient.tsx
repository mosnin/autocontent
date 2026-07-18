"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Search, Sparkles, Tags, Trash2, X } from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  analyticsKeys,
  dismissKeyword,
  harvestKeywords,
  humanizeAnalyticsError,
  keywordsFetcher,
  promoteKeyword,
  scoreKeyword,
  trackKeyword,
  type KeywordCandidate,
  type KeywordStatus,
} from "@/lib/press-analytics-client";
import type { Niche } from "@/lib/types";

type Filter = KeywordStatus | "all";

const FILTERS: Filter[] = ["candidate", "tracked", "promoted", "dismissed", "all"];
const FILTER_LABEL: Record<Filter, string> = {
  candidate: "Candidates",
  tracked: "Tracked",
  promoted: "Promoted",
  dismissed: "Dismissed",
  all: "All",
};

export function KeywordsClient({
  initial,
  niches,
}: {
  initial: KeywordCandidate[];
  niches: Niche[];
}) {
  const active = niches.filter((n) => !n.archived_at);
  const [nicheId, setNicheId] = React.useState<string>(active[0]?.id ?? "");
  const [filter, setFilter] = React.useState<Filter>("candidate");
  const [harvesting, setHarvesting] = React.useState(false);

  const { data, mutate } = useSWR<KeywordCandidate[]>(
    analyticsKeys.keywords(),
    keywordsFetcher,
    { fallbackData: initial },
  );

  const all = data ?? [];
  const nicheTitles = React.useMemo(
    () => new Map(niches.map((n) => [n.id, n.title])),
    [niches],
  );

  const scoped = nicheId ? all.filter((c) => c.niche_id === nicheId) : all;
  const counts: Record<Filter, number> = {
    candidate: scoped.filter((c) => c.status === "candidate").length,
    tracked: scoped.filter((c) => c.status === "tracked").length,
    promoted: scoped.filter((c) => c.status === "promoted").length,
    dismissed: scoped.filter((c) => c.status === "dismissed").length,
    all: scoped.length,
  };
  const filtered = scoped
    .filter((c) => filter === "all" || c.status === filter)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  async function handleHarvest() {
    if (!nicheId) {
      toast.error("Pick a channel first");
      return;
    }
    setHarvesting(true);
    try {
      const created = await harvestKeywords(nicheId);
      toast.success(
        `Harvested ${created.length} keyword${created.length === 1 ? "" : "s"}`,
      );
      setFilter("candidate");
      void mutate();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setHarvesting(false);
    }
  }

  function replaceOne(updated: KeywordCandidate) {
    void mutate(
      (all ?? []).map((c) => (c.id === updated.id ? updated : c)),
      false,
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Keywords</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Harvest candidate keywords for a channel, score their SERP
          difficulty, and promote the ones worth writing about into the
          topic queue.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Channel</label>
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
          <Button onClick={handleHarvest} disabled={!nicheId || harvesting} isLoading={harvesting}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Harvest keywords
          </Button>
        </CardContent>
      </Card>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <ScrollArea>
          <TabsList className="w-max">
            {FILTERS.map((f) => (
              <TabsTrigger key={f} value={f}>
                {FILTER_LABEL[f]}
                <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {counts[f]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <TabsContent value={filter} className="mt-4">
          {filtered.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[1%]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <KeywordRow
                      key={c.id}
                      candidate={c}
                      nicheTitle={nicheTitles.get(c.niche_id)}
                      onUpdated={replaceOne}
                      onRevalidate={() => void mutate()}
                    />
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const copy: Record<Filter, { title: string; body: string }> = {
    candidate: {
      title: "No candidate keywords",
      body: "Pick a channel above and harvest a batch of candidate keywords.",
    },
    tracked: {
      title: "No tracked keywords",
      body: "Track a candidate worth watching and it shows up here.",
    },
    promoted: {
      title: "No promoted keywords",
      body: "Promote a keyword and it joins the topic approval queue.",
    },
    dismissed: {
      title: "No dismissed keywords",
      body: "Keywords you dismiss show up here.",
    },
    all: {
      title: "No keywords yet",
      body: "Pick a channel above and harvest your first batch of candidate keywords.",
    },
  };
  const { title, body } = copy[filter];
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

type RowAction = "score" | "track" | "dismiss" | "promote" | null;

function KeywordRow({
  candidate,
  nicheTitle,
  onUpdated,
  onRevalidate,
}: {
  candidate: KeywordCandidate;
  nicheTitle: string | undefined;
  onUpdated: (c: KeywordCandidate) => void;
  onRevalidate: () => void;
}) {
  const [pending, setPending] = React.useState<RowAction>(null);

  async function run(action: RowAction, fn: () => Promise<KeywordCandidate>, successMsg: string) {
    setPending(action);
    try {
      const updated = await fn();
      onUpdated(updated);
      toast.success(successMsg);
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setPending(null);
      onRevalidate();
    }
  }

  const busy = pending !== null;

  return (
    <TableRow>
      <TableCell className="max-w-[280px] truncate font-medium">{candidate.keyword}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{nicheTitle ?? "-"}</TableCell>
      <TableCell>
        {candidate.intent ? (
          <Badge variant="outline" className="font-normal">
            {candidate.intent}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <DifficultyBadge difficulty={candidate.difficulty} />
      </TableCell>
      <TableCell>
        <KeywordStatusBadge status={candidate.status} />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1.5">
          {(candidate.status === "candidate" || candidate.status === "tracked") && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              isLoading={pending === "score"}
              onClick={() =>
                void run("score", () => scoreKeyword(candidate.id), "Difficulty scored")
              }
            >
              Score
            </Button>
          )}
          {candidate.status === "candidate" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              isLoading={pending === "track"}
              onClick={() => void run("track", () => trackKeyword(candidate.id), "Tracking")}
            >
              <Tags className="h-3.5 w-3.5" aria-hidden="true" />
              Track
            </Button>
          )}
          {(candidate.status === "candidate" || candidate.status === "tracked") && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                disabled={busy}
                isLoading={pending === "dismiss"}
                onClick={() =>
                  void run("dismiss", () => dismissKeyword(candidate.id), "Dismissed")
                }
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Dismiss
              </Button>
              <Button
                size="sm"
                disabled={busy}
                isLoading={pending === "promote"}
                onClick={() =>
                  void run("promote", () => promoteKeyword(candidate.id), "Promoted to topic queue")
                }
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Promote
              </Button>
            </>
          )}
          {candidate.status === "dismissed" && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <X className="h-3 w-3" aria-hidden="true" />
              Dismissed
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: string | null }) {
  if (difficulty === null) {
    return (
      <span className="text-xs text-muted-foreground">Not scored</span>
    );
  }
  const n = Number(difficulty);
  const variant: BadgeVariant = n < 34 ? "success" : n < 67 ? "warning" : "destructive";
  return (
    <Badge variant={variant} className="font-mono">
      {Math.round(n)}
    </Badge>
  );
}

function KeywordStatusBadge({ status }: { status: KeywordStatus }) {
  if (status === "tracked") return <Badge variant="info">Tracked</Badge>;
  if (status === "promoted") return <Badge variant="success">Promoted</Badge>;
  if (status === "dismissed") return <Badge variant="secondary">Dismissed</Badge>;
  return <Badge variant="outline">Candidate</Badge>;
}
