import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Client for the persistent-agent control plane (`createPersistentControlRoutes` in @agent-starter/cloudflare,
 * mounted by the `persistent` module). Types are declared here so the React package keeps no runtime
 * dependency on @agent-starter/core; the parsers below accept only well-formed records.
 */

export type PersistentTurnOutcome = "ok" | "heartbeat_ok" | "skipped" | "error" | "killed" | "running";
export type ReviewDecision = "approve" | "block" | "escalate";

export interface PersistentReview {
  tool: string;
  decision: ReviewDecision;
  reason: string;
}

/** One agent turn as the control plane recorded it (content redacted). */
export interface PersistentTurnSummary {
  turnId: string;
  /** `heartbeat`, `schedule:<name>` or `manual`. */
  trigger: string;
  startedAt: number;
  endedAt?: number;
  outcome: PersistentTurnOutcome;
  toolCalls: string[];
  reviews: PersistentReview[];
  costUsd: number;
}

export interface PersistentStatus {
  enabled: boolean;
  /** Kill switch engaged: render and execution locked, heartbeat stopped. */
  killed: boolean;
  inFlight: boolean;
  nextTickAt: number | null;
  lastTickAt: number | null;
  /** Spend of the current UTC day against `config.dailyBudgetUsd`, when the server reports it. */
  spentTodayUsd?: number;
}

