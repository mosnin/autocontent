// Adapted from livekit-examples/agent-starter-react `hooks/useAgentErrors.tsx` (commit 9e1fc2f).
// MIT License, Copyright (c) 2025 LiveKit, Inc. See ./THIRD_PARTY_NOTICES.md for the full notice.
// Changes: no toast library; the failure reasons are returned for our own UI, and the session is
// ended once per failure.
import { useAgent, useSessionContext } from "@livekit/components-react";
import { useEffect, useRef, useState } from "react";

/** When the agent fails (never joined, crashed), end the session and surface LiveKit's reasons. */
export function useVoiceErrors(): string[] {
  const agent = useAgent();
  const { isConnected, end } = useSessionContext();
  const [reasons, setReasons] = useState<string[]>([]);
  const handled = useRef(false);
  useEffect(() => {
    if (isConnected && agent.state === "failed" && !handled.current) {
      handled.current = true;
      setReasons(agent.failureReasons ?? ["The voice agent did not respond."]);
      void end();
    }
    if (agent.state !== "failed") handled.current = false;
  }, [agent.state, agent.failureReasons, isConnected, end]);
  return reasons;
}
