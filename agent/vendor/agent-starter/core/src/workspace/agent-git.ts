import { AgentError } from "../errors.ts";
import type { BlobStore, SqlStore } from "../storage/ports.ts";
import { randomId, sha256Hex } from "../util/crypto.ts";
import { type MergeConflict, threeWayMerge } from "./merge.ts";
import type { WorkspaceFS } from "./workspace-fs.ts";

export type Tree = Record<string, string>;

export interface CommitInfo {
  id: string;
  branch: string;
  parentIds: string[];
  author: string;
  message: string;
  tree: Tree;
  createdAt: number;
}

export interface MergeOutcome {
  status: "up-to-date" | "fast-forward" | "merged" | "conflict";
  commitId?: string;
  conflicts?: Array<{ path: string; conflicts: MergeConflict[]; rendered: string }>;
  /** On conflict: the paths that merged cleanly (content, or null = delete), so a caller can stage a resolution. */
  clean?: Record<string, string | null>;
  /** On conflict: the source head being merged (record it as a parent of the resolution commit). */
  sourceHead?: string;
}

/**
 * Machine-first version control for multi-agent workspaces. Each agent commits
 * to its own branch; the coordinator merges with a real three-way merge so two
 * agents editing the same file never silently overwrite each other — conflicts
 * are surfaced explicitly. Metadata lives in SQLite, content in R2 (content-
 * addressed by sha256).
 */
export class AgentGit {
  constructor(
    private readonly sql: SqlStore,
    private readonly blobs: BlobStore,
    readonly workspace: string,
    private readonly clock: () => number = Date.now,
  ) {}

  private blobKey(hash: string): string {
    return `git/${this.workspace}/blobs/${hash}`;
  }

  async putBlob(content: string): Promise<string> {
    const hash = await sha256Hex(content);
    if (!(await this.blobs.get(this.blobKey(hash)))) await this.blobs.put(this.blobKey(hash), content);
    return hash;
  }

  async getBlob(hash: string): Promise<string> {
    const object = await this.blobs.get(this.blobKey(hash));
    if (!object) throw new AgentError("WORKSPACE_ERROR", `Missing blob ${hash}`);
    return object.text();
  }

  head(branch: string): string | null {
    return this.sql.exec<{ head: string | null }>(`SELECT head FROM as_git_refs WHERE workspace = ? AND branch = ?`, this.workspace, branch)[0]?.head ?? null;
  }

  branches(): string[] {
    return this.sql.exec<{ branch: string }>(`SELECT branch FROM as_git_refs WHERE workspace = ? ORDER BY branch`, this.workspace).map((r) => r.branch);
  }

  getCommit(id: string): CommitInfo | null {
    const row = this.sql.exec<{ id: string; branch: string; parent_ids: string; author: string; message: string; tree_json: string; created_at: number }>(
      `SELECT * FROM as_git_commits WHERE id = ? AND workspace = ?`,
      id,
      this.workspace,
    )[0];
    return row
      ? { id: row.id, branch: row.branch, parentIds: JSON.parse(row.parent_ids) as string[], author: row.author, message: row.message, tree: JSON.parse(row.tree_json) as Tree, createdAt: Number(row.created_at) }
      : null;
  }

  tree(branch: string): Tree {
    const head = this.head(branch);
    return head ? (this.getCommit(head)?.tree ?? {}) : {};
  }

