"use client";

import { createContext, useContext } from "react";
import type { MarketerKind, MarketerObject, Member, Resolved, RowPage, TrackerTable, TrackerTableSummary } from "@/lib/tracker";

/** What every tracker view needs to show and edit cells. */
export interface TrackerCtx {
  table: TrackerTable;
  tables: TrackerTableSummary[];
  members: Member[];
  resolved: Resolved;
  canEdit: boolean; // content:update
  canDelete: boolean; // content:delete
  canManage: boolean; // playbook:update
  preview: boolean;
  /** Pick lists for link fields: the preview answers from fixtures, the app from the API. */
  searchObjects: (kind: MarketerKind, q: string) => Promise<MarketerObject[]>;
  linkedRows: (tableId: string) => Promise<RowPage & { table?: TrackerTable }>;
}

export const TrackerContext = createContext<TrackerCtx | null>(null);

export function useTracker(): TrackerCtx {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error("useTracker outside TrackerContext");
  return ctx;
}
