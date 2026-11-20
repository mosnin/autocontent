// Live view of a collaboration room: the chat timeline, a Gantt of who worked when (with hand-off edges), and a
// per-agent transcript drill-down.
//  - Default: a WebSocket straight from the room Durable Object. History arrives on connect as TelemetryEvents,
//    so a reopened page shows the whole room, not only what happened after it connected.
//  - With `pusher` (your pusher-js client, channel authorization at the agent app's `POST /api/pusher/auth`, which
//    lets sessions holding audit:read (owner, admin) watch the tenant's room channels): the room's Pusher channel
//    `private-tenant-<tenant>-room-<roomId>` (event `agent-turn-executed`). Pusher carries live events only.
"use client";
import { AgentTranscript, type PusherLikeClient, pusherTelemetryChannel, RunGantt, SwarmTimeline, useAgentTelemetry } from "@agent-starter/react";
import "@agent-starter/react/styles.css";
import { useMemo, useState } from "react";

export function SwarmView({ roomId, sessionToken, pusher }: { roomId: string; sessionToken: string; pusher?: PusherLikeClient }) {
  const origin = (process.env.NEXT_PUBLIC_AGENT_ORIGIN ?? "http://localhost:5173").replace(/^http/, "ws");
  // Room ids are `room--<tenant>--<key>`: the tenant names the Pusher channel.
  const channelName = useMemo(() => {
    try {
      return pusher ? pusherTelemetryChannel(roomId.split("--")[1] ?? "", roomId) : null;
    } catch {
      return null;
    }
  }, [pusher, roomId]);
  const telemetry = useAgentTelemetry({
    source: pusher && channelName ? { type: "pusher", client: pusher, channelName } : { type: "websocket", url: `${origin}/api/rooms/${roomId}/live?token=${encodeURIComponent(sessionToken)}` },
  });
  const [selectedRun, setSelectedRun] = useState<string | undefined>(undefined);
  const [agent, setAgent] = useState<string | undefined>(undefined);
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <SwarmTimeline events={telemetry.events} />
      <RunGantt
        events={telemetry.events}
        selectedRunId={selectedRun}
        onSelectRun={(runId) => {
          setSelectedRun(runId);
          // Room bars are `<roomId>|<agent>`; drill into that agent's transcript.
          if (runId.includes("|")) setAgent(runId.slice(runId.lastIndexOf("|") + 1));
        }}
      />
      <AgentTranscript events={telemetry.events} agent={agent} onAgentChange={setAgent} hide={["status"]} />
    </div>
  );
}
