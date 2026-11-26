import { AgentError } from "../errors.ts";
import type { SqlStore } from "../storage/ports.ts";
import { base64UrlDecode, base64UrlEncode, hmacSha256, randomId, randomToken, sha256Hex, stableStringify, timingSafeEqual } from "../util/crypto.ts";

export type ApprovalDecision = "approve" | "reject";
export type ApprovalStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED";

export interface ApprovalTokenPayload {
  /** Approval id. */
  aid: string;
  /** Tenant id. */
  tid: string;
  /** Run / conversation id. */
  rid: string;
  /** Decision encoded into this link. */
  d: ApprovalDecision;
  /** Expiry (epoch ms). */
  exp: number;
  /** Single-use nonce. */
  n: string;
  /**
   * Optional intended approver (session `sub`). When set, only a caller with a
   * verified session for this user in the same tenant may use the link.
   */
  r?: string;
  /**
   * Token kind. Absent: a link minted with the approval record (carries its nonce). `"operator"`: a
   * decide-by-id token minted server-side by `createApprovalRoutes` after verifying an admin/operator
   * session (contract 3). It is always bound to that approver (`r`), short-lived, and carries no record
   * nonce (the route cannot read the agent's SQLite); the record is matched by id, tenant and run.
   */
  k?: "operator";
}

/** One secret, or `[current, previous]` during rotation: sign with the first, accept any. */
export type ApprovalSecret = string | string[];

function secretList(secret: ApprovalSecret): string[] {
  const list = (Array.isArray(secret) ? secret : [secret]).filter((s) => typeof s === "string" && s.length > 0);
  if (list.length === 0) throw new AgentError("CONFIG_INVALID", "No approval signing secret configured");
  return list;
}

/** Hash of a call's (validated) arguments: an approval only authorises the exact arguments a human saw. */
export async function approvalArgsHash(args: unknown): Promise<string> {
  return sha256Hex(stableStringify(args ?? null));
}

/**
 * Signed, expiring, single-use approval links (HMAC-SHA256). The out-of-band
 * email/SMS/Slack button carries one token per decision; the public approval
 * endpoint verifies it before waking the parked agent. With a secret array
 * the first entry signs.
 */
export async function createApprovalToken(secret: ApprovalSecret, payload: ApprovalTokenPayload): Promise<string> {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(await hmacSha256(secretList(secret)[0] as string, body));
  return `${body}.${signature}`;
}

export async function verifyApprovalToken(secret: ApprovalSecret, token: string, clock: () => number = Date.now): Promise<ApprovalTokenPayload> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) throw new AgentError("APPROVAL_TOKEN_INVALID", "Malformed approval token");
  let valid = false;
  for (const s of secretList(secret)) {
    if (timingSafeEqual(base64UrlEncode(await hmacSha256(s, body)), signature)) valid = true;
  }
  if (!valid) throw new AgentError("APPROVAL_TOKEN_INVALID", "Approval token signature mismatch");
  let payload: ApprovalTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as ApprovalTokenPayload;
  } catch (error) {
    throw new AgentError("APPROVAL_TOKEN_INVALID", "Approval token payload unreadable", { cause: error });
  }
  if (typeof payload !== "object" || payload === null) throw new AgentError("APPROVAL_TOKEN_INVALID", "Approval token payload unreadable");
  if (typeof payload.exp !== "number" || !(payload.exp >= clock())) throw new AgentError("APPROVAL_TOKEN_INVALID", "Approval token expired");
  if (payload.d !== "approve" && payload.d !== "reject") throw new AgentError("APPROVAL_TOKEN_INVALID", "Approval token decision invalid");
  if (typeof payload.aid !== "string" || typeof payload.tid !== "string" || typeof payload.rid !== "string" || typeof payload.n !== "string") {
    throw new AgentError("APPROVAL_TOKEN_INVALID", "Approval token fields invalid");
  }
  if (payload.r !== undefined && (typeof payload.r !== "string" || !payload.r)) throw new AgentError("APPROVAL_TOKEN_INVALID", "Approval token recipient invalid");
  if (payload.k !== undefined && (payload.k !== "operator" || payload.r === undefined)) throw new AgentError("APPROVAL_TOKEN_INVALID", "Approval token kind invalid");
  return payload;
}

/** Default lifetime of an operator decide-by-id token: long enough for the dispatch, useless if leaked later. */
export const OPERATOR_DECISION_TTL_MS = 10 * 60_000;

/**
 * Mint a decide-by-id token (contract 3) for an operator whose session the caller has already verified:
 * bound to that operator (`r`), kind `"operator"`, expiring after `ttlMs` (default 10 minutes). The agent's
 * `ApprovalStore.decideWithToken` accepts it without the record nonce, only for the matching approval id,
 * tenant and conversation, and only with `decidedBy` equal to the bound operator.
 */
