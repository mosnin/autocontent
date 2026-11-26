import {
  agentInstanceId,
  type CoalescedTurn,
  createJobStateMachineDefinition,
  type EventEnvelope,
  harnessSessionKey,
  parseAgentInstanceId,
  type RateLimitDecision,
  sha256Hex,
  sha256HexSync,
  type TenantConfig,
} from "@agent-starter/core";
import { CLOSED_WORKFLOW_STATES, workflowStateKey } from "../lib/run-status.ts";
import { DELEGATION_TOOLS } from "./delegation.ts";

/**
 * Job routing for the events queue (pure: every dependency is injected, so test/background.test.ts runs it
 * in Node; src/background/queue.ts wires the Worker bindings).
 *
 *  - Each coalesced turn goes to a JOB-scoped BackgroundWorker instance. Events join the session's open
 *    job (running, waiting for a human or a delegated task, or created but not started yet). A job whose
 *    workflow reached REPORT / DONE / FAILED, or whose last submission settled, takes no new work: the next
 *    turn starts a fresh job with its own workflow state and budget (R13).
 *  - Job ids are derived from the session pointer (`base` + sequence number), not from the batch, so two
 *    consumers that race on the same session both pick the same next job and converge on one instance.
 *  - Provider redeliveries are dropped by event id (KV ledger `evt:<tenant>:<eventId>`).
 *  - Each turn is classified by the Workers AI utility model (SIMPLE / COMPLEX) and the verdict is stamped as the
 *    job signal's `route` attribute: the hook runs SIMPLE turns on the first-line model and COMPLEX ones on the
 *    frontier model (the cheap router of the flagship chain). A classifier failure stamps COMPLEX.
 *  - The first dispatch of a job carries the tenant's config (platform dispatchInitialData), so the job's first
 *    render uses the tenant's real limits and model profiles, never the secure freemium defaults.
 *  - A tenant over its turn rate (the consumer's own bucket, separate from the edge's) is deferred by
 *    re-enqueueing the events with a delay: the queue message is acked, so deferrals never burn retries (R7).
 *  - A sampled share of jobs gets a shadow twin (mode "shadow": mutating tools simulated) fed the same
 *    turns (R-EVAL-10, see shadow.ts).
 */
export const BACKGROUND_AGENT = "background-worker";

/** Registry statuses of a job that still takes work (QUEUED: waiting for a delegated task's result). */
export const OPEN_JOB_STATUSES = new Set(["RUNNING", "QUEUED", "PROVISIONING", "PENDING_APPROVAL", "PAUSED_OVERSIGHT"]);

/** Reads of the item a Marketer pipeline event is about (src/marketer/tools/*): the job's first look. */
export const EVENT_READ_TOOLS = ["get_video", "get_article", "get_carousel", "list_ad_approvals"] as const;
/** Account context while deciding what the event means (what waits on the person, how the period is going). */
export const CONTEXT_READ_TOOLS = ["get_workspace_inbox", "get_workspace_overview"] as const;

/** The message bus tool (multi-agent module): asynchronous hand-offs to dispatch-only agents. */
export const BUS_TOOL = "send_agent_message";

/**
 * The job FSM: INGEST → EVALUATE → EXECUTE → REPORT → DONE. Only the active state's tools are mounted and
 * executable. Marketer pipeline jobs only read and report: they summarize what happened and notify the web app;
 * they never retry, approve, publish or spend (those stay with Marketer and a person). With delegates composed, `delegate_task` / `check_delegation` are available while evaluating
 * (consult) and executing (work), never while reporting. With the message bus composed (multi-agent),
 * `send_agent_message` is available while executing and reporting (hand a finding to another agent class).
 */
export function jobWorkflow(delegation: boolean, bus = false) {
  const delegate = delegation ? [...DELEGATION_TOOLS] : [];
  const emit = bus ? [BUS_TOOL] : [];
  return createJobStateMachineDefinition({
    ingest: [...EVENT_READ_TOOLS],
    evaluate: [...EVENT_READ_TOOLS, ...CONTEXT_READ_TOOLS, ...delegate],
    execute: [...EVENT_READ_TOOLS, ...CONTEXT_READ_TOOLS, ...delegate, ...emit],
    report: ["save_artifact", "notify_saas", ...emit],
  });
}

