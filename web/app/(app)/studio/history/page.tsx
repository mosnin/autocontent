"use client";

import * as React from "react";
import useSWR from "swr";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
import { clientFetch } from "@/lib/client-fetcher";
import {
  deleteGeneration,
  studioKeys,
  type GenerationPage,
  type StudioGeneration,
  type StudioKind,
} from "@/lib/studio/client";

const KINDS: { value: StudioKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "lipsync", label: "Lip sync" },
  { value: "video2video", label: "Video to video" },
  { value: "recast", label: "Recast" },
];

const STATUS_VARIANT: Record<
  StudioGeneration["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  running: "secondary",
  done: "default",
  failed: "destructive",
};

export default function StudioHistory() {
  const [kind, setKind] = React.useState<StudioKind | "all">("all");
  const [cursors, setCursors] = React.useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const key = studioKeys.generations(
    kind === "all" ? undefined : kind,
    50,
    cursor,
  );
  const { data, isLoading, mutate } = useSWR<GenerationPage>(key, clientFetch, {
    refreshInterval: (page) =>
      page?.items?.some((g) => g.status === "queued" || g.status === "running")
        ? 3000
        : 0,
    keepPreviousData: true,
  });

  const items = data?.items ?? [];

  const remove = async (id: string) => {
    await deleteGeneration(id);
    await mutate();
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="text-sm text-muted-foreground">
          Every Studio generation on this account, newest first. Stored
          server-side, so it is the same list on every device.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((option) => (
          <Button
            key={option.value}
            onClick={() => {
              setKind(option.value);
              setCursors([]);
            }}
            size="sm"
            variant={kind === option.value ? "default" : "outline"}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {isLoading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing generated yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((generation) => (
                <TableRow key={generation.id}>
                  <TableCell className="font-medium">
                    {generation.model}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {generation.kind}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[generation.status]}>
                      {generation.status}
                    </Badge>
                    {generation.error ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {generation.error}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    ${Number(generation.cost_usd).toFixed(3)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(generation.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {generation.outputs[0] ? (
                        <Button asChild size="sm" variant="outline">
                          <a
                            download
                            href={generation.outputs[0].url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Download
                          </a>
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => void remove(generation.id)}
                        size="sm"
                        variant="ghost"
                      >
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          disabled={cursors.length === 0}
          onClick={() => setCursors((c) => c.slice(0, -1))}
          size="sm"
          variant="outline"
        >
          Previous
        </Button>
        <Button
          disabled={!data?.next_cursor}
          onClick={() =>
            setCursors((c) => (data?.next_cursor ? [...c, data.next_cursor] : c))
          }
          size="sm"
          variant="outline"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
