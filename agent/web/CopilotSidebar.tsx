// Mount the copilot in your app shell. `context` is sent with each message so the agent knows what the user sees.
"use client";
import { AgentSidebar } from "@agent-starter/react";
import "@agent-starter/react/styles.css";
import { createFlueClient } from "@flue/sdk";
import { useMemo, useRef } from "react";

export function CopilotSidebar({ sessionToken, conversationId, page }: { sessionToken: string; conversationId: string; page: { path: string; title: string; entityId?: string } }) {
  const origin = process.env.NEXT_PUBLIC_AGENT_ORIGIN ?? "http://localhost:5173";
  // The current page travels as a validated, size-limited header (src/lib/app-context.ts) and becomes
  // initialData.context server-side; the ref keeps the client stable while the user navigates.
  const pageRef = useRef(page);
  pageRef.current = page;
  const client = useMemo(
    () =>
      createFlueClient({
        url: `${origin}/agents/copilot/${conversationId}`,
        token: sessionToken,
        headers: () => ({ "x-agent-context": encodeURIComponent(JSON.stringify(pageRef.current)) }),
      }),
    [origin, conversationId, sessionToken],
  );
  return (
    <AgentSidebar
      client={client}
      title="Copilot"
      context={page}
      quickActions={[
        { id: "summarize", label: "Summarize this page", prompt: "Summarize what is on this page and anything that needs my attention." },
        { id: "changes", label: "What changed this week?", prompt: "What changed in this workspace over the last 7 days?" },
        { id: "task", label: "Create a follow-up task", prompt: "Create a follow-up task for the record on this page." },
      ]}
    />
  );
}