/** The parts of PersistentAgentConfig the panel shows (the server sends the whole versioned config). */
export interface PersistentConfigView {
  agentId: string;
  name: string;
  ownerUserId?: string;
  heartbeatMinutes: number;
  heartbeat: string;
  schedules: Array<{ name: string; cron: string; prompt?: string }>;
  dailyBudgetUsd: number;
  maxToolCallsPerTick: number;
  version: number;
  enabled?: boolean;
  [key: string]: unknown;
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied";

export interface PersistentProposal {
  id: string;
  createdAt: number;
  /** Who proposed it: the agent itself or the owner. */
  source: string;
  kind: string;
  summary: string;
  /** `human` proposals widen access and need an approver; `auto` ones were applied after auto-review. */
  review: "auto" | "human";
  status: ProposalStatus;
  /** Field-level changes: `{ field, before, after }`. */
  diff?: ProposalDiff[];
  reason?: string;
  decidedBy?: string;
  decidedAt?: number;
  note?: string;
}

export interface ProposalDiff {
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface PersistentAuditEntry {
  id: string;
  at: number;
  kind: string;
  actor: string;
  summary: string;
  data?: unknown;
}

export interface PersistentAgentState {
  config: PersistentConfigView;
  status: PersistentStatus;
  turns: PersistentTurnSummary[];
}

export interface UsePersistentAgentOptions {
  /** Base URL of the control routes, e.g. `https://agents.example.com/api/persistent`. */
  endpoint: string;
  agentId: string;
  /** Session token sent as `Authorization: Bearer`. */
  token?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  credentials?: RequestCredentials;
  /** Load the audit log too (the route answers 403 unless the session has a security/admin role). Default false. */
  audit?: boolean;
  /** Re-poll status every N ms (0 = off). Default 30 000. */
  pollMs?: number;
  /** Load on mount. Default true. */
  autoLoad?: boolean;
}

export interface UsePersistentAgentResult {
  state: PersistentAgentState | null;
  proposals: PersistentProposal[];
  audit: PersistentAuditEntry[];
  /** More audit entries exist (load them with `loadMoreAudit`). */
  auditHasMore: boolean;
  /** The session may not read the audit log (403). */
  auditForbidden: boolean;
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
  /** Kill switch: disable (true) or re-enable (false) the agent. */
  setKilled(killed: boolean): Promise<void>;
  decide(proposalId: string, decision: "approve" | "reject", note?: string): Promise<void>;
  loadMoreAudit(): Promise<void>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nullableNum = (value: unknown): number | null => (num(value) ? value : null);

const OUTCOMES: ReadonlySet<string> = new Set(["ok", "heartbeat_ok", "skipped", "error", "killed", "running"]);
const DECISIONS: ReadonlySet<string> = new Set(["approve", "block", "escalate"]);
const PROPOSAL_STATUSES: ReadonlySet<string> = new Set(["pending", "approved", "rejected", "applied"]);

export function parseTurnSummary(value: unknown): PersistentTurnSummary | null {
  if (!isObject(value) || !str(value.turnId) || !str(value.trigger) || !num(value.startedAt)) return null;
  const outcome = str(value.outcome) && OUTCOMES.has(value.outcome) ? (value.outcome as PersistentTurnOutcome) : value.endedAt === undefined ? "running" : "ok";
  const reviews = (Array.isArray(value.reviews) ? value.reviews : []).flatMap((r): PersistentReview[] =>
    isObject(r) && str(r.tool) && str(r.decision) && DECISIONS.has(r.decision) ? [{ tool: r.tool, decision: r.decision as ReviewDecision, reason: str(r.reason) ? r.reason : "" }] : [],
  );
  return {
    turnId: value.turnId,
    trigger: value.trigger,
    startedAt: value.startedAt,
    ...(num(value.endedAt) ? { endedAt: value.endedAt } : {}),
    outcome,
    toolCalls: (Array.isArray(value.toolCalls) ? value.toolCalls : []).flatMap((t) => (str(t) ? [t] : isObject(t) && str(t.tool) ? [t.tool] : [])),
    reviews,
    costUsd: num(value.costUsd) ? value.costUsd : 0,
  };
}

export function parsePersistentState(value: unknown): PersistentAgentState | null {
  if (!isObject(value) || !isObject(value.config) || !isObject(value.status)) return null;
  const c = value.config;
  if (!str(c.agentId) || !num(c.version)) return null;
  const s = value.status;
  const config: PersistentConfigView = {
    ...c,
    agentId: c.agentId,
    name: str(c.name) ? c.name : c.agentId,
    heartbeatMinutes: num(c.heartbeatMinutes) ? c.heartbeatMinutes : 30,
    heartbeat: str(c.heartbeat) ? c.heartbeat : "",
    schedules: (Array.isArray(c.schedules) ? c.schedules : []).flatMap((x) => (isObject(x) && str(x.name) && str(x.cron) ? [{ name: x.name, cron: x.cron, ...(str(x.prompt) ? { prompt: x.prompt } : {}) }] : [])),
    dailyBudgetUsd: num(c.dailyBudgetUsd) ? c.dailyBudgetUsd : 0,
    maxToolCallsPerTick: num(c.maxToolCallsPerTick) ? c.maxToolCallsPerTick : 0,
    version: c.version,
  };
  const status: PersistentStatus = {
    enabled: s.enabled !== false,
    killed: s.killed === true,
    inFlight: s.inFlight === true,
    nextTickAt: nullableNum(s.nextTickAt),
    lastTickAt: nullableNum(s.lastTickAt),
    ...(num(s.spentTodayUsd) ? { spentTodayUsd: s.spentTodayUsd } : {}),
  };
  const turns = (Array.isArray(value.turns) ? value.turns : []).flatMap((t) => {
    const parsed = parseTurnSummary(t);
    return parsed ? [parsed] : [];
  });
  return { config, status, turns };
}

export function parseProposal(value: unknown): PersistentProposal | null {
  if (!isObject(value) || !str(value.id) || !num(value.createdAt) || !str(value.status) || !PROPOSAL_STATUSES.has(value.status)) return null;
  return {
    id: value.id,
    createdAt: value.createdAt,
    source: str(value.source) ? value.source : "agent",
    kind: str(value.kind) ? value.kind : "config",
    summary: str(value.summary) ? value.summary : "",
    review: value.review === "auto" ? "auto" : "human",
    status: value.status as ProposalStatus,
    ...(Array.isArray(value.diff) ? { diff: value.diff.flatMap((d): ProposalDiff[] => (isObject(d) && str(d.field) ? [{ field: d.field, before: d.before, after: d.after }] : [])) } : {}),
    ...(str(value.reason) ? { reason: value.reason } : {}),
    ...(str(value.decidedBy) ? { decidedBy: value.decidedBy } : {}),
    ...(num(value.decidedAt) ? { decidedAt: value.decidedAt } : {}),
    ...(str(value.note) ? { note: value.note } : {}),
  };
}

export function parseAuditEntry(value: unknown): PersistentAuditEntry | null {
  if (!isObject(value) || !(str(value.id) || num(value.id)) || !num(value.at) || !str(value.kind)) return null;
  return { id: String(value.id), at: value.at, kind: value.kind, actor: str(value.actor) ? value.actor : "", summary: str(value.summary) ? value.summary : "", ...(value.data !== undefined ? { data: value.data } : {}) };
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
  return Object.assign(new Error(message), { status: response.status });
}

/**
 * Status, recent turns, pending proposals, kill switch and (for security roles) the audit log of one
 * persistent agent. The server scopes every call to the session's tenant and checks the role.
 */
export function usePersistentAgent(options: UsePersistentAgentOptions): UsePersistentAgentResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState<PersistentAgentState | null>(null);
  const [proposals, setProposals] = useState<PersistentProposal[]>([]);
  const [audit, setAudit] = useState<PersistentAuditEntry[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | undefined>(undefined);
  const [auditForbidden, setAuditForbidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const { endpoint, agentId, token, credentials, headers } = optionsRef.current;
    const extra = typeof headers === "function" ? await headers() : (headers ?? {});
    const doFetch = optionsRef.current.fetch ?? globalThis.fetch.bind(globalThis);
    return doFetch(`${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(agentId)}${path}`, {
      ...init,
      credentials: credentials ?? "same-origin",
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    });
  }, []);

