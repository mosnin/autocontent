// Browser client for /api/v1/memory, through the same-origin proxy (the
// backend JWT is attached server-side). The tenant is the signed-in user;
// nothing here names one.

import { proxyFetch } from "@/lib/proxy-fetch";
import type { MemoryFact, RecallItem, RecallScope, RecallSettings } from "./types";

const BASE = "/api/v1/memory";
const id = (factId: string) => encodeURIComponent(factId);

export const fetchHistory = (factId: string) => proxyFetch<{ items: MemoryFact[] }>(`${BASE}/facts/${id(factId)}/history`, "GET").then((r) => r.items);
export const confirmFact = (factId: string) => proxyFetch<MemoryFact>(`${BASE}/facts/${id(factId)}/confirm`, "POST");
export const forgetFact = (factId: string) => proxyFetch<void>(`${BASE}/facts/${id(factId)}/forget`, "POST");
export const correctFact = (factId: string, value: string) => proxyFetch<{ status: string; fact: MemoryFact | null }>(`${BASE}/facts/${id(factId)}/correct`, "POST", { value });

// Recall. No call names a person or a namespace: the backend derives both from the session.

export const previewForget = (scope: RecallScope, query: string) => proxyFetch<{ matches: RecallItem[] }>(`${BASE}/${scope}/forget/preview`, "POST", { query }).then((r) => r.matches);
export const forgetRecall = (scope: RecallScope, ids: string[]) => proxyFetch<{ forgotten: number; failed: number }>(`${BASE}/${scope}/forget`, "POST", { ids });
export const saveRecallSettings = (enabled: boolean, deleteData = false) => proxyFetch<RecallSettings & { queued_deletes: number }>(`${BASE}/recall/settings`, "PUT", { enabled, delete_data: deleteData });
