import { AgentError } from "../errors.ts";
import { sha256Hex } from "../util/crypto.ts";
import type { AgentGit, Tree } from "./agent-git.ts";
import type { WorkspaceFS } from "./workspace-fs.ts";

/**
 * Provider-agnostic view of a sandbox VM (boat.dev via `boatSandboxPort` in
 * @agent-starter/integrations, or anything with exec + file I/O). Paths are
 * relative to the sandbox user's home unless absolute.
 */
export interface SandboxPort {
  exec(
    command: string,
    options?: { cwd?: string; timeoutSeconds?: number; signal?: AbortSignal; onOutput?: (chunk: { stream: "stdout" | "stderr"; data: string }) => void | Promise<void> },
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean; durationMs?: number }>;
  writeFile(path: string, content: string, options?: { encoding?: "utf8" | "base64" }): Promise<unknown>;
  readFile(path: string, options?: { encoding?: "utf8" | "base64" }): Promise<{ content: string }>;
}

/** path → sha256 of the content last written into the sandbox. */
export type SyncManifest = Record<string, string>;

export interface SyncResult {
  written: string[];
  deleted: string[];
  unchanged: number;
  manifest: SyncManifest;
}

// Relative, no '..' segments, no control characters or backslashes. Everything else (spaces, quotes,
// [id].tsx, (group)/) is fine: paths only reach the shell through shellQuote and the file API.
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000-\u001f\u007f\\]{1,512}$/;

/** POSIX single-quote a value for a shell command line. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertSafe(path: string): void {
  if (!SAFE_PATH.test(path) || path.includes("\0")) throw new AgentError("WORKSPACE_ERROR", `Refusing to sync unsafe path ${JSON.stringify(path)}`);
}

/**
 * Incrementally mirror a file tree (path → content) into a sandbox directory:
 * only files whose hash differs from `manifest` are written, files that left the
 * tree are deleted, untracked sandbox files (node_modules, build output) are
 * never touched. Persist the returned manifest per sandbox and pass it back next
 * time; a fresh sandbox (empty manifest) gets a full sync.
 */
export async function syncTreeToSandbox(options: {
  files: Record<string, string>;
  sandbox: SandboxPort;
  /** Target directory, relative to the sandbox home (e.g. "workspace/repo"). */
  dir: string;
  manifest?: SyncManifest;
  /** Parallel writes. Default 8. */
  concurrency?: number;
  signal?: AbortSignal;
}): Promise<SyncResult> {
  const dir = options.dir.replace(/\/+$/, "");
  assertSafe(dir);
  const previous = options.manifest ?? {};
  const manifest: SyncManifest = {};
  const pending: Array<[string, string]> = [];
  let unchanged = 0;
  for (const [path, content] of Object.entries(options.files)) {
    assertSafe(path);
    const hash = await sha256Hex(content);
    manifest[path] = hash;
    if (previous[path] === hash) unchanged++;
    else pending.push([path, content]);
  }
  const deleted = Object.keys(previous).filter((path) => manifest[path] === undefined);
  if (Object.keys(previous).length === 0) await options.sandbox.exec(`mkdir -p ${shellQuote(dir)}`, { timeoutSeconds: 30, ...(options.signal ? { signal: options.signal } : {}) });
  const written: string[] = [];
  const queue = [...pending];
  const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 8, queue.length)) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (options.signal?.aborted) throw new AgentError("TIMEOUT", "sync aborted");
      await options.sandbox.writeFile(`${dir}/${next[0]}`, next[1]);
      written.push(next[0]);
    }
  });
  await Promise.all(workers);
  for (let i = 0; i < deleted.length; i += 200) {
    const batch = deleted.slice(i, i + 200);
    for (const path of batch) assertSafe(path);
    await options.sandbox.exec(`rm -f -- ${batch.map((p) => shellQuote(p)).join(" ")}`, { cwd: dir, timeoutSeconds: 60, ...(options.signal ? { signal: options.signal } : {}) });
  }
  return { written: written.sort(), deleted, unchanged, manifest };
}

/** Read a committed branch (or any tree) as path → content, e.g. to sync exactly the commit under test. */
export async function readTree(git: AgentGit, tree: Tree): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const [path, hash] of Object.entries(tree)) files[path] = await git.getBlob(hash);
  return files;
}

/**
 * Import files from a sandbox directory into a WorkspaceFS (e.g. a repository
 * cloned or generated inside the VM). Lists tracked + untracked-but-not-ignored
 * files with git when available (else `find`, skipping .git and node_modules),
 * skips binaries and oversized files, and returns what was imported.
 */
export async function importFromSandbox(options: { sandbox: SandboxPort; dir: string; fs: WorkspaceFS; maxFiles?: number; maxFileBytes?: number; signal?: AbortSignal }): Promise<{ imported: string[]; skipped: Array<{ path: string; reason: string }> }> {
  const dir = options.dir.replace(/\/+$/, "");
  assertSafe(dir);
  const listing = await options.sandbox.exec(
    `if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files -co --exclude-standard; else find . -type f -not -path './.git/*' -not -path '*/node_modules/*' | sed 's#^\\./##'; fi`,
    { cwd: dir, timeoutSeconds: 60, ...(options.signal ? { signal: options.signal } : {}) },
  );
  if (listing.exitCode !== 0) throw new AgentError("WORKSPACE_ERROR", `Could not list sandbox files: ${listing.stderr.slice(0, 500)}`);
  const maxFiles = options.maxFiles ?? 2000;
  const maxBytes = options.maxFileBytes ?? 1_000_000;
  const imported: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const path of listing.stdout.split("\n").map((p) => p.trim()).filter(Boolean)) {
    if (imported.length >= maxFiles) {
      skipped.push({ path, reason: "file limit" });
      continue;
    }
    if (!SAFE_PATH.test(path)) {
      skipped.push({ path, reason: "unsafe path" });
      continue;
    }
    const file = await options.sandbox.readFile(`${dir}/${path}`);
    if (file.content.length > maxBytes) skipped.push({ path, reason: "too large" });
    else if (file.content.includes("\0")) skipped.push({ path, reason: "binary" });
    else {
      await options.fs.write(path, file.content);
      imported.push(path);
    }
  }
  return { imported, skipped };
}