  const loadAudit = useCallback(
    async (cursor?: string) => {
      const query = new URLSearchParams({ limit: "50", ...(cursor ? { cursor } : {}) });
      const response = await request(`/audit?${query.toString()}`);
      if (response.status === 403) {
        setAuditForbidden(true);
        return;
      }
      if (!response.ok) throw await failure(response, "Loading the audit log");
      const body = (await response.json()) as { entries?: unknown; nextCursor?: unknown };
      const entries = (Array.isArray(body.entries) ? body.entries : []).flatMap((e) => {
        const parsed = parseAuditEntry(e);
        return parsed ? [parsed] : [];
      });
      setAuditForbidden(false);
      setAudit((current) => (cursor ? [...current, ...entries] : entries));
      // The control routes page by entry id (a number); accept a string cursor too.
      setAuditCursor((typeof body.nextCursor === "string" && body.nextCursor) || (typeof body.nextCursor === "number" && Number.isFinite(body.nextCursor)) ? String(body.nextCursor) : undefined);
    },
    [request],
  );

  const refresh = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    try {
      const [statusResponse, proposalResponse] = await Promise.all([request(""), request("/proposals")]);
      if (!statusResponse.ok) throw await failure(statusResponse, "Loading the agent");
      const parsed = parsePersistentState(await statusResponse.json());
      if (!parsed) throw new Error("The control plane returned an unexpected response.");
      const list = proposalResponse.ok ? ((await proposalResponse.json()) as { proposals?: unknown }).proposals : [];
      if (run !== generation.current) return;
      setState(parsed);
      setProposals(
        (Array.isArray(list) ? list : []).flatMap((p) => {
          const proposal = parseProposal(p);
          return proposal ? [proposal] : [];
        }),
      );
      if (optionsRef.current.audit) await loadAudit();
      if (run === generation.current) setError(null);
    } catch (cause) {
      if (run === generation.current) setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, [request, loadAudit]);

  const setKilled = useCallback(
    async (killed: boolean) => {
      const response = await request(killed ? "/disable" : "/enable", { method: "POST", body: "{}" });
      if (!response.ok) throw await failure(response, killed ? "Disabling the agent" : "Enabling the agent");
      await refresh();
    },
    [request, refresh],
  );

  const decide = useCallback(
    async (proposalId: string, decision: "approve" | "reject", note?: string) => {
      const response = await request(`/proposals/${encodeURIComponent(proposalId)}/${decision}`, { method: "POST", body: JSON.stringify(note ? { note } : {}) });
      if (!response.ok) throw await failure(response, decision === "approve" ? "Approving the proposal" : "Rejecting the proposal");
      await refresh();
    },
    [request, refresh],
  );

  const loadMoreAudit = useCallback(async () => {
    if (auditCursor) await loadAudit(auditCursor);
  }, [auditCursor, loadAudit]);

  useEffect(() => {
    if (options.autoLoad === false) return;
    void refresh();
    const every = options.pollMs ?? 30_000;
    if (!(every > 0)) return;
    const timer = setInterval(() => void refresh(), every);
    return () => clearInterval(timer);
  }, [options.endpoint, options.agentId, options.token, options.autoLoad, options.pollMs, refresh]);

  return { state, proposals, audit, auditHasMore: auditCursor !== undefined, auditForbidden, loading, error, refresh, setKilled, decide, loadMoreAudit };
}
