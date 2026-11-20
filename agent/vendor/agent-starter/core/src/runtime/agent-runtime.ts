import { z } from "zod";
import { ApprovalStore } from "../autonomy/approvals.ts";
import type { ApprovalLinks, ApprovalRecord } from "../autonomy/approvals.ts";
import { AutonomyGateway, type AutonomyPolicy } from "../autonomy/gateway.ts";
import { BudgetGuard, type BudgetLimits, CostModel } from "../budget/budget.ts";
import { Critic } from "../cognition/critic.ts";
import { DriftSentinel } from "../cognition/drift.ts";
import type { StateMachine } from "../cognition/fsm.ts";
import { GoalTree } from "../cognition/goal-tree.ts";
import type { Planner } from "../cognition/planner.ts";
import { AgentError, BudgetExceededError, errorMessage, SecurityHaltError } from "../errors.ts";
import { UNTRUSTED_CONTENT_POLICY, wrapUntrusted } from "../guardrails/injection.ts";
import type { GuardrailPipeline } from "../guardrails/pipeline.ts";
import type { EventEnvelope } from "../ingestion/events.ts";
import { ContextWindow } from "../memory/context-window.ts";
import type { EntityGraphMemory } from "../memory/entity-graph.ts";
import { KnowledgeRetriever } from "../memory/retriever.ts";
import { ScratchpadCompactor } from "../memory/scratchpad.ts";
import { ModelRouter } from "../models/router.ts";
import type { ChatMessage, ModelProvider, ToolCall } from "../models/types.ts";
import { FanoutTelemetrySink, type RunStatus, TelemetryEmitter, type TelemetrySink } from "../observability/telemetry.ts";
import { SpanAttr, type Tracer } from "../observability/tracer.ts";
import { MigrationRunner } from "../storage/migrations.ts";
import type { BlobStore, Embedder, SqlStore } from "../storage/ports.ts";
import { CORE_MIGRATIONS } from "../storage/schema.ts";
import type { TenantConfig, TenantSecurityContext } from "../tenancy/tenancy.ts";
import { type AnyAgentTool, defineAgentTool } from "../tools/define.ts";
import { ToolExecutor, type ToolOutcome } from "../tools/executor.ts";
import type { ToolFirewall } from "../tools/firewall.ts";
import { ArgumentHealer } from "../tools/healer.ts";
import { SqlIdempotencyStore } from "../tools/idempotency.ts";
import { maskTools } from "../tools/executor.ts";
import { RunStore } from "./run-store.ts";

export interface AgentRuntimeOptions {
  agent: string;
  runId: string;
  tenant: TenantSecurityContext;
  tenantConfig: TenantConfig;
  /** System instructions (static or rendered per turn from runtime state). */
  instructions: string | ((state: { turn: number; objective: string }) => string);
  model: ModelRouter | ModelProvider;
  /** Cheap first-line model used for compaction, critique, healing, drift and classification. */
  utilityModel?: ModelProvider;
  tools: AnyAgentTool[];
  sql: SqlStore;
  blobs?: BlobStore;
  budget?: Partial<BudgetLimits>;
  costModel?: CostModel;
  guardrails?: GuardrailPipeline;
  firewall?: ToolFirewall;
  autonomy?: Partial<AutonomyPolicy>;
  approvalSecret?: string;
  onApprovalRequested?: (record: ApprovalRecord, links: ApprovalLinks) => Promise<void>;
  onBudgetBreach?: (info: { reason: string; snapshotKey?: string }) => Promise<void>;
  embedder?: Embedder;
  retriever?: KnowledgeRetriever;
  entityGraph?: EntityGraphMemory;
  planner?: Planner;
  stateMachine?: StateMachine<string, Record<string, unknown>>;
  contextTokens?: number;
  maxToolsPerTurn?: number;
  driftCheckEvery?: number;
  telemetry?: TelemetrySink;
  tracer?: Tracer;
  mode?: "live" | "shadow" | "dry-run";
  services?: Record<string, unknown>;
  codeVersion?: string;
  clock?: () => number;
}

