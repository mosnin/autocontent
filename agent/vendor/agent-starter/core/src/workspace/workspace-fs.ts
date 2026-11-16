import { applyPatch, createTwoFilesPatch } from "diff";
import { AgentError } from "../errors.ts";
import { sha256HexSync } from "../ingestion/events.ts";
import type { BlobStore } from "../storage/ports.ts";
import { safeRelativeKey } from "../tenancy/tenancy.ts";
import { globToRegExp } from "../tools/firewall.ts";

/**
 * An injective, path-safe storage segment for an id (conversation and run ids carry `:XX` escapes and
 * dots): a readable prefix plus a SHA-256 suffix of the exact id. Lossy sanitising alone (`:` → `_`)
 * lets `alice:2Esmith` and `alice_2Esmith` share one workspace (SEC-08); the digest never does.
 */
export function storageSegment(id: string): string {
  return `${id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 48)}~${sha256HexSync(id).slice(0, 32)}`;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
  context?: string[];
}

/**
 * Workspace file-system abstraction over R2 (any BlobStore). Agents edit with
 * precise primitives — view_lines, grep, patch (search/replace with uniqueness
 * check) and unified diffs — instead of rewriting whole files, which keeps
 * token usage flat and makes every change reviewable.
 */
export class WorkspaceFS {
  constructor(
    private readonly blobs: BlobStore,
    readonly root: string,
    private readonly limits: { maxFileBytes?: number; maxGrepFiles?: number } = {},
  ) {
    safeRelativeKey(root);
  }

  private key(path: string): string {
    return `${this.root}/${safeRelativeKey(path.replace(/^\/+/, ""))}`;
  }

  async exists(path: string): Promise<boolean> {
    return (await this.blobs.get(this.key(path))) !== null;
  }

  async read(path: string): Promise<string> {
    const object = await this.blobs.get(this.key(path));
    if (!object) throw new AgentError("WORKSPACE_ERROR", `File not found: ${path}`);
    if (object.size > (this.limits.maxFileBytes ?? 2_000_000)) throw new AgentError("WORKSPACE_ERROR", `File too large to read whole (${object.size} bytes); use view_lines or grep.`);
    return object.text();
  }

  async list(dir = "", options: { glob?: string; limit?: number } = {}): Promise<string[]> {
    const prefix = dir ? `${this.key(dir)}/` : `${this.root}/`;
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.blobs.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      keys.push(...page.keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && keys.length < (options.limit ?? 5000));
    const glob = options.glob ? globToRegExp(options.glob) : null;
    return keys
      .map((k) => k.slice(this.root.length + 1))
      .filter((p) => !glob || glob.test(p))
      .sort()
      .slice(0, options.limit ?? 5000);
  }

  async viewLines(path: string, startLine: number, endLine: number): Promise<string> {
    const lines = (await this.read(path)).split("\n");
    const start = Math.max(1, Math.floor(startLine));
    const end = Math.min(lines.length, Math.max(start, Math.floor(endLine)));
    const width = String(end).length;
    const body = lines
      .slice(start - 1, end)
      .map((text, i) => `${String(start + i).padStart(width, " ")}| ${text}`)
      .join("\n");
    return `${path} (lines ${start}-${end} of ${lines.length})\n${body}`;
  }

