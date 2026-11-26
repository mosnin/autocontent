import { z } from "zod";
import { AgentError } from "../errors.ts";
import type { TenantSecurityContext } from "../tenancy/tenancy.ts";
import { type AgentToolDefinition, defineAgentTool } from "./define.ts";

/**
 * Typed, read-only analytics query factory (spec "queryTenantMetricsFactory",
 * `databaseFactoryTools.ts`). The model picks metrics from an enum built from
 * your config, a validated ISO-8601 date range and optional typed filters. It
 * never names the tenant: the tenant comes from the executing context, so a
 * prompt-injected tenant id has nowhere to go (extra keys are rejected and the
 * executor's payload scan refuses foreign tenant references).
 */

export const QUERY_FILTER_OPERATORS = ["eq", "neq", "gt", "lt", "contains"] as const;
export type QueryFilterOperator = (typeof QUERY_FILTER_OPERATORS)[number];

export interface QueryFilter {
  field: string;
  operator: QueryFilterOperator;
  value: string;
}

/** The validated, normalized date range handed to `run()`. `endIso` is clamped to "now" unless `allowFuture`. */
export interface QueryDateRange {
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
  /** Length of the range in days (fractional). */
  days: number;
}

export interface QueryMetricContext {
  tenant: TenantSecurityContext;
  signal: AbortSignal;
  /** Free-form host services from the executor context (env bindings, clients). */
  services: Record<string, unknown>;
}

export interface QueryMetricDefinition {
  /** Shown to the model in the metric enum description. */
  description: string;
  /** Filter fields this metric accepts (`field → description`). Omit for none. */
  filters?: Record<string, string>;
  /**
   * Fetch the metric for ONE tenant (read-only). `tenantId` is the executing tenant, never a model argument.
   * Call your SaaS analytics API or warehouse proxy here with a read-only credential.
   */
  run(tenantId: string, range: QueryDateRange, filters: QueryFilter[], ctx: QueryMetricContext): Promise<unknown> | unknown;
}

export interface QueryFactoryToolOptions {
  /** Tool name. Default `query_tenant_metrics_factory` (the spec's DataAnalyst contract). */
  name?: string;
  description?: string;
  /** Metric name → definition. Names become the `metrics` enum (`[a-z0-9_]`, at most 64 chars). */
  metrics: Record<string, QueryMetricDefinition>;
  /** Longest allowed range in days (blocks runaway scans). */
  maxRangeDays: number;
  /** Most metrics per call. Default 5. */
  maxMetricsPerCall?: number;
  /** Most filters per call. Default 5. */
  maxFilters?: number;
  /** Allow ranges that end in the future (forecasts). Default false: the end is clamped to now and a future start is rejected. */
  allowFuture?: boolean;
  timeoutMs?: number;
  maxOutputChars?: number;
  /** Default "untrusted": the results come from an external system and are wrapped before the model reads them. */
  outputTrust?: "trusted" | "untrusted";
  clock?: () => number;
}

export interface QueryFactoryResult {
  status: "SUCCESS_DATA_FOUND" | "PARTIAL";
  range: { startIso: string; endIso: string; days: number };
  results: Record<string, unknown>;
  errors?: Record<string, string>;
  timestamp: number;
}

const DAY_MS = 86_400_000;
const FUTURE_SKEW_MS = 5 * 60_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_PATTERN = "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,9})?)?(Z|[+-]\\d{2}:\\d{2}))?$";

