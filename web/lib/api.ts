// Thin client around the Modal FastAPI backend. Each call attaches a
// backend JWT minted on the server for this session (lib/auth/backend-token.ts);
// the backend verifies it against web's JWKS and reads the live session and
// membership from the auth schema.

import { mintBackendToken } from "./auth/backend-token";

import { publicApiError } from "./security/urls";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await mintBackendToken();
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
