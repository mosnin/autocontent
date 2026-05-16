// Thin client around the Modal FastAPI backend. Each call attaches the
// Clerk session JWT as a Bearer token; the backend's clerk middleware
// verifies it and upserts the user row.

import { auth } from "@clerk/nextjs/server";

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
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
