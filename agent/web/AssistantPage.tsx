// Drop into your React app (Next.js / Vite / Remix). Install: @agent-starter/react, @flue/sdk.
// The session token is minted by YOUR backend (see web/host-routes.example.ts in this project).
"use client";
import { AgentChat, ThreadList, useThreads } from "@agent-starter/react";
import "@agent-starter/react/styles.css";
import { useEffect, useMemo, useState } from "react";
import { createFlueClient } from "@flue/sdk";

const AGENT_ORIGIN = process.env.NEXT_PUBLIC_AGENT_ORIGIN ?? "http://localhost:5173";

/**
 * ChatGPT-style page: thread history on the left (GET/POST/DELETE /api/assistant/conversations,
 * scoped server-side to the signed-in user + tenant), the selected conversation on the right.
 * Approval and ask_person cards in the transcript post to their signed links with the session token.
 */
export default function AssistantPage({ sessionToken }: { sessionToken: string }) {
  const threads = useThreads({ endpoint: `${AGENT_ORIGIN}/api/assistant`, token: sessionToken });
  const [conversationId, setConversationId] = useState<string>();

  // Open the most recent thread, or start one when the user has none yet.
  useEffect(() => {
    if (conversationId || threads.loading) return;
    const latest = threads.threads[0];
    if (latest) setConversationId(latest.conversationId);
    else if (!threads.error) void threads.create().then(setConversationId, () => undefined);
  }, [conversationId, threads.loading, threads.threads, threads.error, threads.create]);

  const client = useMemo(() => (conversationId ? createFlueClient({ url: `${AGENT_ORIGIN}/agents/assistant/${encodeURIComponent(conversationId)}`, token: sessionToken }) : undefined), [conversationId, sessionToken]);

  const startNew = () => void threads.create().then(setConversationId, () => undefined);
  const remove = (id: string) =>
    void threads.remove(id).then(() => {
      if (id === conversationId) setConversationId(undefined);
    }, () => undefined);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(14rem, 18rem) 1fr", height: "100vh" }}>
      <ThreadList threads={threads.threads} activeId={conversationId} onSelect={setConversationId} onNew={startNew} onDelete={remove} loading={threads.loading} error={threads.error} />
      {client ? (
        <AgentChat
          key={conversationId}
          client={client}
          title="Assistant"
          approvals={{ token: sessionToken, credentials: "include" }}
          suggestedPrompts={["Summarize this week's release notes", "Compare our pricing with competitors", "Plan a launch checklist"]}
        />
      ) : (
        <div />
      )}
    </div>
  );
}