export async function createOperatorDecisionToken(
  secret: ApprovalSecret,
  input: { approvalId: string; tenantId: string; conversationId: string; decision: ApprovalDecision; approverId: string; ttlMs?: number; clock?: () => number },
): Promise<string> {
  if (!input.approverId) throw new AgentError("APPROVAL_TOKEN_INVALID", "An operator decision needs a verified approver id");
  const now = (input.clock ?? Date.now)();
  return createApprovalToken(secret, {
    aid: input.approvalId,
    tid: input.tenantId,
    rid: input.conversationId,
    d: input.decision,
    exp: now + (input.ttlMs ?? OPERATOR_DECISION_TTL_MS),
    n: randomToken(12),
    r: input.approverId,
    k: "operator",
  });
}

/**
 * Who may use a verified token: a recipient-bound token (`r`) requires a
 * verified approver identity for that exact user in the token's tenant.
 */
export function assertApprover(payload: Pick<ApprovalTokenPayload, "tid" | "r">, approver: { tenantId: string; userId: string } | null): void {
  if (payload.r === undefined) return;
  if (!approver || approver.tenantId !== payload.tid || approver.userId !== payload.r) {
    throw new AgentError("APPROVAL_TOKEN_INVALID", "This approval link is bound to a different approver; sign in as the intended approver.");
  }
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  tenantId: string;
  tool: string;
  toolCallId: string;
  args: unknown;
  argsHash: string;
  riskTier: string;
  reason: string;
  status: ApprovalStatus;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
  decidedBy?: string;
  decisionNote?: string;
}

export interface ApprovalLinks {
  approveToken: string;
  rejectToken: string;
}

interface ApprovalRow {
  id: string;
  run_id: string;
  tenant_id: string;
  tool: string;
  tool_call_id: string;
  args_json: string;
  args_hash: string;
  risk_tier: string;
  reason: string;
  status: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
  decided_by: string | null;
  decision_note: string | null;
}

/** Durable ledger of pending/decided approvals (SQLite). Decisions are idempotent and single-use. */
export class ApprovalStore {
  constructor(
    private readonly sql: SqlStore,
    private readonly secret: ApprovalSecret,
    private readonly options: {
      ttlMs?: number;
      clock?: () => number;
      /** Bind each approval link to one approver (session `sub`); unbound when it returns undefined. */
      recipient?: (record: ApprovalRecord) => string | undefined;
    } = {},
  ) {}

  private get clock() {
    return this.options.clock ?? Date.now;
  }