const DAY = 86_400;
const POINTER_TTL = 30 * DAY;

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
}

export interface JobRoutingDeps {
  kv: KvLike;
  registry: { get(runId: string): Promise<{ status: string } | null> };
  clock?: () => number;
}

/** A session as the router sees it: a hash (pointer keys, signal attributes) and a readable label (job ids). */
export interface SessionRef {
  hash: string;
  label: string;
}

interface JobPointer {
  id: string;
  base: string;
  seq: number;
  label: string;
}

export async function sessionRef(sessionKey: string): Promise<SessionRef> {
  return { hash: (await sha256Hex(sessionKey)).slice(0, 32), label: sessionKey.replace(/[^A-Za-z0-9_.:-]/g, "_").replace(/-{2,}/g, "-").slice(0, 40) || "session" };
}

export const jobPointerKey = (tenantId: string, sessionHash: string) => `job:${tenantId}:${sessionHash}`;
export const eventLedgerKey = (tenantId: string, eventId: string) => `evt:${tenantId}:${eventId}`;

/** Harness-owned job id (never addressable as a user's conversation, SEC-20). */
export function jobInstanceId(tenantId: string, ref: SessionRef, base: string, seq: number): string {
  return agentInstanceId(BACKGROUND_AGENT, tenantId, harnessSessionKey("job", `${ref.label}.${ref.hash.slice(0, 16)}.${base}-${seq}`));
}

function parsePointer(raw: string | null): JobPointer | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<JobPointer>;
    if (typeof value.id === "string" && typeof value.base === "string" && typeof value.seq === "number") return { id: value.id, base: value.base, seq: value.seq, label: typeof value.label === "string" ? value.label : "session" };
  } catch {
    // legacy pointer (a bare job id): start a new sequence
  }
  return null;
}

/** Is the job still taking work? Closed workflow → no; never started (no registry record) → yes. */
export async function isOpenJob(deps: JobRoutingDeps, jobId: string): Promise<boolean> {
  const state = await deps.kv.get(workflowStateKey(jobId));
  if (state && CLOSED_WORKFLOW_STATES.has(state)) return false;
  const run = await deps.registry.get(jobId);
  return run === null || OPEN_JOB_STATUSES.has(run.status);
}

/**
 * The session's open job, or the next job id. `exclude` forces a different job (a closed job re-routing
 * events it received during its REPORT window).
 */
export async function jobIdFor(deps: JobRoutingDeps, tenantId: string, ref: SessionRef, options: { exclude?: string } = {}): Promise<string> {
  const key = jobPointerKey(tenantId, ref.hash);
  const pointer = parsePointer(await deps.kv.get(key));
  if (pointer && pointer.id !== options.exclude && (await isOpenJob(deps, pointer.id))) return pointer.id;
  // Racing consumers read the same pointer (or none, within the same minute) and so pick the same id.
  const base = pointer?.base ?? Math.floor((deps.clock ?? Date.now)() / 60_000).toString(36);
  let seq = (pointer?.seq ?? 0) + 1;
  let id = jobInstanceId(tenantId, ref, base, seq);
  while (id === options.exclude) id = jobInstanceId(tenantId, ref, base, ++seq);
  await deps.kv.put(key, JSON.stringify({ id, base, seq, label: ref.label } satisfies JobPointer), { expirationTtl: POINTER_TTL });
  return id;
}

export interface JobInitialData {
  tenantId: string;
  userId: string;
  roles: string[];
  objective: string;
  mode?: "shadow";
  tenantConfig?: TenantConfig;
}

export interface JobDispatchRequest {
  id: string;
  message: { kind: "signal"; type: string; body: string; attributes: Record<string, string> };
  initialData: JobInitialData;
  idempotencyKey: string;
}

export type StepRoute = "SIMPLE" | "COMPLEX";

