"use client";

import * as React from "react";
import useSWR from "swr";

import { clientFetch } from "@/lib/client-fetcher";
import {
  createGeneration,
  deleteGeneration,
  studioKeys,
  type GenerationPage,
  type StudioGeneration,
  type StudioKind,
  type StudioModel,
} from "./client";

/** How often we re-read the history while a generation is still running. */
const POLL_MS = 3000;

const isPending = (g: StudioGeneration) =>
  g.status === "queued" || g.status === "running";

/**
 * The models this account can actually run for a kind. Empty means the
 * provider for that class isn't configured — surfaces say so rather than
 * offering a picker that can't submit.
 */
export function useStudioModels(kind: StudioKind) {
  const { data, error, isLoading } = useSWR<StudioModel[]>(
    studioKeys.models(kind),
    clientFetch,
    { revalidateOnFocus: false },
  );
  return { models: data ?? [], error, isLoading };
}

/**
 * A studio's runs: server-side history plus submit/delete.
 *
 * History is the single source of truth for pending work — a queued row
 * survives a reload, a tab close, and a device change, and polling resumes
 * on its own because the list itself is what polls. Nothing about a
 * generation lives in browser storage.
 */
export function useStudioRuns(kind: StudioKind, limit = 30) {
  const key = studioKeys.generations(kind, limit);
  const { data, error, isLoading, mutate } = useSWR<GenerationPage>(
    key,
    clientFetch,
    {
      refreshInterval: (page) =>
        page?.items?.some(isPending) ? POLL_MS : 0,
      keepPreviousData: true,
    },
  );

  const runs = data?.items ?? [];
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const submit = React.useCallback(
    async (model: string, params: Record<string, unknown>) => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        const generation = await createGeneration({ kind, model, params });
        // Show the queued row immediately, then let the poll take over.
        await mutate(
          (current) => ({
            items: [generation, ...(current?.items ?? [])].slice(0, limit),
            next_cursor: current?.next_cursor ?? null,
          }),
          { revalidate: false },
        );
        return generation;
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [kind, limit, mutate],
  );

  const remove = React.useCallback(
    async (id: string) => {
      await mutate(
        async (current) => {
          await deleteGeneration(id);
          return {
            items: (current?.items ?? []).filter((g) => g.id !== id),
            next_cursor: current?.next_cursor ?? null,
          };
        },
        { revalidate: false },
      );
    },
    [mutate],
  );

  return {
    runs,
    latest: runs[0] ?? null,
    pending: runs.filter(isPending),
    isLoading,
    error,
    submit,
    submitting,
    submitError,
    clearSubmitError: () => setSubmitError(null),
    remove,
    refresh: mutate,
  };
}

/**
 * Remembered UI preference (last model, last aspect ratio). Preferences are
 * the only thing we keep client-side — never generations, never results.
 */
export function useStudioPreference(
  name: string,
  fallback: string,
): [string, (next: string) => void] {
  const storageKey = `studio.${name}`;
  const [value, setValue] = React.useState(fallback);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) setValue(stored);
    } catch {
      /* storage unavailable (private mode) — the fallback stands */
    }
  }, [storageKey]);

  const update = React.useCallback(
    (next: string) => {
      setValue(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* storage unavailable — the choice still applies this session */
      }
    },
    [storageKey],
  );

  return [value, update];
}
