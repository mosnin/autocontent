// Client-safe typed client for brand personas (/api/v1/personas).
//
// Reads use SWR keys that are plain backend paths — `clientFetch` prefixes
// /api/proxy for us. Mutations go through the same /api/proxy/... handler so
// the Clerk JWT is attached server-side. NOTHING here may import server-only
// modules — this file runs in the browser.
//
// Shapes mirror `src/marketer/personas/schemas.py` field for field.
//
// SPEND NOTE: every POST to /messages and the one-shot /visual lock are
// metered provider calls. Nothing in this module may be retried automatically
// or fired without an explicit user action.

import { ApiError, clientFetch } from "@/lib/client-fetcher";

// --- Field bounds (mirrors the server-side schema bounds) --------------

export const MAX_NAME_CHARS = 80;
export const MAX_TAGLINE_CHARS = 200;
export const MAX_PERSONA_CHARS = 4_000;
export const MAX_GREETING_CHARS = 800;
export const MAX_VOICE_RULES_CHARS = 2_000;
export const MAX_BANNED_TOPICS = 40;
export const MAX_BANNED_TOPIC_CHARS = 120;
export const MAX_MESSAGE_CHARS = 4_000;

// --- Wire types --------------------------------------------------------

/** A persistent brand voice: who talks, how, and what they look like.
 *  Layers on top of the account brand kit rather than replacing it. */
export interface Persona {
  id: string;
  user_id: string;
  /** When set, this persona's spend is attributed to the niche and honors
   *  its daily cap. */
  niche_id: string | null;
  name: string;
  tagline: string;
  /** Backstory / personality brief. */
  persona: string;
  /** Shown as the opening line when the conversation is empty. */
  greeting: string;
  voice_rules: string;
  banned_topics: string[];
  /** Empty until the visual reference is locked. */
  visual_ref_path: string;
  /** Non-null once the reference image is locked (write-once). */
  visual_locked_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PersonaCreate {
  name: string;
  tagline: string;
  persona: string;
  greeting: string;
  voice_rules: string;
  banned_topics: string[];
  niche_id: string | null;
}

/** PUT body. Unset keys are left untouched server-side (exclude_unset). */
export type PersonaUpdate = Partial<PersonaCreate>;

export interface PersonaMessage {
  id: string;
  persona_id: string;
  user_id: string;
  /** 'user' | 'assistant' */
  role: string;
  content: string;
  created_at: string | null;
}

/** The result of one metered turn: both rows, already persisted. */
export interface PersonaTurn {
  user_message: PersonaMessage;
  assistant_message: PersonaMessage;
}

export function hasVisual(p: Persona): boolean {
  return Boolean(p.visual_ref_path && p.visual_locked_at);
}

// --- Read (SWR) --------------------------------------------------------

const PERSONAS = "/api/v1/personas";

export const personaKeys = {
  list: () => PERSONAS,
  detail: (id: string) => `${PERSONAS}/${encodeURIComponent(id)}`,
  messages: (id: string, limit = 50) =>
    `${PERSONAS}/${encodeURIComponent(id)}/messages?limit=${limit}`,
};

export const personasFetcher = clientFetch<Persona[]>;
export const personaMessagesFetcher = clientFetch<PersonaMessage[]>;

/**
 * Browser URL for the locked reference image (image/png through the proxy).
 * Only valid once `visual_locked_at` is set — otherwise the backend 404s.
 * The `v` cache-buster carries the lock timestamp so the <img> refreshes the
 * moment a lock lands.
 */
export function visualUrl(p: Persona): string {
  const v = p.visual_locked_at ? `?v=${encodeURIComponent(p.visual_locked_at)}` : "";
  return `/api/proxy${PERSONAS}/${encodeURIComponent(p.id)}/visual${v}`;
}

// --- Writes (proxy) ----------------------------------------------------

async function proxyMutate<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || `${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? ((await res.json()) as T) : (undefined as T);
}

export function createPersona(body: PersonaCreate): Promise<Persona> {
  return proxyMutate<Persona>(PERSONAS, "POST", body);
}

export function updatePersona(id: string, body: PersonaUpdate): Promise<Persona> {
  return proxyMutate<Persona>(`${PERSONAS}/${encodeURIComponent(id)}`, "PUT", body);
}

export function deletePersona(id: string): Promise<void> {
  return proxyMutate<void>(`${PERSONAS}/${encodeURIComponent(id)}`, "DELETE");
}

/**
 * Generate AND lock the persona's visual reference. One metered image call,
 * 202 with the updated persona. Write-once: a second call is a 409, because
 * published creative may already depend on that face.
 */
export function lockPersonaVisual(id: string): Promise<Persona> {
  return proxyMutate<Persona>(`${PERSONAS}/${encodeURIComponent(id)}/visual`, "POST");
}

/**
 * One metered chat turn. Never call this on the user's behalf — no auto-send,
 * no automatic retry. 402 means a spend cap refused the turn (the thread is
 * left exactly as it was); 429 is the per-IP rate limit.
 */
export function sendPersonaMessage(id: string, content: string): Promise<PersonaTurn> {
  return proxyMutate<PersonaTurn>(
    `${PERSONAS}/${encodeURIComponent(id)}/messages`,
    "POST",
    { content },
  );
}

/** Clear the conversation. The persona itself survives. */
export function clearPersonaMessages(id: string): Promise<void> {
  return proxyMutate<void>(`${PERSONAS}/${encodeURIComponent(id)}/messages`, "DELETE");
}

// --- Errors ------------------------------------------------------------

export function isSpendCapped(e: unknown): boolean {
  return e instanceof ApiError && e.status === 402;
}

export function isRateLimited(e: unknown): boolean {
  return e instanceof ApiError && e.status === 429;
}

export function personaErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "Too many messages in a minute — wait and try again.";
    const body = e.message.replace(/^\d+\s*/, "");
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === "string") return parsed.detail;
      if (Array.isArray(parsed.detail)) {
        const first = parsed.detail[0] as { msg?: string } | undefined;
        if (first?.msg) return first.msg;
      }
    } catch {
      /* not JSON — fall through */
    }
    return body || `Request failed (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

/** Trim, drop blanks, bound length + count, de-dupe case-insensitively —
 *  the same normalisation `clean_banned_topics` applies server-side, so the
 *  field shows the user what will actually be stored. */
export function cleanBannedTopics(topics: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of topics) {
    const topic = String(raw).split(/\s+/).filter(Boolean).join(" ").slice(
      0,
      MAX_BANNED_TOPIC_CHARS,
    );
    if (!topic) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
    if (out.length >= MAX_BANNED_TOPICS) break;
  }
  return out;
}
