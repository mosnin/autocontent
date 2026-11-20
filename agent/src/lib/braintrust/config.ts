/**
 * Braintrust configuration (docs/observability/braintrust.md). Pure: reads plain env values, no platform import, so
 * it loads in Node tests.
 *
 * Off unless BRAINTRUST_API_KEY and BRAINTRUST_PROJECT_ID are both set (rule 1). BRAINTRUST_API_URL picks the region
 * or a self-hosted data plane (rule 10). BRAINTRUST_CONTENT is `redacted` (default) or `metadata` (rule 4); any other
 * value means `metadata`, so a typo never sends more than intended.
 */

export type ContentMode = "redacted" | "metadata";

export const DEFAULT_BRAINTRUST_API_URL = "https://api.braintrust.dev";

export interface BraintrustEnv {
  BRAINTRUST_API_KEY?: string;
  BRAINTRUST_PROJECT_ID?: string;
  BRAINTRUST_API_URL?: string;
  BRAINTRUST_CONTENT?: string;
}

export interface BraintrustConfig {
  apiUrl: string;
  apiKey: string;
  projectId: string;
  /** The global content mode; a workspace can only lower it to `metadata`. */
  content: ContentMode;
}

/** Parse a content mode: empty means the default (`redacted`), anything unknown means `metadata`. */
export function parseContentMode(raw: unknown): ContentMode {
  if (raw === undefined || raw === null) return "redacted";
  if (typeof raw !== "string") return "metadata";
  const value = raw.trim().toLowerCase();
  if (value === "" || value === "redacted") return "redacted";
  return "metadata";
}

/** The Braintrust config, or undefined when it is not configured (nothing is sent). */
export function braintrustConfig(env: BraintrustEnv | Record<string, unknown> | undefined): BraintrustConfig | undefined {
  if (!env) return undefined;
  const e = env as BraintrustEnv;
  const apiKey = typeof e.BRAINTRUST_API_KEY === "string" ? e.BRAINTRUST_API_KEY.trim() : "";
  const projectId = typeof e.BRAINTRUST_PROJECT_ID === "string" ? e.BRAINTRUST_PROJECT_ID.trim() : "";
  if (!apiKey || !projectId) return undefined;
  const rawUrl = typeof e.BRAINTRUST_API_URL === "string" && e.BRAINTRUST_API_URL.trim() ? e.BRAINTRUST_API_URL.trim() : DEFAULT_BRAINTRUST_API_URL;
  return { apiUrl: rawUrl.replace(/\/+$/, ""), apiKey, projectId, content: parseContentMode(e.BRAINTRUST_CONTENT) };
}

/** The OTLP traces endpoint for a config. */
export const tracesEndpoint = (config: Pick<BraintrustConfig, "apiUrl">): string => `${config.apiUrl}/otel/v1/traces`;

/** Request headers for Braintrust (OTLP and REST). Never logged. */
export function braintrustHeaders(config: Pick<BraintrustConfig, "apiKey" | "projectId">): Record<string, string> {
  return { authorization: `Bearer ${config.apiKey}`, "x-bt-parent": `project_id:${config.projectId}` };
}
