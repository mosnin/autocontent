"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Composer } from "@/design-system";
import { departmentById, type DepartmentId } from "@/lib/departments";
import { useAgent } from "@/components/chat/agent-provider";
import { queueFirstMessage } from "./session-queue";
import { AgentPicker } from "./agent-picker";

/**
 * A composer that opens a new session: creates the conversation on the agent
 * harness, queues the first message, then navigates to it.
 */
export function StartSession({ scope: initial = null, lockScope, autoStart, size = "chat", autoFocus, className }: { scope?: DepartmentId | null; lockScope?: boolean; autoStart?: string; size?: "chat" | "hero"; autoFocus?: boolean; className?: string }) {
  const router = useRouter();
  const { state, threads } = useAgent();
  const [scope, setScope] = useState<DepartmentId | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auto = useRef(false);

  const start = async (text: string) => {
    if (state.status !== "ready" || !threads) {
      router.push(`/sessions/new?q=${encodeURIComponent(text)}${scope ? `&dept=${scope}` : ""}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await threads.create({ title: text.slice(0, 72) });
      queueFirstMessage(id, text, scope);
      router.push(`/sessions/${encodeURIComponent(id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a session");
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoStart && threads && !auto.current) {
      auto.current = true;
      void start(autoStart);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, threads]);

  return (
    <div className={className}>
      <Composer
        size={size}
        autoFocus={autoFocus}
        busy={busy}
        disabled={busy}
        onSubmit={(t) => void start(t)}
        agent={{ name: "Marketer", note: "Routes each request" }}
        agentPicker={<AgentPicker value={scope} onChange={setScope} locked={lockScope} />}
        placeholder={departmentById(scope)?.placeholder ?? "Ask Marketer to plan, make, post or scale… or @ to add context"}
      />
      {error && <p className="mt-2 text-[12.5px] text-negative">{error}</p>}
    </div>
  );
}
