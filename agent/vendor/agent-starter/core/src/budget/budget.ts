import { type BudgetBreach, BudgetExceededError } from "../errors.ts";
import type { TokenUsage } from "../models/types.ts";
import type { SqlStore } from "../storage/ports.ts";

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens (reasoning tokens are billed as output). */
  output: number;
  /** USD per 1M cached input tokens. */
  cachedInput?: number;
}

/**
 * Cost estimates used for circuit breaking. Values are per 1M tokens and are
 * deliberately overridable: set real contract pricing via `CostModel.set()` or
 * the `pricing` config. Flue `turn` events report provider-computed cost and are
 * preferred when available.
 */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // OpenAI list prices (USD / 1M tokens) for prompts under the 272k-token tier.
  "gpt-6.1-terra": { input: 1, output: 5, cachedInput: 0.05 },
  "gpt-5.5": { input: 1.25, output: 10, cachedInput: 0.125 },
  // Workers AI
  "@cf/openai/gpt-oss-20b": { input: 0.2, output: 0.3 },
  "@cf/openai/gpt-oss-120b": { input: 0.35, output: 0.75 },
  "@cf/moonshotai/kimi-k2.6": { input: 0.95, output: 4, cachedInput: 0.16 },
  "@cf/meta/llama-3.1-8b-instruct": { input: 0.282, output: 0.827 },
  "@cf/meta/llama-3.1-8b-instruct-fast": { input: 0.045, output: 0.384 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 0.293, output: 2.253 },
  "@cf/baai/bge-small-en-v1.5": { input: 0.02, output: 0 },
  "@cf/baai/bge-base-en-v1.5": { input: 0.067, output: 0 },
  "@cf/baai/bge-reranker-base": { input: 0.003, output: 0 },
  "*frontier*": { input: 1.25, output: 10, cachedInput: 0.125 },
};

export class CostModel {
  private readonly table: Map<string, ModelPricing>;

  constructor(overrides: Record<string, ModelPricing> = {}, private readonly fallback: ModelPricing = DEFAULT_PRICING["*frontier*"] as ModelPricing) {
    this.table = new Map(Object.entries({ ...DEFAULT_PRICING, ...overrides }));
  }

  set(model: string, pricing: ModelPricing): void {
    this.table.set(model, pricing);
  }

  pricing(model: string): ModelPricing {
    const bare = model.includes("/") && !model.startsWith("@cf/") ? model.slice(model.indexOf("/") + 1) : model;
    return this.table.get(model) ?? this.table.get(bare) ?? this.fallback;
  }

  estimate(model: string, usage: TokenUsage): number {
    const p = this.pricing(model);
    const cached = usage.cachedInputTokens ?? 0;
    const freshInput = Math.max(0, usage.inputTokens - cached);
    const output = usage.outputTokens + (usage.reasoningTokens ?? 0);
    return (freshInput * p.input + cached * (p.cachedInput ?? p.input) + output * p.output) / 1_000_000;
  }
}

export interface BudgetLimits {
  maxTurns: number;
  maxCostUsd: number;
  maxTokens?: number;
  maxWallClockMs?: number;
  maxToolCalls?: number;
  maxVmSeconds?: number;
}

export interface BudgetSnapshot {
  turns: number;
  costUsd: number;
  tokens: number;
  toolCalls: number;
  vmSeconds: number;
  startedAt: number;
}

export interface BudgetGuardOptions {
  runId: string;
  tenantId: string;
  limits: BudgetLimits;
  sql?: SqlStore;
  costModel?: CostModel;
  /** Fired once on the first breach: snapshot to R2, tear down VMs, alert. */
  onBreach?: (breach: BudgetBreach, snapshot: BudgetSnapshot) => Promise<void> | void;
  clock?: () => number;
}

/**
 * Autonomous budget gatekeeper: turn and cost accounting recorded at the end of
 * every loop turn (SQLite ledger co-located with the agent, cached in memory),
 * with hard circuit breakers checked before each turn and tool call.
 */
export class BudgetGuard {
  readonly limits: BudgetLimits;
  readonly costModel: CostModel;
  private state: BudgetSnapshot | null = null;
  private breached: BudgetBreach | null = null;
  private readonly clock: () => number;

  constructor(private readonly options: BudgetGuardOptions) {
    this.limits = options.limits;
    this.costModel = options.costModel ?? new CostModel();
    this.clock = options.clock ?? Date.now;
  }