  createBranch(name: string, from?: string): void {
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(name)) throw new AgentError("WORKSPACE_ERROR", `Invalid branch name ${name}`);
    if (this.head(name) !== null || this.branches().includes(name)) throw new AgentError("WORKSPACE_ERROR", `Branch ${name} already exists`);
    const head = from ? this.head(from) : null;
    this.sql.exec(`INSERT INTO as_git_refs (workspace, branch, head, updated_at) VALUES (?, ?, ?, ?)`, this.workspace, name, head, this.clock());
  }

  /** Commit file changes (string = write, null = delete) on top of the branch head. */
  async commit(branch: string, changes: Record<string, string | null>, meta: { author: string; message: string; extraParents?: string[] }): Promise<string> {
    if (!this.branches().includes(branch)) this.createBranch(branch);
    const parent = this.head(branch);
    const tree: Tree = { ...(parent ? this.getCommit(parent)?.tree : {}) };
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) delete tree[path];
      else tree[path] = await this.putBlob(content);
    }
    const id = randomId("c").slice(0, 26);
    const parents = [...(parent ? [parent] : []), ...(meta.extraParents ?? [])];
    const now = this.clock();
    this.sql.transaction(() => {
      this.sql.exec(
        `INSERT INTO as_git_commits (id, workspace, branch, parent_ids, author, message, tree_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        this.workspace,
        branch,
        JSON.stringify(parents),
        meta.author,
        meta.message,
        JSON.stringify(tree),
        now,
      );
      this.sql.exec(`UPDATE as_git_refs SET head = ?, updated_at = ? WHERE workspace = ? AND branch = ?`, id, now, this.workspace, branch);
    });
    return id;
  }

  async readFile(branch: string, path: string): Promise<string | null> {
    const hash = this.tree(branch)[path];
    return hash ? this.getBlob(hash) : null;
  }

  ancestors(commitId: string | null): Map<string, number> {
    const depth = new Map<string, number>();
    const queue: Array<[string, number]> = commitId ? [[commitId, 0]] : [];
    while (queue.length) {
      const [id, d] = queue.shift() as [string, number];
      if (depth.has(id)) continue;
      depth.set(id, d);
      for (const p of this.getCommit(id)?.parentIds ?? []) queue.push([p, d + 1]);
    }
    return depth;
  }

  mergeBase(a: string | null, b: string | null): string | null {
    if (!a || !b) return null;
    const ancestorsA = this.ancestors(a);
    let best: { id: string; depth: number } | null = null;
    for (const [id, depth] of this.ancestors(b)) {
      if (ancestorsA.has(id) && (!best || depth + (ancestorsA.get(id) ?? 0) < best.depth)) best = { id, depth: depth + (ancestorsA.get(id) ?? 0) };
    }
    return best?.id ?? null;
  }

  /** Merge `source` into `target`. Clean merges commit automatically; conflicts are returned, never committed. */
  async merge(source: string, target: string, author: string): Promise<MergeOutcome> {
    const sourceHead = this.head(source);
    const targetHead = this.head(target);
    if (!sourceHead) return { status: "up-to-date" };
    if (!targetHead) {
      if (!this.branches().includes(target)) this.createBranch(target);
      this.sql.exec(`UPDATE as_git_refs SET head = ?, updated_at = ? WHERE workspace = ? AND branch = ?`, sourceHead, this.clock(), this.workspace, target);
      return { status: "fast-forward", commitId: sourceHead };
    }
    if (this.ancestors(targetHead).has(sourceHead)) return { status: "up-to-date" };
    if (this.ancestors(sourceHead).has(targetHead)) {
      this.sql.exec(`UPDATE as_git_refs SET head = ?, updated_at = ? WHERE workspace = ? AND branch = ?`, sourceHead, this.clock(), this.workspace, target);
      return { status: "fast-forward", commitId: sourceHead };
    }
    const baseId = this.mergeBase(sourceHead, targetHead);
    const baseTree = baseId ? (this.getCommit(baseId)?.tree ?? {}) : {};
    const ours = this.getCommit(targetHead)?.tree ?? {};
    const theirs = this.getCommit(sourceHead)?.tree ?? {};
    const changes: Record<string, string | null> = {};
    const conflicts: NonNullable<MergeOutcome["conflicts"]> = [];
    for (const path of new Set([...Object.keys(baseTree), ...Object.keys(ours), ...Object.keys(theirs)])) {
      const b = baseTree[path];
      const o = ours[path];
      const t = theirs[path];
      if (o === t) continue;
      if (o === b) {
        changes[path] = t === undefined ? null : await this.getBlob(t);
        continue;
      }
      if (t === b) continue;
      if (o === undefined || t === undefined) {
        conflicts.push({ path, conflicts: [{ baseStart: 1, ours: o ? ["(modified)"] : ["(deleted)"], base: [], theirs: t ? ["(modified)"] : ["(deleted)"] }], rendered: `modify/delete conflict on ${path}` });
        continue;
      }
      const result = threeWayMerge(b ? await this.getBlob(b) : "", await this.getBlob(o), await this.getBlob(t), { ours: target, theirs: source });
      if (result.clean) changes[path] = result.merged;
      else conflicts.push({ path, conflicts: result.conflicts, rendered: result.merged });
    }
    if (conflicts.length > 0) return { status: "conflict", conflicts, clean: changes, sourceHead };
    const commitId = await this.commit(target, changes, { author, message: `Merge ${source} into ${target}`, extraParents: [sourceHead] });
    return { status: "merged", commitId };
  }

  /** Every path → content hashes it ever had in the history of `commitId` (inclusive). */
  trackedHistory(commitId: string | null): Map<string, Set<string>> {
    const tracked = new Map<string, Set<string>>();
    for (const id of this.ancestors(commitId).keys()) {
      for (const [path, hash] of Object.entries(this.getCommit(id)?.tree ?? {})) {
        if (!tracked.has(path)) tracked.set(path, new Set());
        tracked.get(path)?.add(hash);
      }
    }
    return tracked;
  }

  /**
   * Materialize a branch into a WorkspaceFS (e.g. after a merge, or before
   * syncing into a sandbox) WITHOUT losing uncommitted work.
   *
   * `from` is the ref or commit id the workspace was checked out at before (for
   * a merge: the target's head before the merge). A workspace file is "clean"
   * when it equals `from`'s version (without `from`: any version in the
   * branch's history); clean files are updated, removed files are deleted.
   * A locally modified ("dirty") file is never silently overwritten:
   * - unchanged by the checkout, or no `from` to merge against → left as is, in `kept`;
   * - changed by the checkout → three-way merged (base = `from`'s version,
   *   ours = the workspace, theirs = the branch): clean → written, in `merged`;
   *   overlapping → written with `<<<<<<<` markers that contain both sides, in `conflicted`;
   * - removed by the branch, or deleted locally → left as is, in `kept`.
   * Untracked files are left alone. `prune: true` forces an exact mirror of the
   * branch (overwrites local edits and deletes untracked files).
   */
  async checkout(
    branch: string,
    fs: WorkspaceFS,
    options: { from?: string; prune?: boolean } = {},
  ): Promise<{ written: number; deleted: string[]; kept: string[]; merged: string[]; conflicted: string[] }> {
    const tree = this.tree(branch);
    const tracked = this.trackedHistory(this.head(branch));
    const fromHead = options.from ? (this.head(options.from) ?? (this.getCommit(options.from) ? options.from : null)) : null;
    const fromTree: Tree | null = fromHead ? (this.getCommit(fromHead)?.tree ?? {}) : null;
    for (const [path, hashes] of this.trackedHistory(fromHead)) {
      if (!tracked.has(path)) tracked.set(path, new Set());
      for (const hash of hashes) tracked.get(path)?.add(hash);
    }
    const local = new Map<string, { content: string; hash: string }>();
    for (const path of await fs.list()) {
      try {
        const content = await fs.read(path);
        local.set(path, { content, hash: await sha256Hex(content) });
      } catch {
        // Unreadable (e.g. too large to read whole): treat as locally modified, never overwrite it.
        local.set(path, { content: "", hash: "" });
      }
    }
    const isClean = (path: string, hash: string): boolean => {
      if (options.prune) return true;
      const base = fromTree?.[path];
      if (base !== undefined) return base === hash;
      return tracked.get(path)?.has(hash) ?? false;
    };

    let written = 0;
    const deleted: string[] = [];
    const kept: string[] = [];
    const merged: string[] = [];
    const conflicted: string[] = [];
    for (const [path, hash] of Object.entries(tree)) {
      const mine = local.get(path);
      if (mine?.hash === hash) continue;
      if (!mine) {
        const base = fromTree?.[path];
        // Present at `from` but missing locally: an uncommitted deletion. Keep it deleted.
        if (!options.prune && base !== undefined) kept.push(path);
        else {
          await fs.write(path, await this.getBlob(hash));
          written++;
        }
        continue;
      }
      if (isClean(path, mine.hash)) {
        await fs.write(path, await this.getBlob(hash));
        written++;
        continue;
      }
      const base = fromTree?.[path];
      if (!fromTree || base === hash || mine.hash === "") {
        kept.push(path);
        continue;
      }
      const result = threeWayMerge(base ? await this.getBlob(base) : "", mine.content, await this.getBlob(hash), { ours: "workspace (uncommitted)", theirs: branch });
      await fs.write(path, result.merged);
      written++;
      (result.clean ? merged : conflicted).push(path);
    }
    for (const [path, mine] of local) {
      if (tree[path] !== undefined) continue;
      if (!options.prune && !tracked.has(path)) continue;
      if (isClean(path, mine.hash)) {
        await fs.delete(path);
        deleted.push(path);
      } else {
        kept.push(path);
      }
    }
    return { written, deleted, kept: kept.sort(), merged, conflicted };
  }

  /**
   * Workspace paths whose content differs from `ref`'s tree (a branch or
   * commit id): modified, deleted, or untracked files that `ref` does not have.
   */
  async uncommittedPaths(ref: string | null, fs: WorkspaceFS, paths?: Iterable<string>): Promise<string[]> {
    const head = ref ? (this.head(ref) ?? (this.getCommit(ref) ? ref : null)) : null;
    const tree: Tree = head ? (this.getCommit(head)?.tree ?? {}) : {};
    const present = new Set(await fs.list());
    const dirty: string[] = [];
    for (const path of paths ?? new Set([...present, ...Object.keys(tree)])) {
      if (!present.has(path)) {
        if (tree[path] !== undefined) dirty.push(path);
        continue;
      }
      let hash: string;
      try {
        hash = await sha256Hex(await fs.read(path));
      } catch {
        hash = ""; // unreadable: treat as modified
      }
      if (hash !== tree[path]) dirty.push(path);
    }
    return dirty.sort();
  }
}
