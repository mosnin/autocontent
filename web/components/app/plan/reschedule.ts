"use client";

// Drag-and-drop rescheduling on the Plan calendar. Only items the backend
// marks `movable` (articles with a scheduled WordPress publish) can be dragged;
// a drop keeps the item's local time of day and moves it to the target day
// (PATCH /api/v1/articles/{id}/schedule). The move shows at once and is undone
// if the server refuses. Keyboard and touch users change the time from the
// article page's publish sheet.

import { useRouter } from "next/navigation";
import { type DragEvent, useCallback, useState } from "react";
import { proxyFetch } from "@/lib/proxy-fetch";
import { moveToDay } from "@/lib/seo";
import type { PlanItem } from "./plan-data";

const MIME = "application/x-marketer-plan-item";
const MIN_LEAD_MS = 3 * 60 * 1000;

export interface Reschedule {
  /** Items with any pending or confirmed local moves applied. */
  apply: (items: PlanItem[]) => PlanItem[];
  dragProps: (item: PlanItem) => Record<string, unknown>;
  dropProps: (day: string) => Record<string, unknown>;
  overDay: string | null;
  draggingId: string | null;
  error: string | null;
  clearError: () => void;
}

export function useReschedule(enabled = true): Reschedule {
  const router = useRouter();
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [draggingId, setDragging] = useState<string | null>(null);
  const [overDay, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((items: PlanItem[]) => items.map((it) => (moved[`${it.kind}:${it.id}`] ? { ...it, at: moved[`${it.kind}:${it.id}`]! } : it)), [moved]);

  const dragProps = (item: PlanItem) =>
    enabled && item.movable
      ? {
          draggable: true,
          "aria-roledescription": "draggable scheduled item",
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(MIME, JSON.stringify({ kind: item.kind, id: item.id, at: moved[`${item.kind}:${item.id}`] ?? item.at }));
            setDragging(item.id);
            setError(null);
          },
          onDragEnd: () => {
            setDragging(null);
            setOver(null);
          },
        }
      : {};

  const dropProps = (day: string) =>
    enabled
      ? {
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (overDay !== day) setOver(day);
          },
          onDragLeave: (e: DragEvent) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver((d) => (d === day ? null : d));
          },
          onDrop: (e: DragEvent) => {
            const raw = e.dataTransfer.getData(MIME);
            setOver(null);
            setDragging(null);
            if (!raw) return;
            e.preventDefault();
            const { kind, id, at } = JSON.parse(raw) as { kind: string; id: string; at: string };
            const target = moveToDay(at, day);
            if (target.getTime() === new Date(at).getTime()) return;
            if (target.getTime() < Date.now() + MIN_LEAD_MS) {
              setError("Pick a later day: that time has already passed.");
              return;
            }
            const key = `${kind}:${id}`;
            const before = moved[key];
            setMoved((m) => ({ ...m, [key]: target.toISOString() }));
            proxyFetch(`/api/v1/articles/${id}/schedule`, "PATCH", { publish_at: target.toISOString() })
              .then(() => router.refresh())
              .catch((err: unknown) => {
                setMoved((m) => {
                  const next = { ...m };
                  if (before) next[key] = before;
                  else delete next[key];
                  return next;
                });
                setError(err instanceof Error ? err.message : "Couldn't move it. Try again.");
              });
          },
        }
      : {};

  return { apply, dragProps, dropProps, overDay, draggingId, error, clearError: () => setError(null) };
}
