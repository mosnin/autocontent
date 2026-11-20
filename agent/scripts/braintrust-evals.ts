/**
 * Agent evals as a Braintrust experiment, compared with the main-branch baseline (docs/observability/braintrust.md,
 * "As built (agent)"). Plain Node (type stripping, Node >= 22.18) and plain fetch: no Braintrust SDK.
 *
 *   node scripts/braintrust-evals.ts                       offline suite only (what CI runs)
 *   node scripts/braintrust-evals.ts --promptfoo out.json   also upload a promptfoo results file
 *                                                          (`pnpm evals -o out.json`, `pnpm evals:decisions -o out.json`)
 *   node scripts/braintrust-evals.ts --dry-run              run and print, never upload
 *
 * Suites:
 *  - offline (always, no model key, no network): the decision-model conformance cases (docs/decisions/conformance)
 *    replayed through the production decision client with a stubbed fetch. One row per case, score `conformance`.
 *  - promptfoo (optional): the agent-harness suites (evals/*.yaml) and the live decision suites need a running agent
 *    or a model key, so they are uploaded from a results file produced elsewhere. One row per test, scores `pass` and
 *    `score`.
 *
 * Upload: only when BRAINTRUST_API_KEY and BRAINTRUST_PROJECT_ID are set (BRAINTRUST_API_URL picks the region). The
 * experiment records branch and commit; its baseline is the newest experiment of this suite on BRAINTRUST_BASE_BRANCH
 * (default main). Exit code 1 when an offline case fails or the upload fails; 0 when the upload is skipped.
 */
import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requestDecision } from "../src/marketer/decisions/client.ts";
import type { DecisionQuestion } from "../src/marketer/decisions/questions.ts";

export const SUITE = "agent-evals";

export interface EvalRow {
  id: string;
  input: unknown;
  output: unknown;
  expected?: unknown;
  scores: Record<string, number>;
  metadata: Record<string, unknown>;
  tags: string[];
}

interface ConformanceCase {
  name: string;
  model: string;
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  response: { status: number; body?: unknown; raw?: string };
  expect: { ok: true; answers: Record<string, unknown>; cost: number; tokens: number; model: string } | { ok: false; kind: string };
}

const CONFORMANCE_DIR = fileURLToPath(new URL("../../docs/decisions/conformance/", import.meta.url));

/** Replay every conformance case through the production client (stubbed fetch, no network). */
export async function runConformanceSuite(dir = CONFORMANCE_DIR): Promise<EvalRow[]> {
  const contract = JSON.parse(readFileSync(`${dir}contract.json`, "utf8")) as { cases: string[] };
  const listed = new Set(contract.cases);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "contract.json");
  const rows: EvalRow[] = [];
  for (const file of files.sort()) {
    const c = JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as ConformanceCase;
    const stub = (async () => new Response(c.response.raw ?? JSON.stringify(c.response.body), { status: c.response.status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const result = await requestDecision({ env: { OPENROUTER_API_KEY: "offline-eval-key-not-real" }, fetch: stub }, c.state, c.questions, { timeoutMs: 500, model: c.model });
    const output = result.ok ? { ok: true, answers: result.answers, cost: result.cost, tokens: result.tokens, model: result.model } : { ok: false, kind: result.kind };
    const pass = c.expect.ok
      ? result.ok && JSON.stringify(result.answers) === JSON.stringify(c.expect.answers) && result.cost === c.expect.cost && result.tokens === c.expect.tokens && result.model === c.expect.model
      : !result.ok && result.kind === c.expect.kind;
    rows.push({
      id: `decision-conformance:${c.name}`,
      input: { case: c.name, model: c.model, questions: Object.keys(c.questions) },
      output,
      expected: c.expect,
      scores: { conformance: pass ? 1 : 0 },
      metadata: { suite: "decision-conformance", listedInContract: listed.has(c.name) },
      tags: ["offline", "decisions"],
    });
  }
  return rows;
}

interface PromptfooRow {
  success?: boolean;
  score?: number;
  testCase?: { description?: string; vars?: Record<string, unknown> };
  vars?: Record<string, unknown>;
  response?: { output?: unknown };
  gradingResult?: { reason?: string };
  latencyMs?: number;
  cost?: number;
  error?: string;
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const scrub = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value).replace(EMAIL, "[REDACTED_EMAIL]")));

/** Rows from a promptfoo results file (`promptfoo eval -o file.json`). Outputs come from eval tenants; emails are still replaced. */
export function promptfooRows(json: unknown, source: string): EvalRow[] {
  const root = json as { results?: { results?: PromptfooRow[] } | PromptfooRow[] };
  const list: PromptfooRow[] = Array.isArray(root?.results) ? root.results : Array.isArray(root?.results?.results) ? root.results.results : [];
  return list.map((row, i) => {
    const description = row.testCase?.description ?? `case ${i + 1}`;
    const score = typeof row.score === "number" && Number.isFinite(row.score) ? Math.min(1, Math.max(0, row.score)) : row.success ? 1 : 0;
    return {
      id: `${source}:${i}:${description}`.slice(0, 500),
      input: scrub({ description, vars: row.vars ?? row.testCase?.vars }),
      output: scrub(row.response?.output ?? row.error ?? null),
      scores: { pass: row.success ? 1 : 0, score },
      metadata: { suite: source, reason: typeof row.gradingResult?.reason === "string" ? String(scrub(row.gradingResult.reason)).slice(0, 2_000) : undefined, latencyMs: row.latencyMs, cost: row.cost },
      tags: ["promptfoo"],
    };
  });
}

export interface UploadOptions {
  apiUrl: string;
  apiKey: string;
  projectId: string;
  name: string;
  branch: string;
  commit: string;
  baseBranch: string;
  fetch?: typeof fetch;
}

