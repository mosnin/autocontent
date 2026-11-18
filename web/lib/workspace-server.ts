import "server-only";

import { api } from "./api";
import type { Activity, DecisionPage, Inbox, Overview } from "./workspace";

/** Server-side fetch that never throws: pages render their empty state instead of a 500. */
export async function safe<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch {
    return null;
  }
}

export const getOverview = (days = 30) => safe<Overview>(`/api/v1/workspace/overview?days=${days}`);
export const getInbox = () => safe<Inbox>("/api/v1/workspace/inbox");
export const getActivity = (limit = 50, before?: string) =>
  safe<Activity>(`/api/v1/workspace/activity?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`);

export const getDecisions = (limit = 50, cursor?: string) => safe<DecisionPage>(`/api/v1/decisions?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
