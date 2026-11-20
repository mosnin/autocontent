/*
 * Delegation runtime: public types.
 *
 * The record shape (immutable origin, mode work|consult|notify, reply resume|poll|none, depth, lifecycle, outcome,
 * per-root limits) is adapted from OpenMausBot's job runtime, server/runtime/types.ts at commit
 * 542f8e55f3f9c5be5550aac0e99fcec050308d69 (https://github.com/milind-soni/openmausbot).
 * Copyright 2026 Milind Soni and OpenMausBot contributors. Licensed under the Apache License, Version 2.0
 * (see third_party/templates/openmausbot/LICENSE and NOTICE).
 *
 * MODIFIED for Agent Starter (Apache-2.0 section 4(b)): reduced to agent-to-agent delegation between Flue agents
 * (requester/assignee are agent + conversation ids, tenant-scoped), added task keys, tool grants, per-run budgets,
 * capability nonces and refusals; removed approval levels, rooms, wakes and the Chief-of-Staff level rules.
 * The task-key reuse and "child tools never wider than the parent's" rules follow patterns described (not copied)
 * in docs/research/templates/openhuman.md.
 */

/** work: do it with your own (granted) tools. consult: answer from what you know, act on nothing. notify: one-way. */
export type DelegationMode = "work" | "consult" | "notify";

/** resume: the requester is woken with the result. poll: the result is recorded for check_delegation. none: nothing comes back. */
export type DelegationReply = "resume" | "poll" | "none";

export type DelegationStatus =
  | "queued" //      recorded, not yet delivered to the worker
  | "running" //     delivered; the worker owns it
  | "needs_input" // the worker ended on a question for the requester or a person
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_DELEGATION_STATUSES: readonly DelegationStatus[] = ["completed", "failed", "cancelled"];

export const isTerminalDelegation = (status: DelegationStatus): boolean => TERMINAL_DELEGATION_STATUSES.includes(status);

/** Legal lifecycle transitions; anything else is refused. Terminal rows never change again. */
export const DELEGATION_TRANSITIONS: Record<DelegationStatus, readonly DelegationStatus[]> = {
  queued: ["running", "failed", "cancelled"],
  running: ["needs_input", "completed", "failed", "cancelled"],
  needs_input: ["running", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export type DelegationOutcome = "done" | "needs_input" | "failed" | "no_report" | "stalled" | "budget" | "cancelled" | "delivery_failed";

/**
 * Where the work started. Written once by the harness at the root and copied unchanged down the tree:
 * a worker that delegates further keeps its own requester's origin.
 */
export interface DelegationOrigin {
  /** Agent that started the tree (the first requester). */
  agent: string;
  /** Conversation that started the tree; results of the root assignment return here. */
  conversationId: string;
  tenantId: string;
  /** Who stood behind the root conversation: a person's turn, a routine/cron/event, or anything else. */
  kind: "person" | "routine" | "outside";
  userId?: string;
}

export interface DelegationParty {
  agent: string;
  conversationId: string;
}

export interface Assignment {
  id: string;
  /** "outgoing": this agent delegated it. "incoming": this agent is the worker. Each DO keeps its own side. */
  role: "outgoing" | "incoming";
  tenantId: string;
  rootId: string;
  parentId: string | null;
  /** Edges from the root: a root assignment is depth 1. */
  depth: number;
  /** Agents from the root requester down to this assignee (loop/ring guard). */
  chain: string[];
  origin: DelegationOrigin;
  requester: DelegationParty;
  assignee: DelegationParty;
  mode: DelegationMode;
  reply: DelegationReply;
  /** Same task key + same worker = the same worker conversation (it continues where it left off). */
  taskKey: string;
  brief: string;
  doneWhen: string | null;
  /** Tool names the worker may run for this assignment (⊆ the requester's own grant). */
  toolGrant: string[];
  budgetUsd: number;
  costUsd: number;
  status: DelegationStatus;
  outcome: DelegationOutcome | null;
  result: string | null;
  /** Capability nonce: a result is accepted only when it echoes this value. Never shown to models. */
  nonce: string;
  /** Times the worker's turn ended without a report (reply guard). */
  guardCount: number;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  /** When the result was handed back to the requester (at most once). */
  reportedAt: number | null;
}

export interface DelegationLimits {
  /** Deepest assignment allowed (root = 1). */
  maxDepth: number;
  /** Outgoing assignments one requester conversation may create (non-refused, any status). */
  maxPerRun: number;
  /** Concurrently open outgoing assignments per requester conversation. */
  maxOpenPerRun: number;
  /** Sum of budgets reserved by one requester conversation's assignments. */
  maxBudgetUsdPerRun: number;
  /** Budget reserved per assignment when the caller names none. */
  defaultBudgetUsd: number;
  /** Reply-guard reminders before a silent worker is reported as `no_report`. */
  maxReplyGuards: number;
  /** Brief size cap (characters). */
  maxBriefChars: number;
}

export const DEFAULT_DELEGATION_LIMITS: DelegationLimits = {
  maxDepth: 3,
  maxPerRun: 8,
  maxOpenPerRun: 4,
  maxBudgetUsdPerRun: 2,
  defaultBudgetUsd: 0.25,
  maxReplyGuards: 2,
  maxBriefChars: 12_000,
};

export type DelegationRefusal =
  | "unknown_target" //  not on the allowlisted roster
  | "self" //            an agent delegating to itself
  | "ring" //            the target is already in the chain (A→B→A, A→B→C→A)
  | "depth" //           maxDepth exceeded
  | "per_run" //         maxPerRun exceeded
  | "open" //            maxOpenPerRun exceeded
  | "budget" //          maxBudgetUsdPerRun exceeded
  | "tenant" //          origin/requester tenant mismatch
  | "grant" //           requested tools outside the requester's grant
  | "disabled"; //       tenant feature flag off

export interface DelegationRequest {
  tenantId: string;
  requester: DelegationParty;
  /** Target agent name, already resolved by the server from the roster (never model text). */
  assigneeAgent: string;
  /** Conversation id the worker runs in (derived by the caller from the task key). */
  assigneeConversationId: string;
  mode: DelegationMode;
  reply?: DelegationReply;
  taskKey: string;
  brief: string;
  doneWhen?: string;
  /** The requester's own grant (its mounted tool names). */
  requesterGrant: readonly string[];
  /** Tools the worker declares; the assignment grant is requesterGrant ∩ workerTools (∩ requestedTools). */
  workerTools?: readonly string[];
  /** Optional narrowing the requester asked for; any name outside the requester's grant refuses the request. */
  requestedTools?: readonly string[];
  budgetUsd?: number;
  /** Root origin when this requester is not itself a worker. Ignored when `parent` is given (origin is inherited). */
  origin?: Omit<DelegationOrigin, "tenantId">;
  /** The incoming assignment this requester is working on, when it delegates further. */
  parent?: Assignment | null;
}

export type DelegationPlan =
  | { ok: true; assignment: Assignment; reused: boolean }
  | { ok: false; refusal: DelegationRefusal; message: string };
