import { agentInstanceId, type BlobStore, harnessSessionKey, parseAgentInstanceId, parseHarnessSessionKey, sha256Hex, sha256HexSync } from "@agent-starter/core";
import { diffTrajectories, type EvalRunOutput, type TrajectoryDiff } from "@agent-starter/evals";
import type { OpsAlert } from "../lib/alerts.ts";

/**
 * Shadow forking of production events (R-EVAL-10). With SHADOW_SAMPLE_RATE > 0, a deterministic share of
 * background jobs (by job id, so the consumer and the worker agree without storage) gets a shadow twin:
 * a separate instance created with `mode: "shadow"` (every mutating tool is simulated) that receives the
 * same turns. SHADOW_MODEL optionally runs the twin on a candidate model. When a turn finishes, each side
 * writes its trajectory to R2 (`tenants/<tenant>/shadow/<turn>/production.json | shadow.json`); whichever
 * side finishes second writes `diff.json` (`diffTrajectories`: tool sequence, status, cost; verdict
 * equivalent / diverged / regressed / improved). A regressed or diverged turn is flagged as a SHADOW_DIVERGENCE
 * ops alert (telemetry: signed webhook to the SaaS, Pusher) on the production job. Pure module: blobs are injected.
 */

/** Parse SHADOW_SAMPLE_RATE ("0.05" = 5 % of jobs). Anything invalid disables shadowing. */
export function parseSampleRate(raw: string | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Deterministic sampling by job id: the same job is always (or never) shadowed. */
export async function shadowSampled(jobId: string, rate: number): Promise<boolean> {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Number.parseInt((await sha256Hex(`shadow:${jobId}`)).slice(0, 8), 16) / 0x1_0000_0000 < rate;
}

/** The twin of a production job: same agent and tenant, its own harness-owned session (never the job itself). */
export function shadowTwinId(jobId: string): string {
  const parsed = parseAgentInstanceId(jobId);
  if (!parsed) throw new Error(`Not an agent instance id: ${jobId}`);
  return agentInstanceId(parsed.agent, parsed.tenantId, harnessSessionKey("job", `shadow.${sha256HexSync(jobId).slice(0, 32)}`));
}

export function isShadowTwin(instanceId: string): boolean {
  const session = parseAgentInstanceId(instanceId)?.sessionKey;
  return session ? (parseHarnessSessionKey(session)?.key.startsWith("shadow.") ?? false) : false;
}

export interface ShadowSideRecord {
  side: "production" | "shadow";
  jobId: string;
  turn: string;
  output: EvalRunOutput;
  at: number;
}

const TURN = /^[0-9a-f]{16,64}$/;

/**
 * Record one side of a shadowed turn; when the other side is already there, write the diff.
 * `blobs` must be tenant scoped (TenantScopedBlobStore). Returns the diff when this call wrote it.
 */
export async function recordShadowSide(blobs: BlobStore, record: Omit<ShadowSideRecord, "at"> & { at?: number }): Promise<{ diff?: TrajectoryDiff; productionJob?: string; shadowJob?: string }> {
  if (!TURN.test(record.turn)) throw new Error("Invalid shadow turn id");
  const entry: ShadowSideRecord = { ...record, at: record.at ?? Date.now() };
  const dir = `shadow/${record.turn}`;
  await blobs.put(`${dir}/${record.side}.json`, JSON.stringify(entry), { contentType: "application/json" });
  const other = await blobs.get(`${dir}/${record.side === "production" ? "shadow" : "production"}.json`);
  if (!other) return {};
  const counterpart = JSON.parse(await other.text()) as ShadowSideRecord;
  const production = record.side === "production" ? entry : counterpart;
  const shadow = record.side === "shadow" ? entry : counterpart;
  const diff = diffTrajectories(production.output, shadow.output);
  await blobs.put(`${dir}/diff.json`, JSON.stringify({ turn: record.turn, productionJob: production.jobId, shadowJob: shadow.jobId, diff, at: entry.at }), { contentType: "application/json" });
  return { diff, productionJob: production.jobId, shadowJob: shadow.jobId };
}

/**
 * The ops alert for a shadowed turn whose candidate regressed (failed / halted where production completed, or
 * cost > 150 %) or took a different tool path; null when it was equivalent or better. Raised on the production
 * job, with the R2 key of the diff.
 */
export function shadowDivergenceAlert(input: { tenantId: string; turn: string; productionJob: string; shadowJob: string; diff: TrajectoryDiff }): OpsAlert | null {
  const { diff } = input;
  if (diff.verdict !== "regressed" && diff.verdict !== "diverged") return null;
  const where = diff.divergedAtStep === null ? "" : ` at step ${diff.divergedAtStep + 1}`;
  const cost = `${diff.costDeltaUsd >= 0 ? "+" : "-"}USD ${Math.abs(diff.costDeltaUsd).toFixed(4)}`;
  return {
    code: "SHADOW_DIVERGENCE",
    tenantId: input.tenantId,
    runId: input.productionJob,
    agent: "background-worker",
    content: `Shadow turn ${input.turn.slice(0, 12)} ${diff.verdict}${where}: production [${diff.productionTools.join(", ")}] vs shadow [${diff.shadowTools.join(", ")}], cost ${cost}.`,
    data: { verdict: diff.verdict, turn: input.turn, shadowJob: input.shadowJob, diffKey: `tenants/${input.tenantId}/shadow/${input.turn}/diff.json`, statusMatch: diff.statusMatch, toolSequenceMatch: diff.toolSequenceMatch, costDeltaUsd: diff.costDeltaUsd, turnDelta: diff.turnDelta },
  };
}