export interface DispatchJobDeps extends JobRoutingDeps {
  dispatch(request: JobDispatchRequest): Promise<unknown>;
  /** Mark the job RUNNING right away so the next batch joins it (best effort). */
  beat?(run: { runId: string; tenantId: string; agent: string }): Promise<unknown>;
  /** Signal body for a turn (renderTurn: provider data wrapped as untrusted). */
  render(turn: CoalescedTurn): string;
  /** The consumer's per-tenant turn bucket (TenantRateLimiter "turns"). */
  limiter?: { take(key: string): Promise<RateLimitDecision> };
  /** Re-enqueue events with a delay (Queue.sendBatch with delaySeconds). Required for deferrals. */
  requeue?(events: EventEnvelope[], delaySeconds: number): Promise<unknown>;
  /** Shadow forking: share of jobs (0..1) that get a shadow twin. */
  shadow?: { rate: number; twinId(jobId: string): string; sampled(jobId: string, rate: number): Promise<boolean> };
  /** Utility-model step router for the rendered turn (platform classifyDelivery). Omitted: no `route` stamp. */
  classify?(text: string): Promise<StepRoute>;
  /** Server-side initialData for the dispatch (platform dispatchInitialData: adds the tenant's config). */
  initialData?(base: JobInitialData): Promise<JobInitialData>;
  log?(message: string): void;
}

export type DispatchJobResult = { status: "duplicate" } | { status: "deferred"; delaySeconds: number } | { status: "dispatched"; jobId: string; turn: string; shadowId?: string };

const MAX_DELAY_SECONDS = 43_200;

