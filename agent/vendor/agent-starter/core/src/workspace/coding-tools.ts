import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { AgentError } from "../errors.ts";
import type { SqlStore } from "../storage/ports.ts";
import type { TenantConfig } from "../tenancy/tenancy.ts";
import { type AnyAgentTool, defineAgentTool, type ToolExecutionContext } from "../tools/define.ts";
import { VERBATIM_OUTPUT_TAG } from "../tools/output-store.ts";
import { sha256Hex } from "../util/crypto.ts";
import type { AgentGit, Tree } from "./agent-git.ts";
import type { GitHubClient, GitHubRepoRef } from "./github.ts";
import { readTree, type SandboxPort, type SyncManifest, syncTreeToSandbox } from "./sandbox-sync.ts";
import type { WorkspaceFS } from "./workspace-fs.ts";

/**
 * Coding-agent tools (Cursor-class loop): plan → branch → edit (R2 workspace)
 * → run_tests in a VM (the committed branch head is synced into the sandbox) →
 * review the branch diff → merge_to_main (HIGH, approval, last tests on that
 * exact commit must pass) or push_branch + open_pull_request (HIGH, approval).
 *
 * Branch protection: every branch argument must match `<prefix><name>`
 * (default `agent/…`); `main` is reachable only through `merge_to_main`.
 * The repository, token and sandbox come from trusted host wiring, never from
 * tool arguments.
 */

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

export interface BranchDiff {
  branch: string;
  commitId: string | null;
  base: string | null;
  files: FileChange[];
  /** Unified multi-file patch (a/… b/…). */
  patch: string;
}

export interface CodingRemote {
  client: GitHubClient;
  repo: GitHubRepoRef;
}

type Feature = keyof TenantConfig["features"];

export interface CodingToolsOptions {
  fs: () => WorkspaceFS;
  git: () => AgentGit;
  /** The agent's own SQLite (test results, sync manifests, remote metadata). */
  sql: () => SqlStore;
  agentId?: string;
  /** Writable branch namespace. Default "agent/". */
  branchPrefix?: string;
  /** Protected integration branch. Default "main". */
  mainBranch?: string;
  /**
   * Run `fn` against this run's sandbox VM. The host resolves the VM from
   * trusted context, meters it and enforces budgets; `sandboxKey` identifies the
   * VM (a new VM gets a full sync).
   */
  sandbox?: <T>(ctx: ToolExecutionContext, fn: (port: SandboxPort, sandboxKey: string) => Promise<T>) => Promise<T>;
  /** Directory the branch is synced to, relative to the sandbox home. Default "workspace/repo". */
  sandboxDir?: string;
  /** Fixed test suites the model may choose from (name → command). Default { test: "npm test" }. */
  testCommands?: Record<string, string>;
  /** Runs before tests on a fresh sandbox or when a dependency manifest changed (e.g. "npm ci"). */
  setupCommand?: string;
  setupTriggers?: string[];
  /** Hard timeout per test/setup command. Default 300, max 600. */
  testTimeoutSeconds?: number;
  /** Tenant flags required by sandbox tools. Default ["computerUse"]. */
  sandboxFeatures?: Feature[];
  /** GitHub remote for this tenant/workspace (trusted config). Enables import_repo, push_branch, open_pull_request. */
  remote?: (ctx: ToolExecutionContext) => CodingRemote | undefined | Promise<CodingRemote | undefined>;
  /** Publish a branch diff for review UIs and approval previews (called after every commit). */
  publishDiff?: (ctx: ToolExecutionContext, diff: BranchDiff) => Promise<void>;
  /** Max characters of patch returned to the model. Default 12_000. */
  maxPatchChars?: number;
  /** Interval of run-heartbeat beats (`ctx.services.heartbeat`) during long tools (tests, commands, import, push). Default 30 s; 0 disables. */
  heartbeatIntervalMs?: number;
}

const DEFAULT_SETUP_TRIGGERS = ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "requirements.txt", "pyproject.toml", "poetry.lock", "go.mod", "go.sum", "Cargo.toml", "Cargo.lock", "Gemfile.lock"];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : `…[${text.length - max} chars omitted]…\n${text.slice(-max)}`;
}

const CONFLICT_MARKER = /^<<<<<<< .*$[\s\S]*^>>>>>>> /m;