  /**
   * Create (or re-issue) the approval for one tool call. An existing record is
   * reused only when it is for the same call id AND the same tool AND the same
   * arguments (SEC-10); an empty call id never matches anything, so it always
   * gets a fresh, randomly keyed record.
   */
  async create(input: { runId: string; tenantId: string; tool: string; toolCallId: string; args: unknown; riskTier: string; reason: string }): Promise<{ record: ApprovalRecord; links: ApprovalLinks }> {
    const argsHash = await approvalArgsHash(input.args);
    const toolCallId = input.toolCallId.trim() ? input.toolCallId : randomId("call");
    const existing = this.findMatching(input.runId, toolCallId, input.tool, argsHash);
    const now = this.clock();
    const record: ApprovalRecord = existing ?? {
      id: randomId("apr"),
      runId: input.runId,
      tenantId: input.tenantId,
      tool: input.tool,
      toolCallId,
      args: input.args,
      argsHash,
      riskTier: input.riskTier,
      reason: input.reason,
      status: "PENDING_APPROVAL",
      nonce: randomToken(16),
      createdAt: now,
      expiresAt: now + (this.options.ttlMs ?? 72 * 3600_000),
    };
    if (!existing) {
      this.sql.exec(
        `INSERT INTO as_approvals (id, run_id, tenant_id, tool, tool_call_id, args_json, args_hash, risk_tier, reason, status, nonce, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        record.id,
        record.runId,
        record.tenantId,
        record.tool,
        record.toolCallId,
        JSON.stringify(record.args ?? null),
        record.argsHash,
        record.riskTier,
        record.reason,
        record.status,
        record.nonce,
        record.createdAt,
        record.expiresAt,
      );
    }
    return { record, links: await this.links(record) };
  }

  async links(record: ApprovalRecord): Promise<ApprovalLinks> {
    const recipient = this.options.recipient?.(record);
    const base = { aid: record.id, tid: record.tenantId, rid: record.runId, exp: record.expiresAt, n: record.nonce, ...(recipient ? { r: recipient } : {}) };
    return {
      approveToken: await createApprovalToken(this.secret, { ...base, d: "approve" }),
      rejectToken: await createApprovalToken(this.secret, { ...base, d: "reject" }),
    };
  }

  get(id: string): ApprovalRecord | null {
    const row = this.sql.exec<ApprovalRow>(`SELECT * FROM as_approvals WHERE id = ?`, id)[0];
    return row ? this.fromRow(row) : null;
  }

  findByToolCall(runId: string, toolCallId: string): ApprovalRecord | null {
    if (!toolCallId) return null;
    const row = this.sql.exec<ApprovalRow>(`SELECT * FROM as_approvals WHERE run_id = ? AND tool_call_id = ? ORDER BY created_at DESC`, runId, toolCallId)[0];
    return row ? this.fromRow(row) : null;
  }

  /**
   * The approval that authorises exactly this call: same run, same non-empty
   * call id, same tool and same argument hash (SEC-10). Anything else (another
   * tool or other arguments reusing an id, or a provider that emits empty ids)
   * finds nothing and must be approved on its own.
   */
  findMatching(runId: string, toolCallId: string, tool: string, argsHash: string): ApprovalRecord | null {
    if (!toolCallId.trim()) return null;
    const row = this.sql.exec<ApprovalRow>(
      `SELECT * FROM as_approvals WHERE run_id = ? AND tool_call_id = ? AND tool = ? AND args_hash = ? ORDER BY created_at DESC`,
      runId,
      toolCallId,
      tool,
      argsHash,
    )[0];
    return row ? this.fromRow(row) : null;
  }

  pending(runId: string): ApprovalRecord[] {
    return this.sql.exec<ApprovalRow>(`SELECT * FROM as_approvals WHERE run_id = ? AND status = 'PENDING_APPROVAL' ORDER BY created_at`, runId).map((r) => this.fromRow(r));
  }

  /**
   * Apply a decision from a verified token. Returns the record; repeated clicks
   * on an already-decided approval are harmless (idempotent) but cannot flip it.
   * `decidedBy` must come from a verified identity (the approval route derives
   * it from a session token, else "approval-link"), never from a raw header.
   * Recipient-bound tokens require `decidedBy` to equal the bound user.
   */
  async decideWithToken(token: string, decidedBy: string, note?: string): Promise<{ record: ApprovalRecord; changed: boolean }> {
    const payload = await verifyApprovalToken(this.secret, token, this.clock);
    const record = this.get(payload.aid);
    // Operator decide-by-id tokens are matched by id + tenant + run (they never saw the record's nonce); links need the nonce.
    const nonceOk = payload.k === "operator" || (record ? timingSafeEqual(record.nonce, payload.n) : false);
    if (!record || record.tenantId !== payload.tid || record.runId !== payload.rid || !nonceOk) {
      throw new AgentError("APPROVAL_TOKEN_INVALID", "Approval token does not match a pending approval");
    }
    if (payload.r !== undefined && decidedBy !== payload.r) {
      throw new AgentError("APPROVAL_TOKEN_INVALID", "This approval link is bound to a different approver");
    }
    return this.decide(record.id, payload.d, decidedBy, note);
  }

  decide(id: string, decision: ApprovalDecision, decidedBy: string, note?: string): { record: ApprovalRecord; changed: boolean } {
    const record = this.get(id);
    if (!record) throw new AgentError("APPROVAL_TOKEN_INVALID", `Unknown approval ${id}`);
    if (record.status !== "PENDING_APPROVAL") return { record, changed: false };
    if (record.expiresAt < this.clock()) {
      this.sql.exec(`UPDATE as_approvals SET status = 'EXPIRED' WHERE id = ?`, id);
      return { record: { ...record, status: "EXPIRED" }, changed: true };
    }
    const status: ApprovalStatus = decision === "approve" ? "APPROVED" : "REJECTED";
    const now = this.clock();
    this.sql.exec(`UPDATE as_approvals SET status = ?, decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND status = 'PENDING_APPROVAL'`, status, now, decidedBy, note ?? null, id);
    return { record: { ...record, status, decidedAt: now, decidedBy, ...(note ? { decisionNote: note } : {}) }, changed: true };
  }

  private fromRow(row: ApprovalRow): ApprovalRecord {
    return {
      id: row.id,
      runId: row.run_id,
      tenantId: row.tenant_id,
      tool: row.tool,
      toolCallId: row.tool_call_id,
      args: JSON.parse(row.args_json) as unknown,
      argsHash: row.args_hash,
      riskTier: row.risk_tier,
      reason: row.reason,
      status: row.status as ApprovalStatus,
      nonce: row.nonce,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      ...(row.decided_at !== null ? { decidedAt: Number(row.decided_at) } : {}),
      ...(row.decided_by !== null ? { decidedBy: row.decided_by } : {}),
      ...(row.decision_note !== null ? { decisionNote: row.decision_note } : {}),
    };
  }
}
