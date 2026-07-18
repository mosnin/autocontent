"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Lightbulb, Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  approveTopic,
  humanizePressError,
  pressKeys,
  generateTopics,
  rejectTopic,
  topicsFetcher,
} from "@/lib/press-client";
import type { Niche, TopicProposal, TopicStatus } from "@/lib/types";

type Filter = "pending" | "approved" | "rejected" | "all";

function matches(t: TopicProposal, filter: Filter): boolean {
  if (filter === "all") return true;
  return t.status === filter;
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function TopicsClient({
  initial,
  niches,
}: {
  initial: TopicProposal[];
  niches: Niche[];
}) {
  const active = niches.filter((n) => !n.archived_at);
  const [nicheId, setNicheId] = React.useState<string>(active[0]?.id ?? "");
  const [filter, setFilter] = React.useState<Filter>("pending");
  const [generating, setGenerating] = React.useState(false);

  const { data, mutate } = useSWR<TopicProposal[]>(
    pressKeys.topics({ limit: 200 }),
    topicsFetcher,
    { fallbackData: initial },
  );

  const topics = data ?? [];
  const nicheTitles = React.useMemo(
    () => new Map(niches.map((n) => [n.id, n.title])),
    [niches],
  );

  const counts: Record<Filter, number> = {
    pending: topics.filter((t) => t.status === "pending").length,
    approved: topics.filter((t) => t.status === "approved").length,
    rejected: topics.filter((t) => t.status === "rejected").length,
    all: topics.length,
  };

  const filtered = topics
    .filter((t) => matches(t, filter))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  async function handleGenerate() {
    if (!nicheId) {
      toast.error("Pick a channel first");
      return;
    }
    setGenerating(true);
    try {
      const created = await generateTopics(nicheId);
      toast.success(
        `Generated ${created.length} topic${created.length === 1 ? "" : "s"}`,
      );
      setFilter("pending");
      void mutate();
    } catch (err) {
      toast.error(humanizePressError(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleDecide(topic: TopicProposal, decision: TopicStatus) {
    const prev = topics;
    void mutate(
      prev.map((t) => (t.id === topic.id ? { ...t, status: decision } : t)),
      false,
    );
    try {
      if (decision === "approved") await approveTopic(topic.id);
      else await rejectTopic(topic.id);
      toast.success(decision === "approved" ? "Approved" : "Rejected");
      void mutate();
    } catch (err) {
      void mutate(prev, false);
      toast.error(humanizePressError(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Topics</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Propose candidate topics for a channel, then approve the ones
            worth writing. Approved topics feed the autopilot: it drafts the
            oldest approved topic first, so this queue is the plan.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Channel
            </label>
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
          <Button onClick={handleGenerate} disabled={!nicheId || generating} isLoading={generating}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Generate topics
          </Button>
        </CardContent>
      </Card>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <ScrollArea>
          <TabsList className="w-max">
            <TabsTrigger value="pending">
              Pending
              <TabCount value={counts.pending} />
            </TabsTrigger>
            <TabsTrigger value="approved">
              Approved
              <TabCount value={counts.approved} />
            </TabsTrigger>
            <TabsTrigger value="rejected">
              Rejected
              <TabCount value={counts.rejected} />
            </TabsTrigger>
            <TabsTrigger value="all">
              All
              <TabCount value={counts.all} />
            </TabsTrigger>
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <TabsContent value={filter} className="mt-4">
          {filtered.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((t) => (
                <TopicCard
                  key={t.id}
                  topic={t}
                  nicheTitle={nicheTitles.get(t.niche_id)}
                  onApprove={() => handleDecide(t, "approved")}
                  onReject={() => handleDecide(t, "rejected")}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TabCount({ value }: { value: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {value}
    </span>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const copy: Record<Filter, { title: string; body: string }> = {
    pending: {
      title: "No pending topics",
      body: "Pick a channel above and generate a batch of candidate topics.",
    },
    approved: {
      title: "No approved topics yet",
      body: "Approve a pending topic and it joins the autopilot's plan. It drafts the oldest approved topic first.",
    },
    rejected: {
      title: "No rejected topics",
      body: "Topics you reject, or that autopilot has already consumed, show up here.",
    },
    all: {
      title: "No topics yet",
      body: "Pick a channel above and generate your first batch of candidate topics.",
    },
  };
  const { title, body } = copy[filter];
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Lightbulb className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

function TopicCard({
  topic,
  nicheTitle,
  onApprove,
  onReject,
}: {
  topic: TopicProposal;
  nicheTitle: string | undefined;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [deciding, setDeciding] = React.useState<"approve" | "reject" | null>(null);
  const scorePct = Math.round(Math.max(0, Math.min(1, topic.score)) * 100);

  async function decide(kind: "approve" | "reject") {
    setDeciding(kind);
    await (kind === "approve" ? onApprove() : onReject());
    setDeciding(null);
  }

  return (
    <Card className="p-4">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug">
            {topic.title}
          </h3>
          <StatusBadge status={topic.status} />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {topic.focus_keyword && (
            <Badge variant="outline" className="font-normal">
              {topic.focus_keyword}
            </Badge>
          )}
          {nicheTitle && <span>{nicheTitle}</span>}
          <span>{relative(topic.created_at)}</span>
        </div>

        {topic.rationale && (
          <p className="text-sm text-muted-foreground">{topic.rationale}</p>
        )}

        <div className="flex items-center gap-2">
          <Progress value={scorePct} className="flex-1" aria-label="Confidence score" />
          <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {scorePct}%
          </span>
        </div>

        {topic.status === "pending" && (
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void decide("reject")}
              disabled={deciding !== null}
              isLoading={deciding === "reject"}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => void decide("approve")}
              disabled={deciding !== null}
              isLoading={deciding === "approve"}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Approve
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: TopicStatus }) {
  if (status === "approved") return <Badge variant="success">Approved</Badge>;
  if (status === "rejected") return <Badge variant="secondary">Rejected</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}