/** Parse an ISO-8601 date (`2026-01-31`) or date-time with offset. Date-only ends cover the whole day. Null if invalid. */
export function parseIsoInstant(value: string, edge: "start" | "end"): number | null {
  const date = ISO_DATE.exec(value);
  if (date) {
    const [y, m, d] = [Number(date[1]), Number(date[2]), Number(date[3])];
    const ms = Date.UTC(y, m - 1, d);
    const check = new Date(ms);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    return edge === "start" ? ms : ms + DAY_MS - 1;
  }
  const dt = ISO_DATE_TIME.exec(value);
  if (!dt) return null;
  const [y, m, d, hh, mm, ss] = [Number(dt[1]), Number(dt[2]), Number(dt[3]), Number(dt[4]), Number(dt[5]), Number(dt[6] ?? 0)];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || hh > 23 || mm > 59 || ss > 59) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Build the read-only, LOW-risk query factory tool. Mount it on an analyst agent:
 *
 *   createQueryFactoryTool({
 *     maxRangeDays: 366,
 *     metrics: {
 *       revenue_usd: { description: "Gross revenue in USD", filters: { channel: "Sales channel" }, run: (tenantId, range, filters) => saas.metrics(tenantId, "revenue_usd", range, filters) },
 *     },
 *   })
 */
