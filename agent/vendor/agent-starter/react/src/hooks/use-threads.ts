import { useCallback, useEffect, useRef, useState } from "react";

/** One past conversation, as `GET <endpoint>/conversations` returns it (`createConversationRoute`). */
export interface ThreadSummary {
  conversationId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UseThreadsOptions {
  /**
   * Base URL of the agent's conversation API (where `createConversationRoute`
   * is mounted), e.g. `https://agents.example.com/api/assistant`.
   */
  endpoint: string;
  /** Session token sent as `Authorization: Bearer`. */
  token?: string;
  /** Custom fetch (auth wrappers, tests). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra request headers, static or resolved per request. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  credentials?: RequestCredentials;
  /** Load the list on mount (default `true`). */
  autoLoad?: boolean;
}

export interface UseThreadsResult {
  /** Newest first. */
  threads: ThreadSummary[];
  loading: boolean;
  error: Error | null;
  /** False when the server has no conversation index configured. */
  indexed: boolean;
  refresh(): Promise<void>;
  /** Mint a new conversation (optionally titled) and return its id. */
  create(options?: { title?: string; sessionKey?: string }): Promise<string>;
  /** Hide a conversation from the list. */
  remove(conversationId: string): Promise<void>;
}

function isThread(value: unknown): value is ThreadSummary {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.conversationId === "string" && typeof v.createdAt === "number" && typeof v.updatedAt === "number" && (v.title === undefined || typeof v.title === "string");
}

async function failure(response: Response, what: string): Promise<Error> {
  let message = `${what} failed with HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.message === "string") message = body.message;
    else if (typeof body.error === "string") message = body.error;
  } catch {
    // keep the generic message
  }
  return new Error(message);
}

/**
 * Thread history for a ChatGPT-style sidebar: lists the signed-in user's
 * conversations with one agent, mints new ones and hides old ones. The server
 * scopes everything to the session's tenant + user.
 */
export function useThreads(options: UseThreadsOptions): UseThreadsResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [indexed, setIndexed] = useState(true);
  const generation = useRef(0);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const { endpoint, token, credentials, headers } = optionsRef.current;
    const extra = typeof headers === "function" ? await headers() : (headers ?? {});
    const doFetch = optionsRef.current.fetch ?? globalThis.fetch.bind(globalThis);
    return doFetch(`${endpoint.replace(/\/+$/, "")}${path}`, {
      ...init,
      credentials: credentials ?? "same-origin",
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    });
  }, []);

  const refresh = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const response = await request("/conversations");
      if (!response.ok) throw await failure(response, "Loading conversations");
      const body = (await response.json()) as { conversations?: unknown; indexed?: unknown };
      if (run !== generation.current) return;
      setThreads(Array.isArray(body.conversations) ? body.conversations.filter(isThread) : []);
      setIndexed(body.indexed !== false);
    } catch (cause) {
      if (run === generation.current) setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, [request]);

  const create = useCallback(
    async (input: { title?: string; sessionKey?: string } = {}) => {
      const response = await request("/conversations", { method: "POST", body: JSON.stringify(input) });
      if (!response.ok) throw await failure(response, "Creating a conversation");
      const body = (await response.json()) as { conversationId?: unknown };
      if (typeof body.conversationId !== "string") throw new Error("The server did not return a conversation id");
      const now = Date.now();
      const id = body.conversationId;
      setThreads((previous) => [{ conversationId: id, createdAt: now, updatedAt: now, ...(input.title ? { title: input.title } : {}) }, ...previous.filter((t) => t.conversationId !== id)]);
      return id;
    },
    [request],
  );

  const remove = useCallback(
    async (conversationId: string) => {
      const response = await request(`/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
      if (!response.ok) throw await failure(response, "Removing the conversation");
      setThreads((previous) => previous.filter((t) => t.conversationId !== conversationId));
    },
    [request],
  );

  const { autoLoad = true, endpoint, token } = options;
  useEffect(() => {
    if (autoLoad) void refresh();
  }, [autoLoad, endpoint, token, refresh]);

  return { threads, loading, error, indexed, refresh, create, remove };
}