export interface RunResult {
  runId: string;
  status: Extract<RunStatus, "COMPLETED" | "PENDING_APPROVAL" | "HALTED" | "FAILED" | "TERMINATED">;
  output: string;
  turnCount: number;
  costUsd: number;
  pendingApprovals: Array<{ approvalId: string; tool: string; reason: string }>;
  error?: { code: string; message: string };
  trajectory: string[];
  toolCalls: Array<{ tool: string; status: ToolOutcome["status"] }>;
}

const COGNITIVE_TOOLS = new Set(["update_goal", "transition_state", "remember_fact"]);

const GoalUpdateInput = z.object({
  goalId: z.string(),
  status: z.enum(["ACTIVE", "COMPLETED", "FAILED", "BLOCKED"]),
  result: z.string().max(1000).optional(),
  spawnChildren: z.array(z.object({ id: z.string().regex(/^[a-z0-9_]{1,40}$/), title: z.string().max(200) })).max(5).optional(),
});
const TransitionInput = z.object({ to: z.string(), reason: z.string().max(500) });
const RememberInput = z.object({ entityType: z.string().max(40), entityName: z.string().max(120), fact: z.string().max(400), relatedTo: z.object({ type: z.string(), name: z.string(), relationship: z.string() }).optional() });

/**
 * Reference agent loop that wires every enterprise control together. Flue
 * agents get the same controls through `@agent-starter/flue` hooks; this loop
 * runs anywhere (Workers, Durable Objects, Node, tests, evals) with no harness.
 *
 * Per turn: budget gate → heartbeat → render context (FSM, goal tree,
 * scratchpad, reflections, drift anchor, retrieval) → sliding-window compaction
 * → tool masking → routed model call → output guardrails → tool pipeline
 * (heal/validate/tenant/firewall/risk/idempotency/retry) → critic on failure →
 * scratchpad compaction → transcript checkpoint.
 */
