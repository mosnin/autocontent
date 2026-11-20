import type { BudgetGuard } from "../budget/budget.ts";
import { AgentError, errorMessage } from "../errors.ts";
import { type Span, SpanAttr, type Tracer } from "../observability/tracer.ts";
import { CircuitBreaker } from "../reliability/circuit-breaker.ts";
import { classifyError, isRetryableError, retry, type RetryPolicy } from "../reliability/retry.ts";
import type { SqlStore } from "../storage/ports.ts";
import type { ModelProvider, ModelRequest, ModelResponse, ModelStreamEvent, ReasoningEffort } from "./types.ts";

export interface ModelProfile {
  provider: ModelProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  /** Human label for dashboards ("first-line", "frontier", ...). */
  label?: string;
}

export interface RouteDecision {
  profile: string;
  reason: string;
}

export interface ModelRouterOptions {
  profiles: Record<string, ModelProfile>;
  /** Ordered fallback chain per profile, e.g. { frontier: ["frontier-backup", "first-line"] }. */
  fallbacks?: Record<string, string[]>;
  defaultProfile: string;
  /** Cheap profile used for complexity classification and utility calls (Workers AI first line). */
  firstLineProfile?: string;
  /** Profile for COMPLEX work. */
  frontierProfile?: string;
  /** Restrict to tenant-allowed profiles (TenantConfig.allowedModelProfiles). */
  allowedProfiles?: string[];
  circuit?: CircuitBreaker;
  retry?: Partial<RetryPolicy>;
  budget?: BudgetGuard;
  tracer?: Tracer;
  parentSpan?: Span;
  /** Persist routing decisions (feeds the routing-density KPI). */
  sql?: SqlStore;
  runId?: string;
  tenantId?: string;
}

export type RoutedRequest = ModelRequest & { profile?: string };

/**
 * Model router with first-line routing and automatic fallback.
 *
 *  - Workers AI as the first line: cheap classification decides whether a task
 *    needs the frontier model at all.
 *  - Fallback: each profile has an ordered chain; transient errors, open circuits
 *    and auth failures move to the next target instead of failing the turn.
 *  - Every call is budget-accounted and traced (prompt, completion, reasoning).
 */
export class ModelRouter implements ModelProvider {
  readonly id = "router";
  readonly circuit: CircuitBreaker;

  constructor(private readonly options: ModelRouterOptions) {
    if (!options.profiles[options.defaultProfile]) throw new AgentError("CONFIG_INVALID", `Default profile "${options.defaultProfile}" is not defined`);
    this.circuit = options.circuit ?? new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
  }

  get defaultModel(): string {
    const profile = this.options.profiles[this.options.defaultProfile] as ModelProfile;
    return profile.model ?? profile.provider.defaultModel;
  }

  withContext(overrides: Partial<Pick<ModelRouterOptions, "budget" | "tracer" | "parentSpan" | "runId" | "tenantId" | "allowedProfiles" | "sql">>): ModelRouter {
    return new ModelRouter({ ...this.options, ...overrides, circuit: this.circuit });
  }

  profile(name: string): ModelProfile | undefined {
    return this.options.profiles[name];
  }

  chain(profile: string): string[] {
    const chain = [profile, ...(this.options.fallbacks?.[profile] ?? [])].filter((p, i, all) => all.indexOf(p) === i && this.options.profiles[p]);
    const allowed = this.options.allowedProfiles;
    const filtered = allowed ? chain.filter((p) => allowed.includes(p)) : chain;
    if (filtered.length === 0) throw new AgentError("MODEL_UNAVAILABLE", `No allowed model profile in chain [${chain.join(", ")}]`);
    return filtered;
  }

  async generate(request: RoutedRequest): Promise<ModelResponse> {
    const chain = this.chain(request.profile ?? this.options.defaultProfile);
    const errors: string[] = [];
    for (const name of chain) {
      const profile = this.options.profiles[name] as ModelProfile;
      const key = `${profile.provider.id}:${profile.model ?? profile.provider.defaultModel}`;
      if (!this.circuit.canRequest(key)) {
        errors.push(`${name}: circuit open`);
        continue;
      }
      try {
        const response = await retry(() => this.callProfile(name, profile, request), { maxAttempts: 2, ...this.options.retry, retryOn: (e) => isRetryableError(e) }, request.signal ? { signal: request.signal } : {});
        this.circuit.recordSuccess(key);
        if (name !== chain[0]) this.logRoute(name, `fallback after: ${errors.join(" | ")}`);
        return response;
      } catch (error) {
        const cls = classifyError(error);
        // Only provider-health failures (5xx, timeouts, network, rate limits) trip the circuit.
        // A 4xx/validation error is the request's fault: counting it would open the circuit for every tenant.
        if (countsAgainstCircuit(error) && !request.signal?.aborted) this.circuit.recordFailure(key);
        errors.push(`${name}: ${errorMessage(error).slice(0, 200)}`);
        if (cls === "validation" || cls === "budget" || request.signal?.aborted) throw error;
      }
    }
    throw new AgentError("MODEL_UNAVAILABLE", `All model targets failed: ${errors.join(" | ")}`, { details: { chain, errors }, retryable: true });
  }

  async *stream(request: RoutedRequest): AsyncIterable<ModelStreamEvent> {
    const name = this.chain(request.profile ?? this.options.defaultProfile)[0] as string;
    const profile = this.options.profiles[name] as ModelProfile;
    if (!profile.provider.stream) {
      const response = await this.generate(request);
      if (response.text) yield { type: "text-delta", delta: response.text };
      yield { type: "done", response };
      return;
    }
    let final: ModelResponse | undefined;
    let emitted = false;
    try {
      for await (const event of profile.provider.stream(this.applyProfile(profile, request))) {
        if (event.type === "done") final = event.response;
        else emitted = true;
        yield event;
      }
      if (final) this.account(profile, final);
    } catch (error) {
      // Once a partial answer reached the consumer, a fallback would repeat it (R21): surface the failure instead.
      if (final || emitted || !isRetryableError(error)) throw error;
      // Failure before any output: fall back to a non-streaming call on the chain.
      const response = await this.generate({ ...request, profile: (this.options.fallbacks?.[name] ?? [])[0] ?? name });
      if (response.text) yield { type: "text-delta", delta: response.text };
      yield { type: "done", response };
    }
  }

