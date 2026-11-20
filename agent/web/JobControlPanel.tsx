// Operator dashboard for a background job: live trajectory + cost/budget + approvals + manual overrides.
"use client";
import { AgentControlPanel, deriveRunStatus, type PusherLikeClient, pusherTelemetryChannel, type RunStatus, useAgentChat, useAgentTelemetry } from "@agent-starter/react";
import "@agent-starter/react/styles.css";
import { createFlueClient } from "@flue/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

/** `GET /api/jobs/:id`: the run registry record plus the limits the job runs with (`status` is null before the first beat). */
interface JobSnapshot {
  status?: RunStatus | null;
  updatedAt?: number;
  budgetUsd?: number;
  maxTurns?: number;
  /** The job run's own billed VM seconds, when its registry counters have any. */
  vmSeconds?: number;
}

const JOB_POLL_MS = 5_000;

/**
 * Job operator panel. Status comes from the run registry (polled) and the live stream together, so a job parked on
 * a recipient-bound approval shows PENDING_APPROVAL with the oversight card, and a paused job shows HALTED with
 * Resume. Approve / reject go to the operator decide-by-id route (`POST /approvals/by-id/:jobId/:approvalId`, the
 * job id is its conversation id); background approvals never stream signed links.
 *
 * Live telemetry: the job's own Flue stream, plus Pusher when you pass `pusher` — your pusher-js client, e.g.
 * `new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
 * channelAuthorization: { endpoint: `${origin}/api/pusher/auth`, transport: "ajax", headers: { authorization: `Bearer ${operatorToken}` } } })`
 * (the agent app serves that route when PUSHER_* and `integrations.pusher` are set). The panel subscribes
 * `private-tenant-<tenant>-room-<jobId>` (event `agent-turn-executed`) and falls back to the Flue stream alone.
 *
 * VM time counts VMs the job's own run used; browser work delegated to the computer operator is billed on the
 * operator's run (open that run's panel to see it).
 */
export function JobControlPanel({ jobId, operatorToken, pusher }: { jobId: string; operatorToken: string; pusher?: PusherLikeClient }) {
  const origin = process.env.NEXT_PUBLIC_AGENT_ORIGIN ?? "http://localhost:5173";
  const client = useMemo(() => createFlueClient({ url: `${origin}/agents/background-worker/${jobId}`, token: operatorToken }), [origin, jobId, operatorToken]);
  const chat = useAgentChat({ client });
  // Job ids are `background-worker--<tenant>--<session>`: the tenant names the Pusher channel.
  const channelName = useMemo(() => {
    try {
      return pusher ? pusherTelemetryChannel(jobId.split("--")[1] ?? "", jobId) : null;
    } catch {
      return null;
    }
  }, [pusher, jobId]);
  const live = useAgentTelemetry({ source: pusher && channelName ? { type: "pusher", client: pusher, channelName } : null });
  const [job, setJob] = useState<JobSnapshot | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`${origin}/api/jobs/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${operatorToken}` } });
    if (res.ok) setJob((await res.json()) as JobSnapshot);
  }, [origin, jobId, operatorToken]);
  useEffect(() => {
    void refresh().catch(() => undefined);
    const timer = setInterval(() => void refresh().catch(() => undefined), JOB_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const call = async (path: string) => {
    const res = await fetch(`${origin}${path}`, { method: "POST", headers: { authorization: `Bearer ${operatorToken}` } });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    await refresh().catch(() => undefined);
  };
  const events = useMemo(() => [...chat.telemetry, ...live.events], [chat.telemetry, live.events]);
  const status = deriveRunStatus(events, { registry: job?.status ? { status: job.status, ...(job.updatedAt !== undefined ? { updatedAt: job.updatedAt } : {}) } : null, busy: chat.isBusy });
  return (
    <AgentControlPanel
      events={events}
      status={status}
      runId={jobId}
      {...(job?.budgetUsd !== undefined ? { budgetUsd: job.budgetUsd } : {})}
      {...(job?.maxTurns !== undefined ? { maxTurns: job.maxTurns } : {})}
      {...(job?.vmSeconds !== undefined ? { vmSeconds: job.vmSeconds } : {})}
      approvals={{ endpoint: `${origin}/approvals/by-id/${encodeURIComponent(jobId)}`, token: operatorToken, onDecided: () => void refresh().catch(() => undefined) }}
      {...(pusher ? { connectionStatus: live.status } : {})}
      onPause={() => call(`/api/jobs/${encodeURIComponent(jobId)}/pause`)}
      onResume={() => call(`/api/jobs/${encodeURIComponent(jobId)}/resume`)}
      // Emergency stop: aborts the run, stops its compute (VM recovery hooks) and marks it TERMINATED.
      onTeardown={() => call(`/api/jobs/${encodeURIComponent(jobId)}/teardown`)}
    />
  );
}