  snapshot(): BudgetSnapshot {
    if (this.state) return { ...this.state };
    const base: BudgetSnapshot = { turns: 0, costUsd: 0, tokens: 0, toolCalls: 0, vmSeconds: 0, startedAt: this.clock() };
    if (this.options.sql) {
      const row = this.options.sql.exec<{ turns: number | null; cost: number | null; tokens: number | null; tools: number | null; vm: number | null; started: number | null }>(
        `SELECT SUM(CASE WHEN kind = 'turn' THEN 1 ELSE 0 END) AS turns, SUM(cost_usd) AS cost,
                SUM(input_tokens + output_tokens + reasoning_tokens) AS tokens,
                SUM(CASE WHEN kind = 'tool' THEN 1 ELSE 0 END) AS tools, SUM(vm_seconds) AS vm, MIN(created_at) AS started
         FROM as_budget_ledger WHERE run_id = ?`,
        this.options.runId,
      )[0];
      if (row) {
        base.turns = Number(row.turns ?? 0);
        base.costUsd = Number(row.cost ?? 0);
        base.tokens = Number(row.tokens ?? 0);
        base.toolCalls = Number(row.tools ?? 0);
        base.vmSeconds = Number(row.vm ?? 0);
        if (row.started !== null) base.startedAt = Number(row.started);
      }
    }
    this.state = base;
    return { ...base };
  }

  breach(): BudgetBreach | null {
    const s = this.snapshot();
    const l = this.limits;
    if (s.turns >= l.maxTurns) return { limit: "turns", used: s.turns, max: l.maxTurns };
    if (s.costUsd >= l.maxCostUsd) return { limit: "costUsd", used: Number(s.costUsd.toFixed(6)), max: l.maxCostUsd };
    if (l.maxTokens !== undefined && s.tokens >= l.maxTokens) return { limit: "tokens", used: s.tokens, max: l.maxTokens };
    if (l.maxToolCalls !== undefined && s.toolCalls >= l.maxToolCalls) return { limit: "toolCalls", used: s.toolCalls, max: l.maxToolCalls };
    if (l.maxVmSeconds !== undefined && s.vmSeconds >= l.maxVmSeconds) return { limit: "vmSeconds", used: s.vmSeconds, max: l.maxVmSeconds };
    if (l.maxWallClockMs !== undefined && this.clock() - s.startedAt >= l.maxWallClockMs) return { limit: "wallClockMs", used: this.clock() - s.startedAt, max: l.maxWallClockMs };
    return null;
  }

  /** Throws BUDGET_LIMIT_EXCEEDED (and fires onBreach once) when any ceiling is reached. */
  async check(): Promise<void> {
    const breach = this.breach();
    if (!breach) return;
    if (!this.breached) {
      this.breached = breach;
      await this.options.onBreach?.(breach, this.snapshot());
    }
    throw new BudgetExceededError(breach);
  }

  remaining(): { turns: number; costUsd: number } {
    const s = this.snapshot();
    return { turns: Math.max(0, this.limits.maxTurns - s.turns), costUsd: Math.max(0, this.limits.maxCostUsd - s.costUsd) };
  }

  recordTurn(): void {
    this.append({ kind: "turn" });
  }

  /** Record a model call. Pass `costUsd` when the provider/harness reports it; otherwise it is estimated. */
  recordModelUsage(model: string, usage: TokenUsage, costUsd?: number): number {
    const cost = costUsd ?? this.costModel.estimate(model, usage);
    this.append({ kind: "model", model, usage, cost });
    return cost;
  }

  recordToolCall(costUsd = 0): void {
    this.append({ kind: "tool", cost: costUsd });
  }

  recordVm(seconds: number, costUsd: number): void {
    this.append({ kind: "vm", vmSeconds: seconds, cost: costUsd });
  }

  private append(entry: { kind: "turn" | "model" | "tool" | "vm"; model?: string; usage?: TokenUsage; cost?: number; vmSeconds?: number }): void {
    const s = this.snapshot();
    const usage = entry.usage;
    const tokens = usage ? usage.inputTokens + usage.outputTokens + (usage.reasoningTokens ?? 0) : 0;
    this.state = {
      ...s,
      turns: s.turns + (entry.kind === "turn" ? 1 : 0),
      toolCalls: s.toolCalls + (entry.kind === "tool" ? 1 : 0),
      costUsd: s.costUsd + (entry.cost ?? 0),
      tokens: s.tokens + tokens,
      vmSeconds: s.vmSeconds + (entry.vmSeconds ?? 0),
    };
    this.options.sql?.exec(
      `INSERT INTO as_budget_ledger (run_id, tenant_id, kind, model, input_tokens, output_tokens, reasoning_tokens, cost_usd, vm_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      this.options.runId,
      this.options.tenantId,
      entry.kind,
      entry.model ?? null,
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
      usage?.reasoningTokens ?? 0,
      entry.cost ?? 0,
      entry.vmSeconds ?? 0,
      this.clock(),
    );
  }
}