export function createQueryFactoryTool(options: QueryFactoryToolOptions): AgentToolDefinition {
  const names = Object.keys(options.metrics);
  if (names.length === 0) throw new AgentError("CONFIG_INVALID", "createQueryFactoryTool needs at least one metric.");
  for (const name of names) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) throw new AgentError("CONFIG_INVALID", `Invalid metric name "${name}" (lower-case letters, digits and _, max 64 chars).`);
  }
  if (!Number.isFinite(options.maxRangeDays) || options.maxRangeDays <= 0) throw new AgentError("CONFIG_INVALID", "maxRangeDays must be a positive number.");
  const clock = options.clock ?? Date.now;
  const maxMetrics = Math.max(1, options.maxMetricsPerCall ?? 5);
  const maxFilters = Math.max(0, options.maxFilters ?? 5);
  const filterFields = [...new Set(names.flatMap((n) => Object.keys(options.metrics[n]?.filters ?? {})))];
  for (const field of filterFields) {
    if (!/^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(field)) throw new AgentError("CONFIG_INVALID", `Invalid filter field "${field}".`);
  }

  const metricDocs = names.map((n) => `${n}: ${options.metrics[n]?.description ?? ""}`).join("; ");
  const isoString = (label: string) => z.string().regex(new RegExp(ISO_PATTERN), { message: `${label} must be an ISO-8601 date (YYYY-MM-DD) or date-time with offset.` }).describe(`${label} (ISO-8601, UTC unless an offset is given)`);
  const shape: Record<string, z.ZodType> = {
    metrics: z
      .array(z.enum(names as [string, ...string[]]))
      .min(1, { message: "Request at least one metric." })
      .max(maxMetrics)
      .describe(`Metrics to aggregate (read-only). Available: ${metricDocs}`),
    dateRange: z.strictObject({ startIso: isoString("Range start"), endIso: isoString("Range end") }).describe(`Inclusive date range, at most ${options.maxRangeDays} days.`),
  };
  if (filterFields.length && maxFilters > 0) {
    const fieldDocs = names
      .filter((n) => Object.keys(options.metrics[n]?.filters ?? {}).length)
      .map((n) => `${n} → ${Object.entries(options.metrics[n]?.filters ?? {}).map(([f, d]) => `${f} (${d})`).join(", ")}`)
      .join("; ");
    shape.filters = z
      .array(z.strictObject({ field: z.enum(filterFields as [string, ...string[]]), operator: z.enum(QUERY_FILTER_OPERATORS), value: z.string().max(200) }))
      .max(maxFilters)
      .optional()
      .describe(`Optional segment filters. Supported per metric: ${fieldDocs}`);
  }

  const input = z.strictObject(shape).superRefine((value, issue) => {
    const range = value.dateRange as { startIso: string; endIso: string };
    const start = parseIsoInstant(range.startIso, "start");
    const end = parseIsoInstant(range.endIso, "end");
    if (start === null) issue.addIssue({ code: "custom", path: ["dateRange", "startIso"], message: "Range start is not a valid calendar date/time." });
    if (end === null) issue.addIssue({ code: "custom", path: ["dateRange", "endIso"], message: "Range end is not a valid calendar date/time." });
    if (start === null || end === null) return;
    if (end < start) issue.addIssue({ code: "custom", path: ["dateRange", "endIso"], message: "End date must be greater than or equal to the start date." });
    if (!options.allowFuture && start > clock() + FUTURE_SKEW_MS) issue.addIssue({ code: "custom", path: ["dateRange", "startIso"], message: "Range start is in the future." });
    const effectiveEnd = options.allowFuture ? end : Math.min(end, Math.max(start, clock()));
    if (effectiveEnd - start > options.maxRangeDays * DAY_MS) issue.addIssue({ code: "custom", path: ["dateRange"], message: `Date range exceeds the ${options.maxRangeDays}-day maximum. Narrow it or query in slices.` });
    const filters = (value.filters ?? []) as QueryFilter[];
    for (const [index, filter] of filters.entries()) {
      for (const metric of value.metrics as string[]) {
        if (!(filter.field in (options.metrics[metric]?.filters ?? {}))) {
          issue.addIssue({ code: "custom", path: ["filters", index, "field"], message: `Metric "${metric}" does not support the filter field "${filter.field}".` });
        }
      }
    }
  });

  return defineAgentTool({
    name: options.name ?? "query_tenant_metrics_factory",
    description:
      options.description ??
      "Read-only analytics: aggregate whitelisted metrics for the current workspace over a validated ISO-8601 date range, with optional typed filters. Never updates data. The workspace is implied; do not pass tenant ids.",
    input,
    risk: "LOW",
    sideEffect: "read",
    idempotent: true,
    outputTrust: options.outputTrust ?? "untrusted",
    timeoutMs: options.timeoutMs ?? 20_000,
    maxOutputChars: options.maxOutputChars ?? 12_000,
    tags: ["analytics", "read-only"],
    execute: async (args, ctx): Promise<QueryFactoryResult> => {
      const value = args as { metrics: string[]; dateRange: { startIso: string; endIso: string }; filters?: QueryFilter[] };
      const startMs = parseIsoInstant(value.dateRange.startIso, "start") as number;
      const rawEnd = parseIsoInstant(value.dateRange.endIso, "end") as number;
      const endMs = options.allowFuture ? rawEnd : Math.min(rawEnd, Math.max(startMs, clock()));
      const range: QueryDateRange = { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString(), startMs, endMs, days: Number(((endMs - startMs) / DAY_MS).toFixed(3)) };
      const filters = value.filters ?? [];
      const tenantId = ctx.tenant.tenantId;
      const metricContext: QueryMetricContext = { tenant: ctx.tenant, signal: ctx.signal, services: ctx.services };
      const requested = [...new Set(value.metrics)];
      const settled = await Promise.allSettled(requested.map(async (metric) => (options.metrics[metric] as QueryMetricDefinition).run(tenantId, range, filters, metricContext)));
      const results: Record<string, unknown> = {};
      const errors: Record<string, string> = {};
      settled.forEach((outcome, index) => {
        const metric = requested[index] as string;
        if (outcome.status === "fulfilled") results[metric] = outcome.value;
        else errors[metric] = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      });
      if (Object.keys(results).length === 0) {
        throw new AgentError("TOOL_EXECUTION_FAILED", `Analytics query failed: ${Object.entries(errors).map(([m, e]) => `${m}: ${e}`).join("; ")}`, { retryable: true, details: { errors } });
      }
      return {
        status: Object.keys(errors).length ? "PARTIAL" : "SUCCESS_DATA_FOUND",
        range: { startIso: range.startIso, endIso: range.endIso, days: range.days },
        results,
        ...(Object.keys(errors).length ? { errors } : {}),
        timestamp: clock(),
      };
    },
  }) as unknown as AgentToolDefinition;
}