/**
 * R3: beat the run's heartbeat (`ctx.services.heartbeat`: throttled, never throws) on an interval while a
 * long tool runs (a 5-minute test suite or a 2,000-file import must not look like a silent deadlock).
 */
async function withRunHeartbeat<T>(ctx: ToolExecutionContext, intervalMs: number, fn: () => Promise<T>): Promise<T> {
  const beat = ctx.services.heartbeat;
  if (typeof beat !== "function" || intervalMs <= 0) return fn();
  const timer = setInterval(() => {
    try {
      void Promise.resolve((beat as () => unknown)()).catch(() => undefined);
    } catch {
      // never fails the tool
    }
  }, intervalMs);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

/** What a checkout did to the workspace, for the model: preserved uncommitted edits are always reported. */
function checkoutReport(c: { deleted: string[]; kept: string[]; merged: string[]; conflicted: string[] }): Record<string, unknown> {
  return {
    deleted: c.deleted,
    keptModified: c.kept,
    ...(c.merged.length > 0 ? { mergedIntoUncommitted: c.merged } : {}),
    ...(c.conflicted.length > 0 ? { conflicted: c.conflicted } : {}),
    ...(c.kept.length + c.merged.length + c.conflicted.length > 0
      ? { note: `Your uncommitted edits were preserved${c.conflicted.length > 0 ? `; resolve the <<<<<<< markers in ${c.conflicted.join(", ")}` : ""}. Commit them with commit_changes.` }
      : {}),
  };
}

function countLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

/** Unified diff of `branch` against its merge base with `main` (what a merge or PR would apply). */
export async function computeBranchDiff(git: AgentGit, branch: string, main = "main"): Promise<BranchDiff> {
  const head = git.head(branch);
  const base = git.mergeBase(head, git.head(main));
  const baseTree: Tree = base ? (git.getCommit(base)?.tree ?? {}) : {};
  const headTree: Tree = head ? (git.getCommit(head)?.tree ?? {}) : {};
  const files: FileChange[] = [];
  const patches: string[] = [];
  for (const path of [...new Set([...Object.keys(baseTree), ...Object.keys(headTree)])].sort()) {
    const before = baseTree[path];
    const after = headTree[path];
    if (before === after) continue;
    const oldText = before ? await git.getBlob(before) : "";
    const newText = after ? await git.getBlob(after) : "";
    const patch = createTwoFilesPatch(before ? `a/${path}` : "/dev/null", after ? `b/${path}` : "/dev/null", oldText, newText, undefined, undefined, { context: 3 });
    patches.push(patch);
    files.push({ path, status: !before ? "added" : !after ? "deleted" : "modified", ...countLines(patch) });
  }
  return { branch, commitId: head, base, files, patch: patches.join("\n") };
}

interface TestRunRow {
  branch: string;
  commit_id: string;
  suite: string;
  passed: number;
  exit_code: number;
  created_at: number;
}

interface RemoteRow {
  owner: string;
  repo: string;
  base_branch: string;
  base_sha: string;
  base_commit: string;
}

/** SQLite bookkeeping for the coding tools (tables created on first use). */
export class CodingLedger {
  private static readonly ready = new WeakSet<SqlStore>();

  constructor(
    private readonly sql: SqlStore,
    private readonly workspace: string,
  ) {
    if (CodingLedger.ready.has(sql)) return;
    sql.exec(`CREATE TABLE IF NOT EXISTS as_code_test_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL, branch TEXT NOT NULL, commit_id TEXT NOT NULL, suite TEXT NOT NULL, passed INTEGER NOT NULL, exit_code INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS as_code_sync (workspace TEXT NOT NULL, sandbox_key TEXT NOT NULL, manifest_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (workspace, sandbox_key))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS as_code_remote (workspace TEXT PRIMARY KEY, owner TEXT NOT NULL, repo TEXT NOT NULL, base_branch TEXT NOT NULL, base_sha TEXT NOT NULL, base_commit TEXT NOT NULL, imported_at INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS as_code_pushes (workspace TEXT NOT NULL, branch TEXT NOT NULL, commit_id TEXT NOT NULL, remote_sha TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (workspace, branch))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS as_code_pending_merges (workspace TEXT NOT NULL, branch TEXT NOT NULL, merge_head TEXT NOT NULL, paths_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (workspace, branch))`);
    CodingLedger.ready.add(sql);
  }

  /** A conflicted sync_with_main waiting for its resolution commit (git's MERGE_HEAD). */
  pendingMerge(branch: string): { mergeHead: string; paths: string[] } | null {
    const row = this.sql.exec<{ merge_head: string; paths_json: string }>(`SELECT merge_head, paths_json FROM as_code_pending_merges WHERE workspace = ? AND branch = ?`, this.workspace, branch)[0];
    return row ? { mergeHead: row.merge_head, paths: JSON.parse(row.paths_json) as string[] } : null;
  }

  savePendingMerge(branch: string, mergeHead: string, paths: string[]): void {
    this.sql.exec(`INSERT OR REPLACE INTO as_code_pending_merges (workspace, branch, merge_head, paths_json, created_at) VALUES (?, ?, ?, ?, ?)`, this.workspace, branch, mergeHead, JSON.stringify(paths), Date.now());
  }

  clearPendingMerge(branch: string): void {
    this.sql.exec(`DELETE FROM as_code_pending_merges WHERE workspace = ? AND branch = ?`, this.workspace, branch);
  }

  recordTest(run: { branch: string; commitId: string; suite: string; passed: boolean; exitCode: number }): void {
    this.sql.exec(`INSERT INTO as_code_test_runs (workspace, branch, commit_id, suite, passed, exit_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, this.workspace, run.branch, run.commitId, run.suite, run.passed ? 1 : 0, run.exitCode, Date.now());
  }

  lastTest(branch: string): { commitId: string; suite: string; passed: boolean; exitCode: number; at: number } | null {
    const row = this.sql.exec<TestRunRow>(`SELECT * FROM as_code_test_runs WHERE workspace = ? AND branch = ? ORDER BY id DESC LIMIT 1`, this.workspace, branch)[0];
    return row ? { commitId: row.commit_id, suite: row.suite, passed: Number(row.passed) === 1, exitCode: Number(row.exit_code), at: Number(row.created_at) } : null;
  }

  manifest(sandboxKey: string): SyncManifest {
    const row = this.sql.exec<{ manifest_json: string }>(`SELECT manifest_json FROM as_code_sync WHERE workspace = ? AND sandbox_key = ?`, this.workspace, sandboxKey)[0];
    return row ? (JSON.parse(row.manifest_json) as SyncManifest) : {};
  }

  saveManifest(sandboxKey: string, manifest: SyncManifest): void {
    this.sql.exec(
      `INSERT INTO as_code_sync (workspace, sandbox_key, manifest_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace, sandbox_key) DO UPDATE SET manifest_json = excluded.manifest_json, updated_at = excluded.updated_at`,
      this.workspace,
      sandboxKey,
      JSON.stringify(manifest),
      Date.now(),
    );
  }

  remote(): RemoteRow | null {
    return this.sql.exec<RemoteRow>(`SELECT owner, repo, base_branch, base_sha, base_commit FROM as_code_remote WHERE workspace = ?`, this.workspace)[0] ?? null;
  }

  saveRemote(row: RemoteRow): void {
    this.sql.exec(`INSERT OR REPLACE INTO as_code_remote (workspace, owner, repo, base_branch, base_sha, base_commit, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, this.workspace, row.owner, row.repo, row.base_branch, row.base_sha, row.base_commit, Date.now());
  }

  push(branch: string): { commitId: string; remoteSha: string } | null {
    const row = this.sql.exec<{ commit_id: string; remote_sha: string }>(`SELECT commit_id, remote_sha FROM as_code_pushes WHERE workspace = ? AND branch = ?`, this.workspace, branch)[0];
    return row ? { commitId: row.commit_id, remoteSha: row.remote_sha } : null;
  }

  savePush(branch: string, commitId: string, remoteSha: string): void {
    this.sql.exec(`INSERT OR REPLACE INTO as_code_pushes (workspace, branch, commit_id, remote_sha, created_at) VALUES (?, ?, ?, ?, ?)`, this.workspace, branch, commitId, remoteSha, Date.now());
  }
}

const RelPath = z
  .string()
  .min(1)
  .max(512)
  .refine((p) => !p.startsWith("/") && !p.split("/").includes("..") && !p.includes("\0"), { message: "Use a workspace-relative path without '..'." });

/** Tools: create_branch, commit_changes, branch_diff, delete_file, sync_with_main, merge_to_main, and (with `sandbox`) run_tests, run_command, and (with `remote`) import_repo, push_branch, open_pull_request. */
export function createCodingTools(options: CodingToolsOptions): AnyAgentTool[] {
  const prefix = options.branchPrefix ?? "agent/";
  const main = options.mainBranch ?? "main";
  if (main.startsWith(prefix)) throw new AgentError("CONFIG_INVALID", "The protected main branch must be outside the writable branch prefix.");
  const author = options.agentId ?? "coder";
  const maxPatch = options.maxPatchChars ?? 12_000;
  const suites = options.testCommands ?? { test: "npm test" };
  const suiteNames = Object.keys(suites);
  if (suiteNames.length === 0) throw new AgentError("CONFIG_INVALID", "testCommands must name at least one suite.");
  const timeout = Math.min(600, Math.max(10, options.testTimeoutSeconds ?? 300));
  const dir = (options.sandboxDir ?? "workspace/repo").replace(/\/+$/, "");
  const triggers = new Set(options.setupTriggers ?? DEFAULT_SETUP_TRIGGERS);
  const features = options.sandboxFeatures ?? ["computerUse"];
  const beatEvery = options.heartbeatIntervalMs ?? 30_000;
  const ledger = () => new CodingLedger(options.sql(), options.git().workspace);

  const Branch = z
    .string()
    .regex(new RegExp(`^${escapeRegex(prefix)}[A-Za-z0-9._-]{1,80}$`), { message: `Branch must be "${prefix}<name>". "${main}" is protected: use merge_to_main.` })
    .describe(`Your working branch (${prefix}<name>)`);

  const ensureBranch = (git: AgentGit, branch: string) => {
    if (!git.branches().includes(branch)) git.createBranch(branch, git.head(main) ? main : undefined);
  };

  const assertFeatures = (ctx: ToolExecutionContext) => {
    for (const feature of features) {
      if (!ctx.tenantConfig.features[feature]) throw new AgentError("TOOL_NOT_ALLOWED", `Tenant feature "${feature}" is disabled for this tenant.`, { details: { feature } });
    }
  };

  /** Sync `files` into the sandbox dir (incremental per VM) and run `command` there; optional dependency setup first. */
  const inSandbox = async (ctx: ToolExecutionContext, files: Record<string, string>, command: string, opts: { timeoutSeconds: number; setup: boolean }) => {
    if (!options.sandbox) throw new AgentError("CONFIG_INVALID", "No sandbox is configured for this agent.");
    assertFeatures(ctx);
    const sandbox = options.sandbox;
    return withRunHeartbeat(ctx, beatEvery, () => sandbox(ctx, async (port, sandboxKey) => {
      const book = ledger();
      const previous = book.manifest(sandboxKey);
      const sync = await syncTreeToSandbox({ files, sandbox: port, dir, manifest: previous, signal: ctx.signal });
      book.saveManifest(sandboxKey, sync.manifest);
      const fresh = Object.keys(previous).length === 0;
      let setup: { exitCode: number; stdout: string; stderr: string; timedOut: boolean } | null = null;
      if (opts.setup && options.setupCommand && (fresh || [...sync.written, ...sync.deleted].some((p) => triggers.has(p.split("/").pop() ?? p)))) {
        setup = await port.exec(options.setupCommand, { cwd: dir, timeoutSeconds: timeout, signal: ctx.signal });
        if (setup.exitCode !== 0 || setup.timedOut) return { sync, setup, result: null };
      }
      const result = await port.exec(command, { cwd: dir, timeoutSeconds: opts.timeoutSeconds, signal: ctx.signal });
      return { sync, setup, result };
    }));
  };

  const tools: AnyAgentTool[] = [
    defineAgentTool({
      name: "create_branch",
      description: `Create your working branch from ${main}. Branch names must start with "${prefix}".`,
      input: z.object({ name: Branch }),
      risk: "LOW",
      sideEffect: "write",
      idempotent: true,
      outputTrust: "trusted",
      execute: async ({ name }) => {
        const git = options.git();
        const existed = git.branches().includes(name);
        ensureBranch(git, name);
        return { branch: name, from: main, head: git.head(name), existed };
      },
    }),
    defineAgentTool({
      name: "commit_changes",
      description: `Commit workspace changes to your branch (never ${main}). Omit \`paths\` to commit every added, modified or deleted file. Returns the commit id and the branch diff against ${main}.`,
      input: z.object({ branch: Branch, message: z.string().min(3).max(300), paths: z.array(RelPath).min(1).max(500).optional() }),
      risk: "LOW",
      sideEffect: "write",
      idempotent: true,
      outputTrust: "untrusted",
      execute: async ({ branch, message, paths }, ctx) => {
        const git = options.git();
        const fs = options.fs();
        ensureBranch(git, branch);
        const changes: Record<string, string | null> = {};
        if (paths) {
          for (const path of paths) changes[path] = (await fs.exists(path)) ? await fs.read(path) : null;
        } else {
          const tree = git.tree(branch);
          const present = new Set(await fs.list());
          for (const path of present) {
            const content = await fs.read(path);
            if (tree[path] !== (await sha256Hex(content))) changes[path] = content;
          }
          for (const path of Object.keys(tree)) if (!present.has(path)) changes[path] = null;
        }
        // Completing a conflicted sync_with_main: every path that merge touched goes into this commit, which
        // records main as a second parent so the next sync/merge does not re-conflict on the same hunks.
        const book = ledger();
        const pending = book.pendingMerge(branch);
        let extraParents: string[] = [];
        if (pending) {
          for (const path of pending.paths) changes[path] = (await fs.exists(path)) ? await fs.read(path) : null;
          const unresolved = pending.paths.filter((p) => typeof changes[p] === "string" && CONFLICT_MARKER.test(changes[p] as string));
          if (unresolved.length > 0) throw new AgentError("TOOL_EXECUTION_FAILED", `Resolve the conflict markers in ${unresolved.join(", ")} before committing: this commit completes the merge with ${main}.`, { details: { unresolved } });
          if (!git.ancestors(git.head(branch)).has(pending.mergeHead)) extraParents = [pending.mergeHead];
        }
        if (Object.keys(changes).length === 0) return { committed: false, reason: "No changes to commit.", head: git.head(branch) };
        const commitId = await git.commit(branch, changes, { author, message, ...(extraParents.length > 0 ? { extraParents } : {}) });
        if (pending) book.clearPendingMerge(branch);
        const diff = await computeBranchDiff(git, branch, main);
        await options.publishDiff?.(ctx, diff);
        return { committed: true, commitId, branch, files: diff.files, diff: tail(diff.patch, maxPatch) };
      },
    }),
    defineAgentTool({
      name: "branch_diff",
      description: `Unified diff of a branch against ${main} (what merge_to_main or a PR would apply). Give it to the reviewer subagent.`,
      input: z.object({ branch: Branch }),
      risk: "LOW",
      sideEffect: "read",
      outputTrust: "untrusted",
      maxOutputChars: 40_000,
      tags: [VERBATIM_OUTPUT_TAG],
      execute: async ({ branch }) => {
        const diff = await computeBranchDiff(options.git(), branch, main);
        const last = ledger().lastTest(branch);
        return { ...diff, patch: tail(diff.patch, 36_000), tests: last ? { commitId: last.commitId, passed: last.passed, current: last.commitId === diff.commitId } : null };
      },
    }),
    defineAgentTool({
      name: "delete_file",
      description: "Delete a file from the workspace (commit afterwards to record the deletion on your branch).",
      input: z.object({ path: RelPath }),
      risk: "MEDIUM",
      sideEffect: "write",
      idempotent: true,
      outputTrust: "trusted",
      execute: async ({ path }) => {
        const fs = options.fs();
        const existed = await fs.exists(path);
        if (existed) await fs.delete(path);
        return { path, deleted: existed };
      },
    }),
    defineAgentTool({
      name: "sync_with_main",
      description: `Merge the latest ${main} into your branch. Clean merges commit automatically; conflicts are written into the workspace with <<<<<<< markers for you to resolve and commit.`,
      input: z.object({ branch: Branch }),
      risk: "LOW",
      sideEffect: "write",
      outputTrust: "untrusted",
      execute: async ({ branch }) => {
        const git = options.git();
        const fs = options.fs();
        ensureBranch(git, branch);
        const before = git.head(branch);
        const outcome = await git.merge(main, branch, author);
        if (outcome.status === "conflict") {
          const conflicts = outcome.conflicts ?? [];
          const clean = outcome.clean ?? {};
          const touched = [...new Set([...conflicts.map((c) => c.path), ...Object.keys(clean)])].sort();
          const book = ledger();
          const pending = book.pendingMerge(branch);
          const next = `Resolve the <<<<<<< markers with patch_file, then commit_changes on ${branch}: that commit completes the merge with ${main}.`;
          if (pending && pending.mergeHead === outcome.sourceHead) return { status: "conflict", pending: true, files: pending.paths, next };
          // Nothing was committed. Never write over uncommitted edits (R8): ask for a commit first.
          const uncommitted = await git.uncommittedPaths(before, fs, touched);
          if (uncommitted.length > 0) {
            return { status: "uncommitted_changes", uncommitted, conflicting: conflicts.map((c) => c.path), next: `Merging ${main} would change files with uncommitted edits. Commit them with commit_changes (or restore them), then run sync_with_main again. Nothing was changed.` };
          }
          // Stage the merge in the workspace: clean changes from main, markers for text conflicts.
          for (const [path, content] of Object.entries(clean)) {
            if (content === null) await fs.delete(path);
            else await fs.write(path, content);
          }
          for (const conflict of conflicts) if (!conflict.rendered.startsWith("modify/delete")) await fs.write(conflict.path, conflict.rendered);
          if (outcome.sourceHead) book.savePendingMerge(branch, outcome.sourceHead, touched);
          return {
            status: "conflict",
            files: conflicts.map((c) => ({ path: c.path, conflicts: c.conflicts.length, note: c.rendered.startsWith("modify/delete") ? c.rendered : undefined })),
            appliedFromMain: Object.keys(clean).sort(),
            next,
          };
        }
        const checkout = outcome.status === "up-to-date" ? null : await git.checkout(branch, fs, before ? { from: before } : {});
        return { status: outcome.status, head: git.head(branch), ...(checkout ? checkoutReport(checkout) : {}) };
      },
    }),
    defineAgentTool({
      name: "merge_to_main",
      description: `Merge your branch into ${main}. Requires human approval AND a passing run_tests on exactly \`commitId\` (the branch head you ask to merge). If the branch moves after approval, the merge is refused.`,
      input: z.object({ branch: Branch, commitId: z.string().min(4).max(64).describe("Branch head to merge (from commit_changes)"), summary: z.string().min(5).max(1000).describe("What changes and how it was verified, for the approver") }),
      risk: "HIGH",
      sideEffect: "write",
      requiresApproval: true,
      outputTrust: "trusted",
      simulate: (args): unknown => ({ simulated: true, merge: args.branch, into: main, commitId: args.commitId }),
      execute: async ({ branch, commitId }) => {
        const git = options.git();
        const head = git.head(branch);
        if (head !== commitId) throw new AgentError("TOOL_EXECUTION_FAILED", `Branch ${branch} is at ${head ?? "nothing"}, not the approved commit ${commitId}. Run tests on the new head and request a new merge.`, { details: { head, commitId } });
        const last = ledger().lastTest(branch);
        if (!last || last.commitId !== commitId || !last.passed) {
          throw new AgentError("TOOL_NOT_ALLOWED", `merge_to_main requires a passing run_tests on ${commitId}; last run: ${last ? `${last.passed ? "passed" : "failed"} on ${last.commitId}` : "none"}.`, { details: { lastTest: last } });
        }
        const outcome = await git.merge(branch, main, author);
        if (outcome.status === "conflict") return { merged: false, status: "conflict", files: (outcome.conflicts ?? []).map((c) => c.path), next: "Run sync_with_main on your branch, resolve, commit, re-run tests, then request the merge again." };
        // The workspace was at the approved commit (plus any edits made while waiting for approval): keep those edits.
        const checkout = await git.checkout(main, options.fs(), { from: commitId });
        return { merged: outcome.status !== "up-to-date", status: outcome.status, mainHead: git.head(main), ...checkoutReport(checkout) };
      },
    }),
  ];

  if (options.sandbox) {
    tools.push(
      defineAgentTool({
        name: "run_tests",
        description: `Sync the committed head of your branch into this run's VM and run a test suite (${suiteNames.join(", ")}). Output streams live; the result gates merge_to_main. Commit before testing.`,
        input: z.object({ branch: Branch, suite: z.enum(suiteNames as [string, ...string[]]).default(suiteNames[0] as string) }),
        risk: "MEDIUM",
        sideEffect: "external",
        outputTrust: "untrusted",
        timeoutMs: (timeout * 2 + 120) * 1000,
        maxOutputChars: 16_000,
        simulate: (args): unknown => ({ simulated: true, branch: args.branch, suite: args.suite }),
        execute: async ({ branch, suite }, ctx) => {
          const git = options.git();
          const commitId = git.head(branch);
          if (!commitId) throw new AgentError("WORKSPACE_ERROR", `Branch ${branch} has no commits yet: commit_changes first.`);
          const files = await readTree(git, git.tree(branch));
          const { sync, setup, result } = await inSandbox(ctx, files, suites[suite] as string, { timeoutSeconds: timeout, setup: true });
          const failedSetup = result === null;
          const exitCode = failedSetup ? (setup?.exitCode ?? -1) : result.exitCode;
          const passed = !failedSetup && result.exitCode === 0 && !result.timedOut;
          ledger().recordTest({ branch, commitId, suite, passed, exitCode });
          const out = failedSetup ? setup : result;
          return {
            passed,
            branch,
            commitId,
            suite,
            exitCode,
            timedOut: out?.timedOut ?? false,
            ...(failedSetup ? { phase: "setup", setupCommand: options.setupCommand } : {}),
            synced: { written: sync.written.length, deleted: sync.deleted.length, unchanged: sync.unchanged },
            stdout: tail(out?.stdout ?? "", 8000),
            stderr: tail(out?.stderr ?? "", 4000),
          };
        },
      }),
      defineAgentTool({
        name: "run_command",
        description: "Sync your current workspace files into the VM and run a shell command there (lint, type-check, build, inspect). Does not count as a test run for merges.",
        input: z.object({ command: z.string().min(1).max(4000), timeoutSeconds: z.number().int().min(1).max(300).default(120) }),
        risk: "MEDIUM",
        sideEffect: "external",
        outputTrust: "untrusted",
        timeoutMs: (300 + timeout + 120) * 1000,
        maxOutputChars: 16_000,
        simulate: (args): unknown => ({ simulated: true, command: args.command }),
        execute: async ({ command, timeoutSeconds }, ctx) => {
          const files = await options.fs().snapshot();
          const { setup, result } = await inSandbox(ctx, files, command, { timeoutSeconds, setup: true });
          const out = result ?? setup;
          return { exitCode: out?.exitCode ?? -1, timedOut: out?.timedOut ?? false, ...(result === null ? { phase: "setup" } : {}), stdout: tail(out?.stdout ?? "", 8000), stderr: tail(out?.stderr ?? "", 4000) };
        },
      }),
    );
  }

  if (options.remote) {
    const remoteFor = async (ctx: ToolExecutionContext) => {
      const remote = await options.remote?.(ctx);
      if (!remote) throw new AgentError("CONFIG_INVALID", "No GitHub repository is configured for this tenant.");
      return remote;
    };
    tools.push(
      defineAgentTool({
        name: "import_repo",
        description: `Import the configured GitHub repository (default branch, or \`ref\`) into the workspace as ${main}. Only for an empty workspace.`,
        input: z.object({ ref: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/).optional().describe("Branch to import (default: the repository's default branch)") }),
        risk: "MEDIUM",
        sideEffect: "write",
        outputTrust: "trusted",
        timeoutMs: 300_000,
        execute: async ({ ref }, ctx) => withRunHeartbeat(ctx, beatEvery, async () => {
          const { client, repo } = await remoteFor(ctx);
          const git = options.git();
          if (git.head(main)) throw new AgentError("WORKSPACE_ERROR", `The workspace already has ${main}; start a new conversation to import again.`);
          const info = await client.getRepo(repo);
          const branch = ref ?? info.defaultBranch;
          const sha = await client.branchSha(repo, branch);
          if (!sha) throw new AgentError("WORKSPACE_ERROR", `Branch ${branch} not found in ${repo.owner}/${repo.repo}.`);
          const { files, skipped, truncated } = await client.downloadTree(repo, sha);
          const fs = options.fs();
          for (const [path, content] of Object.entries(files)) await fs.write(path, content);
          const commitId = await git.commit(main, files, { author, message: `Import ${repo.owner}/${repo.repo}@${sha.slice(0, 12)} (${branch})` });
          ledger().saveRemote({ owner: repo.owner, repo: repo.repo, base_branch: branch, base_sha: sha, base_commit: commitId });
          return { imported: Object.keys(files).length, skipped: skipped.slice(0, 50), skippedCount: skipped.length, truncated, baseBranch: branch, baseSha: sha, mainHead: commitId };
        }),
      }),
      defineAgentTool({
        name: "push_branch",
        description: "Push your branch to the configured GitHub repository as one commit on top of the imported base. Requires human approval; never pushes main.",
        input: z.object({ branch: Branch, commitId: z.string().min(4).max(64), message: z.string().min(3).max(300) }),
        risk: "HIGH",
        sideEffect: "external",
        requiresApproval: true,
        outputTrust: "trusted",
        timeoutMs: 300_000,
        simulate: (args): unknown => ({ simulated: true, push: args.branch, commitId: args.commitId }),
        execute: async ({ branch, commitId, message }, ctx) => withRunHeartbeat(ctx, beatEvery, async () => {
          const { client, repo } = await remoteFor(ctx);
          const git = options.git();
          const book = ledger();
          const imported = book.remote();
          if (!imported) throw new AgentError("WORKSPACE_ERROR", "Import the repository with import_repo before pushing.");
          if (imported.owner !== repo.owner || imported.repo !== repo.repo) throw new AgentError("TOOL_NOT_ALLOWED", "The configured repository changed since import.");
          const head = git.head(branch);
          if (head !== commitId) throw new AgentError("TOOL_EXECUTION_FAILED", `Branch ${branch} is at ${head ?? "nothing"}, not the approved commit ${commitId}.`);
          const baseTree = git.getCommit(imported.base_commit)?.tree ?? {};
          const headTree = git.tree(branch);
          const changes: Record<string, string | null> = {};
          for (const path of new Set([...Object.keys(baseTree), ...Object.keys(headTree)])) {
            if (baseTree[path] === headTree[path]) continue;
            changes[path] = headTree[path] ? await git.getBlob(headTree[path] as string) : null;
          }
          if (Object.keys(changes).length === 0) return { pushed: false, reason: "No changes relative to the imported base." };
          const pushed = await client.pushCommit(repo, { branch, baseSha: imported.base_sha, changes, message });
          book.savePush(branch, commitId, pushed.sha);
          const last = book.lastTest(branch);
          return { pushed: true, branch, remoteSha: pushed.sha, created: pushed.created, files: Object.keys(changes).length, tests: last && last.commitId === commitId ? (last.passed ? "passed" : "failed") : "not run on this commit" };
        }),
      }),
      defineAgentTool({
        name: "open_pull_request",
        description: "Open a (draft by default) pull request from your pushed branch into the repository's base branch. Requires human approval.",
        input: z.object({ branch: Branch, title: z.string().min(5).max(200), body: z.string().max(10_000).default(""), draft: z.boolean().default(true) }),
        risk: "HIGH",
        sideEffect: "external",
        requiresApproval: true,
        outputTrust: "trusted",
        simulate: (args): unknown => ({ simulated: true, pullRequest: args.title, head: args.branch }),
        execute: async ({ branch, title, body, draft }, ctx) => {
          const { client, repo } = await remoteFor(ctx);
          const book = ledger();
          const imported = book.remote();
          const pushed = book.push(branch);
          if (!imported || !pushed) throw new AgentError("WORKSPACE_ERROR", `Push ${branch} with push_branch before opening a pull request.`);
          const last = book.lastTest(branch);
          const testLine = last && last.commitId === pushed.commitId ? `Tests (${last.suite}): ${last.passed ? "passed" : `FAILED (exit ${last.exitCode})`} on ${pushed.commitId}` : "Tests: not run on the pushed commit";
          const pr = await client.openPullRequest(repo, { head: branch, base: imported.base_branch, title, body: `${body}\n\n---\n${testLine}\n_Opened by an Agent Starter coding agent; a human approved this pull request._`, draft });
          return { ...pr, tests: testLine };
        },
      }),
    );
  }
  return tools;
}
