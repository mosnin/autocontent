"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CREATIVE_FORMATS,
  productionRequest,
  type LibraryPage,
} from "@/lib/production";

export function FormatSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProductionLibrary() {
  const [format, setFormat] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const [page, setPage] = useState<LibraryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const request = ++sequence.current;
      setBusy(true);
      setError("");
      const params = new URLSearchParams({
        collection: "creatives",
        search: query,
      });
      if (format !== "all") params.set("kind", format);
      if (cursor) params.set("cursor", cursor);
      if (unassigned) params.set("campaign_id", "unassigned");
      try {
        const next = await productionRequest<LibraryPage>(`?${params}`);
        if (request !== sequence.current) return;
        setPage((previous) =>
          cursor && previous
            ? {
                ...next,
                items: [
                  ...previous.items,
                  ...next.items.filter(
                    (i) => !previous.items.some((old) => old.id === i.id),
                  ),
                ],
              }
            : next,
        );
      } catch (cause) {
        if (request === sequence.current) setError((cause as Error).message);
      } finally {
        if (request === sequence.current) setBusy(false);
      }
    },
    [format, query, unassigned],
  );
  useEffect(() => {
    setPage(null);
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <p className="text-sm text-foreground/75">Campaigns / Production</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Make the next handoff clear.
          </h1>
          <p className="text-foreground/75">
            Brief, review and approve the work you have made. Keep required
            inputs, company context and results with each creative.
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </header>
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
          Search creatives
          <Input
            className="min-h-11"
            placeholder="Search by title"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={160}
          />
        </label>
        <div className="w-44 space-y-2">
          <p className="text-sm">Format</p>
          <FormatSelect
            label="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: "all", label: "All formats" },
              ...CREATIVE_FORMATS.map((value) => ({
                value,
                label: value.replaceAll("-", " "),
              })),
            ]}
          />
        </div>
        <Button type="submit" variant="outline" className="min-h-11">
          Search
        </Button>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unassigned}
            onChange={(e) => setUnassigned(e.target.checked)}
          />
          Without a campaign
        </label>
      </form>
      {error && (
        <div role="alert" className="rounded-xl border border-destructive p-4">
          <p>{error}</p>
          <Button
            variant="outline"
            className="mt-3 min-h-11"
            onClick={() => void load(page?.nextCursor ?? undefined)}
          >
            Try again
          </Button>
        </div>
      )}
      {busy && !page && (
        <p role="status" className="text-foreground/75">
          Loading your creative library…
        </p>
      )}
      {page?.items.length === 0 && (
        <div className="space-y-3 rounded-2xl border p-8">
          <h2 className="text-xl font-medium">
            {query || format !== "all" || unassigned
              ? "No matching creatives"
              : "Your production workspace starts with a creative"}
          </h2>
          <p className="text-foreground/75">
            Generate an article, video, image or ad in Marketer, then return
            here to prepare it for delivery.
          </p>
          <Link
            className="inline-block min-h-11 py-2 underline"
            href="/campaigns"
          >
            Open campaigns
          </Link>
        </div>
      )}
      <ul className="divide-y rounded-2xl border bg-card">
        {page?.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-4 p-5"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Link
                href={`/production/${item.id.replace(":", "/")}`}
                className="break-words font-medium hover:underline"
              >
                {item.title}
              </Link>
              <p className="text-sm text-foreground/75">
                {item.kind.replaceAll("-", " ")} ·{" "}
                {item.status.replaceAll("_", " ")}
                {!item.campaignIds.length ? " · No campaign assigned" : ""}
              </p>
              <p className="text-xs text-foreground/75">
                Updated {new Date(item.updatedAt).toLocaleString()}
              </p>
            </div>
            <Link
              href={`/production/${item.id.replace(":", "/")}`}
              className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm hover:bg-accent"
            >
              Open production brief
            </Link>
          </li>
        ))}
      </ul>
      {page?.nextCursor ? (
        <Button
          variant="outline"
          className="min-h-11 self-start"
          disabled={busy}
          onClick={() => void load(page.nextCursor ?? undefined)}
        >
          {busy ? "Loading…" : "Load more"}
        </Button>
      ) : (
        page &&
        page.items.length > 0 && (
          <p className="text-sm text-foreground/75">
            All matching creatives loaded.
          </p>
        )
      )}
    </div>
  );
}