export class AgentRuntime {
  readonly runs: RunStore;
  readonly budget: BudgetGuard;
  readonly goals: GoalTree;
  readonly scratchpad: ScratchpadCompactor;
  readonly approvals: ApprovalStore | undefined;
  private readonly executor: ToolExecutor;
  private readonly critic: Critic;
  private readonly drift: DriftSentinel;
  private readonly contextWindow: ContextWindow;
  private readonly emitter: TelemetryEmitter;
  private readonly model: ModelRouter;
  private readonly clock: () => number;
  private readonly trajectory: string[] = [];
  private readonly toolLog: RunResult["toolCalls"] = [];
  private pendingInjections: string[] = [];
  private driftAnchor: string | null = null;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.clock = options.clock ?? Date.now;
    new MigrationRunner(options.sql).migrateUp(CORE_MIGRATIONS);
    this.runs = new RunStore(options.sql, this.clock);
    const limits: BudgetLimits = { maxTurns: options.tenantConfig.maxTurnsPerSession, maxCostUsd: options.tenantConfig.maxBudgetUsd, ...options.budget };
    this.budget = new BudgetGuard({
      runId: options.runId,
      tenantId: options.tenant.tenantId,
      limits,
      sql: options.sql,
      costModel: options.costModel ?? new CostModel(),
      clock: this.clock,
      onBreach: async (breach) => {
        const snapshotKey = options.blobs ? await this.runs.stashSnapshot(options.blobs, options.runId, { breach }) : undefined;
        await options.onBudgetBreach?.({ reason: `${breach.limit} ${breach.used}/${breach.max}`, ...(snapshotKey ? { snapshotKey } : {}) });
      },
    });
    this.model =
      options.model instanceof ModelRouter
        ? options.model.withContext({ budget: this.budget, ...(options.tracer ? { tracer: options.tracer } : {}), runId: options.runId, tenantId: options.tenant.tenantId, allowedProfiles: options.tenantConfig.allowedModelProfiles, sql: options.sql })
        : new ModelRouter({ profiles: { default: { provider: options.model } }, defaultProfile: "default", budget: this.budget, ...(options.tracer ? { tracer: options.tracer } : {}), runId: options.runId, tenantId: options.tenant.tenantId, sql: options.sql });
    this.goals = new GoalTree(options.sql, { runId: options.runId, tenantId: options.tenant.tenantId }, { clock: this.clock });
    this.scratchpad = new ScratchpadCompactor({ runId: options.runId, sql: options.sql, ...(options.utilityModel ? { model: options.utilityModel } : {}), clock: this.clock });
    this.critic = new Critic({ runId: options.runId, sql: options.sql, ...(options.utilityModel ? { model: options.utilityModel } : {}), clock: this.clock });
    this.drift = new DriftSentinel({ ...(options.embedder ? { embedder: options.embedder } : {}), ...(options.utilityModel ? { model: options.utilityModel } : {}) });
    this.contextWindow = new ContextWindow({ maxTokens: options.contextTokens ?? 60_000, ...(options.utilityModel ? { summarizer: options.utilityModel } : {}) });
    this.approvals = options.approvalSecret ? new ApprovalStore(options.sql, options.approvalSecret, { clock: this.clock }) : undefined;
    this.emitter = new TelemetryEmitter(
      options.telemetry ?? new FanoutTelemetrySink([]),
      { runId: options.runId, tenantId: options.tenant.tenantId, senderId: options.agent, senderRole: options.agent },
      () => {
        const s = this.budget.snapshot();
        return { turnCount: s.turns, accumulatedCost: s.costUsd, startedAt: s.startedAt };
      },
      this.clock,
    );
    this.executor = new ToolExecutor({
      tools: [...options.tools, ...this.cognitiveTools()],
      ...(options.firewall ? { firewall: options.firewall } : {}),
      healer: new ArgumentHealer(options.utilityModel ? { repairModel: options.utilityModel } : {}),
      gateway: new AutonomyGateway(options.autonomy),
      ...(this.approvals ? { approvals: this.approvals } : {}),
      budget: this.budget,
      idempotency: new SqlIdempotencyStore(options.sql, this.clock),
      ...(options.tracer ? { tracer: options.tracer } : {}),
      telemetry: this.emitter,
      audit: (entry) =>
        options.sql.exec(
          `INSERT INTO as_audit_log (run_id, tenant_id, actor, action, target, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          entry.runId,
          entry.tenantId,
          entry.actor,
          entry.action,
          entry.target,
          JSON.stringify(entry.detail),
          this.clock(),
        ),
      ...(options.onApprovalRequested ? { onApprovalRequested: options.onApprovalRequested } : {}),
      ...(options.stateMachine
        ? {
            policy: (toolName: string) => {
              const machine = options.stateMachine as StateMachine<string, Record<string, unknown>>;
              if (COGNITIVE_TOOLS.has(toolName) || machine.allowedTools().includes(toolName)) return { allowed: true };
              return { allowed: false, reason: `Tool "${toolName}" is not available in workflow state ${machine.state}. Allowed: ${machine.allowedTools().join(", ") || "none"}.` };
            },
          }
        : {}),
    });
  }

  /** Start (or continue) a run with a user message and/or batched events. */
  async run(input: { message?: string; events?: EventEnvelope[]; objective?: string; maxTurns?: number }): Promise<RunResult> {
    const existing = this.runs.get(this.options.runId);
    const objective = input.objective ?? existing?.objective ?? input.message ?? input.events?.map((e) => e.type).join(", ") ?? "";
    this.runs.upsert({ runId: this.options.runId, tenantId: this.options.tenant.tenantId, agent: this.options.agent, objective, status: "RUNNING", codeVersion: this.options.codeVersion ?? "1.0.0" });
    await this.emitter.emit({ type: "status", content: `Run started: ${objective.slice(0, 200)}`, status: "RUNNING" });

    const transcript = this.runs.loadTranscript(this.options.runId);
    try {
      const incoming = await this.buildIncoming(input);
      if (incoming) transcript.push({ role: "user", content: incoming });
    } catch (error) {
      if (error instanceof SecurityHaltError) return this.finish("TERMINATED", transcript, "SECURITY_EXCEPTION_HALT: input rejected by guardrails.", { code: error.code, message: error.message });
      throw error;
    }

    if (this.options.planner && this.goals.all().length === 0 && objective) {
      try {
        const plan = await this.options.planner.decompose(objective, input.events?.[0] ? { eventType: input.events[0].type } : {});
        this.options.planner.load(plan, this.goals, "root", objective);
        this.trajectory.push(`plan: ${plan.goals.map((g) => g.id).join(" → ")}`);
        await this.emitter.emit({ type: "plan", content: this.goals.render(), logType: "cognitive" });
      } catch (error) {
        this.trajectory.push(`planner unavailable: ${errorMessage(error)}`);
      }
    }
    return this.loop(transcript, objective, input.maxTurns);
  }

  /** Continue a run parked on approvals (after decisions were recorded). */
  async resume(): Promise<RunResult> {
    const record = this.runs.get(this.options.runId);
    if (!record) throw new AgentError("INVALID_STATE_TRANSITION", `Unknown run ${this.options.runId}`);
    const transcript = this.runs.loadTranscript(this.options.runId);
    const pendingCalls = this.unresolvedToolCalls(transcript);
    if (pendingCalls.length === 0) return this.loop(transcript, record.objective);
    if (this.approvals?.pending(this.options.runId).length) {
      return this.finish("PENDING_APPROVAL", transcript, "Still awaiting human approval.");
    }
    this.runs.setStatus(this.options.runId, "RUNNING");
    await this.emitter.emit({ type: "status", content: "Approval decision received; resuming.", status: "RUNNING" });
    const answered = new Set(transcript.filter((m) => m.role === "tool").map((m) => (m as Extract<ChatMessage, { role: "tool" }>).toolCallId));
    const parked: ToolCall[] = pendingCalls.filter((c) => !answered.has(c.id));
    const outcomes = await this.executeCalls(parked, record.objective, transcript);
    if (outcomes.some((o) => o.status === "approval_required")) return this.finish("PENDING_APPROVAL", transcript, "Awaiting human approval.");
    return this.loop(transcript, record.objective);
  }

  /** Apply a signed approval link decision and resume. */
  async decide(token: string, decidedBy: string, note?: string): Promise<RunResult> {
    if (!this.approvals) throw new AgentError("CONFIG_INVALID", "Approvals are not configured (approvalSecret missing)");
    const { record } = await this.approvals.decideWithToken(token, decidedBy, note);
    await this.emitter.emit({ type: "approval", content: `Approval ${record.id} → ${record.status} by ${decidedBy}`, logType: record.status === "APPROVED" ? "success" : "warning" });
    return this.resume();
  }

  private async loop(transcript: ChatMessage[], objective: string, maxTurns?: number): Promise<RunResult> {
    const turnLimit = maxTurns ?? Number.POSITIVE_INFINITY;
    for (let turn = 0; turn < turnLimit; turn++) {
      try {
        await this.budget.check();
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          await this.emitter.emit({ type: "budget", content: error.message, logType: "error", status: "HALTED" });
          return this.finish("HALTED", transcript, `Execution halted: ${error.message}`, { code: error.code, message: error.message });
        }
        throw error;
      }
      this.runs.heartbeat(this.options.runId, { turnCount: this.budget.snapshot().turns, costUsd: this.budget.snapshot().costUsd });

      const span = this.options.tracer?.startSpan(`turn:${this.budget.snapshot().turns + 1}`, { kind: "agent", attributes: { [SpanAttr.agentName]: this.options.agent, [SpanAttr.runId]: this.options.runId, [SpanAttr.tenantId]: this.options.tenant.tenantId } });
      const system = await this.renderSystem(objective, transcript);
      const fitted = await this.contextWindow.fit([{ role: "system", content: system }, ...transcript]);
      const specs = this.toolSpecs(objective, transcript);

      let response;
      try {
        response = await this.model.generate({ messages: fitted.messages, ...(specs.length ? { tools: specs } : {}), metadata: { tenant: this.options.tenant.tenantId, run: this.options.runId } });
      } catch (error) {
        span?.fail(error);
        if (error instanceof BudgetExceededError) return this.finish("HALTED", transcript, error.message, { code: error.code, message: error.message });
        await this.emitter.emit({ type: "error", content: `Model call failed: ${errorMessage(error)}`, logType: "error", status: "FAILED" });
        return this.finish("FAILED", transcript, "The model is unavailable.", { code: error instanceof AgentError ? error.code : "MODEL_UNAVAILABLE", message: errorMessage(error) });
      }
      this.budget.recordTurn();

      let text = response.text;
      if (this.options.guardrails && text) text = (await this.options.guardrails.checkOutput(text, { source: "assistant", tenantId: this.options.tenant.tenantId })).text;
      transcript.push({ role: "assistant", content: text, ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}), ...(response.reasoning ? { reasoning: response.reasoning } : {}) });
      if (response.reasoning) await this.emitter.emit({ type: "model", content: response.reasoning.slice(0, 2000), logType: "cognitive" });
      if (text) await this.emitter.emit({ type: "message", content: text.slice(0, 4000), logType: "info" });
      span?.setAttributes({ [SpanAttr.completion]: text, [SpanAttr.reasoning]: response.reasoning });

      if (response.toolCalls.length === 0) {
        span?.end("ok");
        if (this.options.stateMachine && !this.options.stateMachine.isTerminal() && turn < 3 && this.options.stateMachine.state !== "REPORT") {
          this.pendingInjections.push(`The workflow is in state ${this.options.stateMachine.state}, not a terminal state. Use transition_state to advance, or explain why the job cannot continue.`);
          this.runs.saveTranscript(this.options.runId, transcript);
          continue;
        }
        return this.finish("COMPLETED", transcript, text);
      }

      const outcomes = await this.executeCalls(response.toolCalls, objective, transcript);
      span?.end("ok");
      if (outcomes.some((o) => o.status === "approval_required")) return this.finish("PENDING_APPROVAL", transcript, text || "Paused pending human approval.");
      const budgetStop = outcomes.find((o) => o.status === "budget_exceeded");
      if (budgetStop) return this.finish("HALTED", transcript, budgetStop.text, { code: "BUDGET_LIMIT_EXCEEDED", message: budgetStop.text });
      if (this.options.stateMachine?.isTerminal()) return this.finish(this.options.stateMachine.state === "FAILED" ? "FAILED" : "COMPLETED", transcript, text || `Workflow reached ${this.options.stateMachine.state}.`);

      const driftEvery = this.options.driftCheckEvery ?? 5;
      if (driftEvery > 0 && this.budget.snapshot().turns % driftEvery === 0) {
        const assessment = await this.drift.assess(objective, this.scratchpad.current().currentFocus);
        this.driftAnchor = assessment.aligned ? null : (assessment.anchor ?? null);
        if (!assessment.aligned) await this.emitter.emit({ type: "log", content: "Cognitive drift detected; anchoring to root objective.", logType: "warning" });
      }
      this.runs.saveTranscript(this.options.runId, transcript);
    }
    return this.finish("COMPLETED", transcript, "Turn limit for this invocation reached; run can be continued.");
  }

  private async executeCalls(calls: ToolCall[], objective: string, transcript: ChatMessage[]): Promise<ToolOutcome[]> {
    const outcomes: ToolOutcome[] = [];
    const rawLogs: string[] = [];
    for (const call of calls) {
      const outcome = await this.executor.execute(call, {
        tenant: this.options.tenant,
        tenantConfig: this.options.tenantConfig,
        runId: this.options.runId,
        signal: new AbortController().signal,
        mode: this.options.mode ?? "live",
        log: (level, message) => this.trajectory.push(`${level}: ${message}`),
        services: this.options.services ?? {},
      });
      outcomes.push(outcome);
      this.toolLog.push({ tool: call.name, status: outcome.status });
      this.trajectory.push(`${call.name} → ${outcome.status}`);
      transcript.push({ role: "tool", toolCallId: call.id, name: call.name, content: outcome.text });
      rawLogs.push(`${call.name}(${typeof call.arguments === "string" ? call.arguments.slice(0, 300) : ""}) → ${outcome.status}: ${outcome.text.slice(0, 1500)}`);
      if (outcome.status === "error" || outcome.status === "invalid_arguments" || outcome.status === "denied") {
        const reflection = await this.critic.reflect({
          stepName: this.goals.next()?.id ?? call.name,
          action: call.name,
          args: call.arguments,
          error: outcome.status === "error" ? outcome.message : outcome.status === "invalid_arguments" ? outcome.issues.join("; ") : outcome.reason,
          objective,
        });
        this.pendingInjections.push(reflection.injection);
        await this.emitter.emit({ type: "log", content: reflection.critique, logType: "cognitive" });
      }
    }
    this.scratchpad.save(await this.scratchpad.compact(rawLogs.join("\n"), objective));
    this.runs.saveTranscript(this.options.runId, transcript);
    return outcomes;
  }

  private async buildIncoming(input: { message?: string; events?: EventEnvelope[] }): Promise<string | null> {
    const parts: string[] = [];
    const guard = async (text: string, source: string) => (this.options.guardrails ? this.options.guardrails.enforceInput(text, { source, tenantId: this.options.tenant.tenantId }) : text);
    if (input.message) parts.push(wrapUntrusted(await guard(input.message, "user"), "user"));
    for (const event of input.events ?? []) {
      if (event.tenantId !== this.options.tenant.tenantId) throw new SecurityHaltError("Event tenant does not match the executing tenant", { eventId: event.id });
      const body = typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload);
      parts.push(wrapUntrusted(await guard(body, `event:${event.source}`), `event:${event.source}:${event.type}`));
    }
    if (parts.length === 0) return null;
    if (this.options.retriever && input.message) {
      const hits = await this.options.retriever.retrieve(input.message, { topK: 5 }).catch(() => []);
      const rendered = KnowledgeRetriever.render(hits);
      if (rendered) parts.push(rendered);
    }
    return parts.join("\n\n");
  }

  private async renderSystem(objective: string, transcript: ChatMessage[]): Promise<string> {
    const base = typeof this.options.instructions === "function" ? this.options.instructions({ turn: this.budget.snapshot().turns, objective }) : this.options.instructions;
    const remaining = this.budget.remaining();
    const blocks = [
      base,
      UNTRUSTED_CONTENT_POLICY,
      `[RUN CONTEXT] tenant=${this.options.tenant.tenantId} run=${this.options.runId} objective="${objective.slice(0, 500)}" budget_remaining=$${remaining.costUsd.toFixed(4)} turns_remaining=${remaining.turns}`,
      this.options.stateMachine?.render(),
      this.goals.all().length ? this.goals.render() : undefined,
      transcript.some((m) => m.role === "tool") ? this.scratchpad.render() : undefined,
      this.driftAnchor ?? undefined,
      ...this.pendingInjections.splice(0),
    ];
    return blocks.filter(Boolean).join("\n\n");
  }

  private toolSpecs(objective: string, transcript: ChatMessage[]) {
    let specs = this.executor.specs(this.options.tenantConfig);
    const fsmAllowed = this.options.stateMachine ? new Set([...this.options.stateMachine.allowedTools(), ...COGNITIVE_TOOLS]) : null;
    if (fsmAllowed) specs = specs.filter((s) => fsmAllowed.has(s.name));
    const lastUser = [...transcript].reverse().find((m) => m.role === "user")?.content ?? objective;
    return maskTools(specs, `${objective}\n${lastUser}`, { maxTools: this.options.maxToolsPerTurn ?? 16, alwaysInclude: ["transition_state", "update_goal", "remember_fact"] });
  }

  private unresolvedToolCalls(transcript: ChatMessage[]): ToolCall[] {
    const lastAssistant = [...transcript].reverse().find((m) => m.role === "assistant") as Extract<ChatMessage, { role: "assistant" }> | undefined;
    if (!lastAssistant?.toolCalls?.length) return [];
    const resolved = new Map(transcript.filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool").map((m) => [m.toolCallId, m.content]));
    return lastAssistant.toolCalls.filter((c) => {
      const content = resolved.get(c.id);
      if (content === undefined) return true;
      if (content.includes('"PENDING_APPROVAL"')) {
        // Drop the placeholder result so the call is re-executed with the decision applied.
        const index = transcript.findIndex((m) => m.role === "tool" && (m as Extract<ChatMessage, { role: "tool" }>).toolCallId === c.id);
        if (index >= 0) transcript.splice(index, 1);
        return true;
      }
      return false;
    });
  }

  private cognitiveTools(): AnyAgentTool[] {
    const tools: AnyAgentTool[] = [
      defineAgentTool({
        name: "update_goal",
        description: "Update the hierarchical goal tree after an action: mark a goal ACTIVE/COMPLETED/FAILED/BLOCKED and optionally spawn child goals.",
        input: GoalUpdateInput,
        risk: "LOW",
        sideEffect: "none",
        outputTrust: "trusted",
        execute: async (args) => {
          if (!this.goals.get(args.goalId)) this.goals.addGoal({ id: args.goalId, title: args.result ?? args.goalId });
          for (const child of args.spawnChildren ?? []) this.goals.addGoal({ id: `${args.goalId}.${child.id}`, parentId: args.goalId, title: child.title });
          const failed = this.goals.setStatus(args.goalId, args.status, args.result);
          if (failed.length && this.options.planner) {
            const replans = Number(this.options.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_goal_tree WHERE run_id = ? AND id LIKE '%.r%\\_%' ESCAPE '\\'`, this.options.runId)[0]?.n ?? 0);
            try {
              const result = await this.options.planner.replan(this.goals, args.goalId, args.result ?? "goal failed", replans);
              return { tree: this.goals.render(), replanned: result.message };
            } catch (error) {
              return { tree: this.goals.render(), replanned: `re-planning unavailable: ${errorMessage(error)}` };
            }
          }
          return { tree: this.goals.render() };
        },
      }),
    ];
    if (this.options.stateMachine) {
      const machine = this.options.stateMachine;
      tools.push(
        defineAgentTool({
          name: "transition_state",
          description: `Advance the workflow state machine. Current state: ${machine.state}. Only explicitly allowed transitions succeed.`,
          input: TransitionInput,
          risk: "LOW",
          sideEffect: "none",
          outputTrust: "trusted",
          execute: async (args) => {
            machine.transition(args.to as never, args.reason);
            await this.emitter.emit({ type: "status", content: `Workflow → ${args.to}: ${args.reason}`, logType: "cognitive" });
            return { state: machine.state, instructions: machine.render() };
          },
        }),
      );
    }
    if (this.options.entityGraph) {
      const graph = this.options.entityGraph;
      tools.push(
        defineAgentTool({
          name: "remember_fact",
          description: "Store a durable fact about an entity (person, org, project, integration) in relational long-term memory.",
          input: RememberInput,
          risk: "LOW",
          sideEffect: "none",
          outputTrust: "trusted",
          execute: async (args) => {
            const id = graph.saveEntity(args.entityType, args.entityName);
            graph.saveAttribute(id, `fact_${Date.now().toString(36)}`, args.fact, 0.9);
            if (args.relatedTo) graph.connect(id, graph.saveEntity(args.relatedTo.type, args.relatedTo.name), args.relatedTo.relationship);
            return { saved: true, entityId: id };
          },
        }),
      );
    }
    return tools;
  }

  private async finish(status: RunResult["status"], transcript: ChatMessage[], output: string, error?: { code: string; message: string }): Promise<RunResult> {
    this.runs.saveTranscript(this.options.runId, transcript);
    this.runs.setStatus(this.options.runId, status, error?.message ?? null);
    const snapshot = this.budget.snapshot();
    this.runs.heartbeat(this.options.runId, { turnCount: snapshot.turns, costUsd: snapshot.costUsd });
    const pending = this.approvals?.pending(this.options.runId) ?? [];
    await this.emitter.emit({
      type: "status",
      content: status === "COMPLETED" ? "Run completed." : status === "PENDING_APPROVAL" ? "Run paused for human approval." : `Run ${status.toLowerCase()}${error ? `: ${error.message}` : ""}`,
      logType: status === "COMPLETED" ? "success" : status === "PENDING_APPROVAL" ? "warning" : "error",
      status,
    });
    await this.options.tracer?.flush();
    return {
      runId: this.options.runId,
      status,
      output,
      turnCount: snapshot.turns,
      costUsd: Number(snapshot.costUsd.toFixed(6)),
      pendingApprovals: pending.map((p) => ({ approvalId: p.id, tool: p.tool, reason: p.reason })),
      ...(error ? { error } : {}),
      trajectory: [...this.trajectory],
      toolCalls: [...this.toolLog],
    };
  }
}
