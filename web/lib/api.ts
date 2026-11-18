// Thin client around the Modal FastAPI backend. Each call attaches the
// Clerk session JWT as a Bearer token; the backend's clerk middleware
// verifies it and upserts the user row.

import { auth } from "@clerk/nextjs/server";

import { publicApiError } from "./security/urls";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { getToken } = await auth();
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  // The message reaches the browser through server-action results, so it is
  // "<status> <bounded detail>", never the raw upstream body. Callers match on
  // the status prefix ("403", "404").
  if (!res.ok) throw new Error(publicApiError(res.status, await res.text().catch(() => "")));
  return res.json() as Promise<T>;
}
