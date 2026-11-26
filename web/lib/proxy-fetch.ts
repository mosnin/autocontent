"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-run the server fetch on an interval while the tab is visible (live lists). */
export function useAutoRefresh(ms: number) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(t);
  }, [ms, router]);
}

/** Generic proxy mutation: fetch /api/proxy{path}, throw a readable error, parse JSON. */
export async function proxyFetch<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(", ");
    } catch {
      /* not JSON */
    }
    throw new Error(msg.slice(0, 200) || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? await res.json() : undefined) as T;
}