  /** First-line routing: a cheap model decides SIMPLE vs COMPLEX; frontier is reserved for heavy reasoning. */
  async route(task: string, hints: { forceProfile?: string } = {}): Promise<RouteDecision> {
    if (hints.forceProfile) return this.logRoute(hints.forceProfile, "forced");
    const firstLine = this.options.firstLineProfile;
    const frontier = this.options.frontierProfile ?? this.options.defaultProfile;
    if (!firstLine) return this.logRoute(frontier, "no first-line profile configured");
    try {
      const label = await this.classify(task, ["SIMPLE", "COMPLEX"], {
        instructions:
          "SIMPLE = greetings, FAQ lookups, formatting, short factual answers, single obvious tool call. COMPLEX = multi-step reasoning, planning, code, analysis, ambiguous or high-stakes requests.",
        fallback: "COMPLEX",
      });
      return this.logRoute(label === "SIMPLE" ? firstLine : frontier, `first-line classified ${label}`);
    } catch (error) {
      return this.logRoute(frontier, `classifier unavailable: ${errorMessage(error).slice(0, 120)}`);
    }
  }

  /** Constrained label classification on the first-line model (falls back to `fallback` on any doubt). */
  async classify<L extends string>(text: string, labels: readonly L[], options: { instructions?: string; fallback: L }): Promise<L> {
    const profile = this.options.firstLineProfile ?? this.options.defaultProfile;
    const response = await this.generate({
      profile,
      messages: [
        {
          role: "system",
          content: `You are a high-speed routing classifier. Reply with exactly one label from: ${labels.join(", ")}. No other text.${options.instructions ? `\n${options.instructions}` : ""}`,
        },
        { role: "user", content: text.slice(0, 6000) },
      ],
      temperature: 0,
      maxOutputTokens: 16,
    });
    const upper = response.text.trim().toUpperCase();
    return labels.find((l) => upper.includes(l.toUpperCase())) ?? options.fallback;
  }

  private applyProfile(profile: ModelProfile, request: ModelRequest): ModelRequest {
    return {
      ...request,
      model: request.model ?? profile.model ?? profile.provider.defaultModel,
      ...(request.reasoningEffort ?? profile.reasoningEffort ? { reasoningEffort: request.reasoningEffort ?? profile.reasoningEffort } : {}),
      ...(request.temperature ?? profile.temperature) !== undefined ? { temperature: request.temperature ?? profile.temperature } : {},
    };
  }

  private async callProfile(name: string, profile: ModelProfile, request: RoutedRequest): Promise<ModelResponse> {
    const { profile: _p, ...rest } = request;
    const effective = this.applyProfile(profile, rest);
    const span = this.options.tracer?.startSpan(`llm:${name}`, {
      kind: "llm",
      ...(this.options.parentSpan ? { parent: this.options.parentSpan } : {}),
      attributes: {
        [SpanAttr.system]: profile.provider.id,
        [SpanAttr.requestModel]: effective.model,
        [SpanAttr.prompt]: effective.messages,
        ...(this.options.tenantId ? { [SpanAttr.tenantId]: this.options.tenantId } : {}),
        ...(this.options.runId ? { [SpanAttr.runId]: this.options.runId } : {}),
      },
    });
    try {
      const response = await profile.provider.generate(effective);
      const cost = this.account(profile, response);
      span?.setAttributes({
        [SpanAttr.responseModel]: response.model,
        [SpanAttr.completion]: response.text || JSON.stringify(response.toolCalls),
        [SpanAttr.reasoning]: response.reasoning,
        [SpanAttr.inputTokens]: response.usage.inputTokens,
        [SpanAttr.outputTokens]: response.usage.outputTokens,
        [SpanAttr.reasoningTokens]: response.usage.reasoningTokens,
        [SpanAttr.costUsd]: cost,
      });
      span?.end("ok");
      return response;
    } catch (error) {
      span?.fail(error);
      throw error;
    }
  }

  private account(profile: ModelProfile, response: ModelResponse): number {
    if (response.cached) return 0;
    return this.options.budget?.recordModelUsage(response.model || profile.model || profile.provider.defaultModel, response.usage) ?? 0;
  }

  private logRoute(profile: string, reason: string): RouteDecision {
    try {
      this.options.sql?.exec(
        `INSERT INTO as_router_log (run_id, tenant_id, routed_to, profile, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        this.options.runId ?? null,
        this.options.tenantId ?? null,
        this.options.profiles[profile]?.model ?? this.options.profiles[profile]?.provider.defaultModel ?? profile,
        profile,
        reason,
        Date.now(),
      );
    } catch {
      // Routing must never fail because analytics logging failed.
    }
    return { profile, reason };
  }
}

/** True for failures that say the provider is unhealthy (retryable: 5xx, timeouts, network, rate limits). */
export function countsAgainstCircuit(error: unknown): boolean {
  return isRetryableError(error);
}

/** Wrap any provider so `generate({ profile })` requests are accepted (single-profile router). */
export function singleProviderRouter(provider: ModelProvider, options: Partial<ModelRouterOptions> = {}): ModelRouter {
  return new ModelRouter({ profiles: { default: { provider } }, defaultProfile: "default", ...options });
}