async function bt<T>(options: UploadOptions, path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(`${options.apiUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}`, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Braintrust ${init.method ?? "GET"} ${path.split("?")[0]} failed: HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface Experiment {
  id: string;
  name?: string;
  created?: string;
  metadata?: Record<string, unknown> | null;
}

/** The newest experiment of this suite on the base branch (never the one just created). */
export async function findBaseline(options: UploadOptions, excludeId?: string): Promise<Experiment | undefined> {
  const list = await bt<{ objects?: Experiment[] }>(options, `/v1/experiment?project_id=${encodeURIComponent(options.projectId)}&limit=100`);
  return (list.objects ?? [])
    .filter((e) => e.id !== excludeId && e.metadata?.suite === SUITE && e.metadata?.branch === options.baseBranch)
    .sort((a, b) => String(b.created ?? "").localeCompare(String(a.created ?? "")))[0];
}

/** Create the experiment (baseline = newest main run), insert the rows, return the comparison summary. */
export async function uploadExperiment(options: UploadOptions, rows: EvalRow[]): Promise<{ experimentId: string; baselineId?: string; summary: unknown }> {
  const baseline = await findBaseline(options);
  const experiment = await bt<Experiment>(options, "/v1/experiment", {
    method: "POST",
    body: JSON.stringify({
      project_id: options.projectId,
      name: options.name,
      ensure_new: true,
      repo_info: { commit: options.commit || null, branch: options.branch || null },
      metadata: { suite: SUITE, branch: options.branch, commit: options.commit },
      ...(baseline ? { base_exp_id: baseline.id } : {}),
    }),
  });
  for (let i = 0; i < rows.length; i += 100) {
    const events = rows.slice(i, i + 100).map((r) => ({ id: r.id, input: r.input, output: r.output, ...(r.expected !== undefined ? { expected: r.expected } : {}), scores: r.scores, metadata: r.metadata, tags: r.tags }));
    await bt(options, `/v1/experiment/${experiment.id}/insert`, { method: "POST", body: JSON.stringify({ events }) });
  }
  const query = new URLSearchParams({ summarize_scores: "true", ...(baseline ? { comparison_experiment_id: baseline.id } : {}) });
  const summary = await bt<unknown>(options, `/v1/experiment/${experiment.id}/summarize?${query.toString()}`).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  return { experimentId: experiment.id, ...(baseline ? { baselineId: baseline.id } : {}), summary };
}

function scoreAverages(rows: EvalRow[]): Record<string, { mean: number; n: number }> {
  const out: Record<string, { mean: number; n: number }> = {};
  for (const row of rows) {
    for (const [name, value] of Object.entries(row.scores)) {
      const entry = (out[name] ??= { mean: 0, n: 0 });
      entry.mean = (entry.mean * entry.n + value) / (entry.n + 1);
      entry.n += 1;
    }
  }
  return out;
}

async function main(argv: string[]): Promise<number> {
  const dryRun = argv.includes("--dry-run");
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--promptfoo" && argv[i + 1]) files.push(argv[++i] as string);
  const nameFlag = argv.indexOf("--name");

  const rows = await runConformanceSuite();
  for (const file of files) rows.push(...promptfooRows(JSON.parse(readFileSync(file, "utf8")), file.replace(/^.*\//, "").replace(/\.json$/, "")));
  const failedOffline = rows.filter((r) => r.scores.conformance === 0);
  const averages = scoreAverages(rows);
  console.log(`[evals] ${rows.length} rows; ${Object.entries(averages).map(([k, v]) => `${k} ${(v.mean * 100).toFixed(1)}% (n=${v.n})`).join(", ")}`);
  for (const r of failedOffline) console.log(`[evals] FAILED ${r.id}`);

  const env = process.env;
  const apiKey = (env.BRAINTRUST_API_KEY ?? "").trim();
  const projectId = (env.BRAINTRUST_PROJECT_ID ?? "").trim();
  if (dryRun || !apiKey || !projectId) {
    console.log(dryRun ? "[evals] dry run: nothing uploaded" : "[evals] BRAINTRUST_API_KEY / BRAINTRUST_PROJECT_ID not set: upload skipped");
    return failedOffline.length ? 1 : 0;
  }
  const branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || "local";
  const commit = env.GITHUB_SHA ?? "";
  const options: UploadOptions = {
    apiUrl: ((env.BRAINTRUST_API_URL ?? "").trim() || "https://api.braintrust.dev").replace(/\/+$/, ""),
    apiKey,
    projectId,
    branch,
    commit,
    baseBranch: env.BRAINTRUST_BASE_BRANCH || "main",
    name: nameFlag >= 0 && argv[nameFlag + 1] ? (argv[nameFlag + 1] as string) : `${SUITE} ${branch}@${commit.slice(0, 7) || "local"}`,
  };
  try {
    const result = await uploadExperiment(options, rows);
    console.log(`[evals] experiment ${result.experimentId}${result.baselineId ? ` compared with ${result.baselineId}` : " (no baseline yet)"}`);
    console.log(JSON.stringify(result.summary, null, 2).slice(0, 8_000));
    if (env.GITHUB_STEP_SUMMARY) {
      const lines = [`### Agent evals (Braintrust)`, "", `Experiment \`${options.name}\`${result.baselineId ? ` vs baseline \`${result.baselineId}\`` : " (no main baseline yet)"}`, "", "| Score | Mean | n |", "| --- | --- | --- |", ...Object.entries(averages).map(([k, v]) => `| ${k} | ${(v.mean * 100).toFixed(1)}% | ${v.n} |`), ""];
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
    }
  } catch (error) {
    // Our own message (method, path, status); never the key.
    console.error(`[evals] upload failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  return failedOffline.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error("[evals]", error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