  async grep(pattern: string, options: { path?: string; glob?: string; ignoreCase?: boolean; maxResults?: number; contextLines?: number } = {}): Promise<GrepMatch[]> {
    if (pattern.length > 300) throw new AgentError("WORKSPACE_ERROR", "grep pattern too long");
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, options.ignoreCase === false ? "" : "i");
    } catch (error) {
      throw new AgentError("WORKSPACE_ERROR", `Invalid regex: ${String(error)}`);
    }
    const files = options.path ? [options.path] : await this.list("", { ...(options.glob ? { glob: options.glob } : {}), limit: this.limits.maxGrepFiles ?? 500 });
    const max = options.maxResults ?? 50;
    const ctx = options.contextLines ?? 0;
    const results: GrepMatch[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = await this.read(file);
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && results.length < max; i++) {
        const text = lines[i] as string;
        if (text.length > 5000) continue;
        if (regex.test(text)) {
          results.push({ path: file, line: i + 1, text, ...(ctx > 0 ? { context: lines.slice(Math.max(0, i - ctx), i + ctx + 1) } : {}) });
        }
      }
      if (results.length >= max) break;
    }
    return results;
  }

  async write(path: string, content: string): Promise<{ path: string; diff: string; created: boolean }> {
    const existing = (await this.exists(path)) ? await this.read(path) : null;
    await this.blobs.put(this.key(path), content, { contentType: guessContentType(path) });
    return { path, created: existing === null, diff: createTwoFilesPatch(`a/${path}`, `b/${path}`, existing ?? "", content, undefined, undefined, { context: 3 }) ?? "" };
  }

  /**
   * Replace an exact block. Fails loudly (with a nearby-lines hint) if the block
   * is absent, and refuses ambiguous edits unless `replaceAll` is set.
   */
  async patch(path: string, search: string, replace: string, options: { replaceAll?: boolean } = {}): Promise<{ path: string; diff: string; replacements: number }> {
    if (!search) throw new AgentError("WORKSPACE_ERROR", "search block must not be empty");
    const original = await this.read(path);
    const occurrences = original.split(search).length - 1;
    if (occurrences === 0) {
      throw new AgentError("WORKSPACE_ERROR", `Search block not found verbatim in ${path}. Closest lines:\n${closestLines(original, search)}`);
    }
    if (occurrences > 1 && !options.replaceAll) {
      throw new AgentError("WORKSPACE_ERROR", `Search block matches ${occurrences} locations in ${path}; include more surrounding context or set replaceAll.`);
    }
    const updated = options.replaceAll ? original.split(search).join(replace) : original.replace(search, () => replace);
    await this.blobs.put(this.key(path), updated, { contentType: guessContentType(path) });
    return { path, replacements: options.replaceAll ? occurrences : 1, diff: createTwoFilesPatch(`a/${path}`, `b/${path}`, original, updated, undefined, undefined, { context: 3 }) ?? "" };
  }

  async applyUnifiedDiff(path: string, unifiedDiff: string): Promise<{ path: string }> {
    const original = (await this.exists(path)) ? await this.read(path) : "";
    const result = applyPatch(original, unifiedDiff, { fuzzFactor: 1 });
    if (result === false) throw new AgentError("WORKSPACE_ERROR", `Unified diff did not apply cleanly to ${path}; re-read the file and regenerate the patch.`);
    await this.blobs.put(this.key(path), result, { contentType: guessContentType(path) });
    return { path };
  }

  async delete(path: string): Promise<void> {
    await this.blobs.delete(this.key(path));
  }

  async move(from: string, to: string): Promise<void> {
    const content = await this.read(from);
    await this.blobs.put(this.key(to), content, { contentType: guessContentType(to) });
    await this.blobs.delete(this.key(from));
  }

  async snapshot(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const path of await this.list()) out[path] = await this.read(path);
    return out;
  }
}

function closestLines(content: string, search: string): string {
  const firstLine = search.split("\n").find((l) => l.trim().length > 0)?.trim() ?? search.trim();
  const words = new Set(firstLine.toLowerCase().match(/\w{3,}/g) ?? []);
  const lines = content.split("\n");
  const scored = lines
    .map((text, i) => ({ i, text, score: [...words].filter((w) => text.toLowerCase().includes(w)).length }))
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored.length ? scored.map((l) => `${l.i + 1}| ${l.text}`).join("\n") : "(no similar lines)";
}

function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = { json: "application/json", md: "text/markdown", html: "text/html", css: "text/css", js: "text/javascript", ts: "text/typescript", csv: "text/csv", txt: "text/plain", py: "text/x-python" };
  return map[ext] ?? "text/plain";
}