export async function dispatchJobTurn(deps: DispatchJobDeps, turn: CoalescedTurn): Promise<DispatchJobResult> {
  const seen = await Promise.all(turn.eventIds.map(async (eventId) => ((await deps.kv.get(eventLedgerKey(turn.tenantId, eventId))) === null ? eventId : null)));
  const fresh = seen.filter((eventId): eventId is string => eventId !== null);
  if (fresh.length === 0) return { status: "duplicate" };
  const events = turn.events.filter((e) => fresh.includes(e.id));

  if (deps.limiter && deps.requeue) {
    let decision: RateLimitDecision | null = null;
    try {
      decision = await deps.limiter.take(turn.tenantId);
    } catch (error) {
      // The edge already rate limited these events: a limiter outage must not stall the queue.
      deps.log?.(`[queue] turn limiter unavailable, dispatching: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (decision && !decision.allowed) {
      const delaySeconds = Math.min(MAX_DELAY_SECONDS, Math.max(1, Math.ceil(decision.retryAfterMs / 1000)));
      await deps.requeue(events, delaySeconds);
      return { status: "deferred", delaySeconds };
    }
  }

  const jobTurn: CoalescedTurn = { ...turn, events, eventIds: fresh, types: [...new Set(events.map((e) => e.type))] };
  const digest = (await sha256Hex(fresh.join(","))).slice(0, 48);
  const ref = await sessionRef(turn.sessionKey);
  const id = await jobIdFor(deps, turn.tenantId, ref);
  const body = deps.render(jobTurn);
  const route = await classifyStep(deps, body);
  // Attributes are harness-written and reach the model: only hashes, counts and the router's label, never provider text.
  const message = { kind: "signal" as const, type: "events", body, attributes: { turn: digest, session: ref.hash, events: String(fresh.length), ...(route ? { route } : {}) } };
  const base: JobInitialData = { tenantId: turn.tenantId, userId: `system:${events[0]?.source ?? "events"}`, roles: ["system"], objective: `Process ${jobTurn.types.join(", ")} events`.slice(0, 400) };
  const initialData = deps.initialData ? await deps.initialData(base).catch(() => base) : base;
  await deps.dispatch({ id, message, initialData, idempotencyKey: `events:${digest}` });
  await deps.beat?.({ runId: id, tenantId: turn.tenantId, agent: BACKGROUND_AGENT })?.catch(() => undefined);
  await Promise.all(fresh.map((eventId) => deps.kv.put(eventLedgerKey(turn.tenantId, eventId), id, { expirationTtl: DAY })));

  let shadowId: string | undefined;
  if (deps.shadow && deps.shadow.rate > 0 && (await deps.shadow.sampled(id, deps.shadow.rate))) {
    shadowId = deps.shadow.twinId(id);
    try {
      await deps.dispatch({ id: shadowId, message, initialData: { ...initialData, mode: "shadow" }, idempotencyKey: `shadow:${digest}` });
    } catch (error) {
      // The shadow twin is an experiment: it never affects production delivery.
      deps.log?.(`[shadow] twin dispatch failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
      shadowId = undefined;
    }
  }
  return { status: "dispatched", jobId: id, turn: digest, ...(shadowId ? { shadowId } : {}) };
}

/** The utility model's SIMPLE / COMPLEX verdict for a turn; COMPLEX (frontier) when the classifier fails. */
export async function classifyStep(deps: Pick<DispatchJobDeps, "classify" | "log">, body: string): Promise<StepRoute | undefined> {
  if (!deps.classify) return undefined;
  try {
    return (await deps.classify(body)) === "SIMPLE" ? "SIMPLE" : "COMPLEX";
  } catch (error) {
    deps.log?.(`[queue] step router unavailable, routing COMPLEX: ${error instanceof Error ? error.message : String(error)}`);
    return "COMPLEX";
  }
}

/**
 * Where a closed job (REPORT / DONE / FAILED) sends events that reached it anyway (dispatched just before
 * its workflow marker landed): the session's open job, or a new one, never itself.
 */
export async function rerouteTarget(deps: JobRoutingDeps, input: { jobId: string; tenantId: string; sessionHash: string }): Promise<string> {
  const pointer = parsePointer(await deps.kv.get(jobPointerKey(input.tenantId, input.sessionHash)));
  return jobIdFor(deps, input.tenantId, { hash: input.sessionHash, label: pointer?.label ?? "session" }, { exclude: input.jobId });
}

/**
 * Blue/green handoff (R-OPS-04). When a deploy with an incompatible CODE_VERSION meets a job that started on the
 * old version, the hook locks the old instance and calls `onHandoff` with its serialized state. The background
 * worker then re-dispatches the in-flight work to a FRESH job on the new code:
 *  - an events turn goes to the session's next job (rerouteTarget), with its original body and attributes;
 *  - any other wake (manual job, resume, approval decision, delegation result) becomes a `job` signal for a
 *    fresh job id derived from the old one, so a retried handoff converges on the same instance.
 * The old job's state (workflow state, goals, recent tool errors) travels as data inside a <handoff> block so
 * the new job verifies what already happened before acting.
 */
export interface HandoffInput {
  jobId: string;
  startedOn: string;
  current: string;
  state: Record<string, unknown>;
  objective?: string;
  delivery: { kind: string; type?: string; body?: string; attributes?: Record<string, string> };
}

/** Deterministic fresh job for a non-events handoff (never the old job itself). */
export function handoffJobId(jobId: string, current: string): string {
  const parsed = parseAgentInstanceId(jobId);
  if (!parsed) throw new Error(`Not a job instance id: ${jobId}`);
  return agentInstanceId(BACKGROUND_AGENT, parsed.tenantId, harnessSessionKey("job", `handoff.${sha256HexSync(`${jobId}\u0000${current}`).slice(0, 32)}`));
}

export function handoffSignal(input: HandoffInput): { type: "events" | "job"; body: string; attributes: Record<string, string> } {
  // `<` escaped so nothing inside the state can close the <handoff> block.
  const state = JSON.stringify({ fromJob: input.jobId, startedOn: input.startedOn, runningOn: input.current, ...input.state }).replace(/</g, "\\u003c").slice(0, 6000);
  const note = `<handoff>\nThis work was handed over from a job that started on code version ${input.startedOn} (this deploy runs ${input.current}). The previous job's state, as data:\n${state}\nVerify what was already done (goals, workflow state, the SaaS records) before repeating any action.\n</handoff>`;
  const isEvents = input.delivery.kind === "signal" && input.delivery.type === "events";
  if (isEvents) return { type: "events", body: `${note}\n${input.delivery.body ?? ""}`, attributes: { ...(input.delivery.attributes ?? {}), handoff: "1" } };
  const wake = input.delivery.kind === "signal" ? `a ${input.delivery.type ?? "signal"} signal` : `a ${input.delivery.kind} message`;
  return { type: "job", body: `${note}\nObjective: ${(input.objective ?? "Continue the handed-over job").slice(0, 1000)}\nThe previous job was woken by ${wake}; any approval it was waiting for must be requested again.`, attributes: { handoff: "1" } };
}
