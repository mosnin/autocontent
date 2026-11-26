"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAllowed } from "@/design-system";
import { useThreads, type UseThreadsResult } from "@/lib/agent/use-threads";

/** Marketer's orchestrator identity in agent/ (the chat module's mount). */
export const ORCHESTRATOR = "assistant";

type AgentState =
  | { status: "loading" }
  | { status: "offline"; reason: "not-configured" | "error" | "forbidden" }
  | { status: "ready"; origin: string; token: string; expiresAt: number };

interface AgentContextValue {
  state: AgentState;
  threads: UseThreadsResult | null;
  /** Conversation URL for the Flue client. */
  conversationUrl: (conversationId: string) => string | undefined;
  refresh: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  // A role without agent:chat never asks for a token (the server would refuse it anyway).
  const canChat = useAllowed("agent:chat");
  const [state, setState] = useState<AgentState>(canChat ? { status: "loading" } : { status: "offline", reason: "forbidden" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    if (!canChat) {
      setState({ status: "offline", reason: "forbidden" });
      return;
    }
    try {
      const res = await fetch("/api/agent/session", { cache: "no-store" });
      if (res.status === 403 && ((await res.json().catch(() => null)) as { error?: string } | null)?.error === "forbidden") {
        setState({ status: "offline", reason: "forbidden" });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { configured: boolean; origin?: string; token?: string; expiresAt?: number };
      if (!body.configured || !body.origin || !body.token || !body.expiresAt) {
        setState({ status: "offline", reason: "not-configured" });
        return;
      }
      setState({ status: "ready", origin: body.origin, token: body.token, expiresAt: body.expiresAt });
      // Refresh five minutes before expiry so long sessions never drop.
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), Math.max(30_000, body.expiresAt - Date.now() - 5 * 60_000));
    } catch {
      setState({ status: "offline", reason: "error" });
    }
  }, [canChat]);

  useEffect(() => {
    void load();
    return () => clearTimeout(timer.current);
  }, [load]);

  const ready = state.status === "ready" ? state : null;
  const threadsResult = useThreads({ endpoint: ready ? `${ready.origin}/api/${ORCHESTRATOR}` : "about:blank", token: ready?.token, autoLoad: Boolean(ready) });

  const value = useMemo<AgentContextValue>(
    () => ({
      state,
      threads: ready ? threadsResult : null,
      conversationUrl: (id) => (ready ? `${ready.origin}/agents/${ORCHESTRATOR}/${encodeURIComponent(id)}` : undefined),
      refresh: () => void load(),
    }),
    [state, ready, threadsResult, load],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent() must be used inside <AgentProvider>");
  return ctx;
}
