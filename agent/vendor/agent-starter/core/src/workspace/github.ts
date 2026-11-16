import { AgentError, HttpError } from "../errors.ts";

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubClientOptions {
  /** Token read from a binding at call time (e.g. `env.GITHUB_TOKEN`). Never from model input, never into a VM. */
  token: () => string | undefined;
  fetch?: typeof fetch;
  baseUrl?: string;
  userAgent?: string;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** Validate `owner/repo` (from trusted configuration, never from a tool argument). */
export function parseRepoRef(value: string): GitHubRepoRef {
  const [owner, repo, extra] = value.trim().split("/");
  if (!owner || !repo || extra !== undefined || !NAME.test(owner) || !NAME.test(repo)) throw new AgentError("CONFIG_INVALID", `Invalid GitHub repository "${value}" (expected owner/repo).`);
  return { owner, repo };
}

function decodeBase64Utf8(b64: string): { text: string; binary: boolean } {
  const binary = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.includes(0)) return { text: "", binary: true };
  return { text: new TextDecoder().decode(bytes), binary: false };
}

/**
 * Minimal GitHub REST client for the coding agent's remote: import a branch
 * into the workspace, push an agent branch (git data API: blobs → tree →
 * commit → ref) and open pull requests. The token stays in the Worker.
 */
export class GitHubClient {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: GitHubClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
    this.doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  }

  private async request<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | null> {
    const token = this.options.token();
    if (!token) throw new AgentError("CONFIG_INVALID", "GITHUB_TOKEN is not configured.");
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": this.options.userAgent ?? "agent-starter-coder",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw await HttpError.fromResponse(response, `GitHub ${method} ${path.split("?")[0]}`);
    if (response.status === 204) return null;
    return (await response.json()) as T;
  }

  private repoPath(ref: GitHubRepoRef): string {
    return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  }

  async getRepo(ref: GitHubRepoRef): Promise<{ defaultBranch: string; private: boolean; htmlUrl: string }> {
    const repo = (await this.request<{ default_branch: string; private: boolean; html_url: string }>("GET", this.repoPath(ref))) as { default_branch: string; private: boolean; html_url: string };
    return { defaultBranch: repo.default_branch, private: repo.private, htmlUrl: repo.html_url };
  }

  /** Head commit sha of a branch, or null when it does not exist. */
  async branchSha(ref: GitHubRepoRef, branch: string): Promise<string | null> {
    const found = await this.request<{ object: { sha: string } }>("GET", `${this.repoPath(ref)}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, undefined, true);
    return found?.object.sha ?? null;
  }

  /**
   * Download a branch's text files (recursive tree + blobs). Binary, oversized
   * and over-limit files are skipped and reported.
   */
  async downloadTree(ref: GitHubRepoRef, commitSha: string, options: { maxFiles?: number; maxFileBytes?: number } = {}): Promise<{ files: Record<string, string>; skipped: Array<{ path: string; reason: string }>; truncated: boolean }> {
    const commit = (await this.request<{ tree: { sha: string } }>("GET", `${this.repoPath(ref)}/git/commits/${commitSha}`)) as { tree: { sha: string } };
    const tree = (await this.request<{ tree: Array<{ path: string; type: string; sha: string; size?: number }>; truncated: boolean }>("GET", `${this.repoPath(ref)}/git/trees/${commit.tree.sha}?recursive=1`)) as {
      tree: Array<{ path: string; type: string; sha: string; size?: number }>;
      truncated: boolean;
    };
    const maxFiles = options.maxFiles ?? 2000;
    const maxBytes = options.maxFileBytes ?? 1_000_000;
    const files: Record<string, string> = {};
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const entry of tree.tree) {
      if (entry.type !== "blob") continue;
      if (Object.keys(files).length >= maxFiles) {
        skipped.push({ path: entry.path, reason: "file limit" });
        continue;
      }
      if ((entry.size ?? 0) > maxBytes) {
        skipped.push({ path: entry.path, reason: "too large" });
        continue;
      }
      const blob = (await this.request<{ content: string; encoding: string }>("GET", `${this.repoPath(ref)}/git/blobs/${entry.sha}`)) as { content: string; encoding: string };
      const decoded = blob.encoding === "base64" ? decodeBase64Utf8(blob.content) : { text: blob.content, binary: false };
      if (decoded.binary) skipped.push({ path: entry.path, reason: "binary" });
      else files[entry.path] = decoded.text;
    }
    return { files, skipped, truncated: tree.truncated };
  }

  /**
   * Create a commit on top of `baseSha` with the given changes (content = write,
   * null = delete) and point `refs/heads/<branch>` at it (created or force-moved:
   * the branch is the agent's own). Returns the new commit sha.
   */
  async pushCommit(ref: GitHubRepoRef, options: { branch: string; baseSha: string; changes: Record<string, string | null>; message: string; author?: { name: string; email: string } }): Promise<{ sha: string; branch: string; created: boolean }> {
    const base = (await this.request<{ tree: { sha: string } }>("GET", `${this.repoPath(ref)}/git/commits/${options.baseSha}`)) as { tree: { sha: string } };
    const entries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string | null }> = [];
    for (const [path, content] of Object.entries(options.changes)) {
      if (content === null) {
        entries.push({ path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      const blob = (await this.request<{ sha: string }>("POST", `${this.repoPath(ref)}/git/blobs`, { content, encoding: "utf-8" })) as { sha: string };
      entries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = (await this.request<{ sha: string }>("POST", `${this.repoPath(ref)}/git/trees`, { base_tree: base.tree.sha, tree: entries })) as { sha: string };
    const commit = (await this.request<{ sha: string }>("POST", `${this.repoPath(ref)}/git/commits`, {
      message: options.message,
      tree: tree.sha,
      parents: [options.baseSha],
      ...(options.author ? { author: options.author } : {}),
    })) as { sha: string };
    const existing = await this.branchSha(ref, options.branch);
    if (existing) {
      await this.request("PATCH", `${this.repoPath(ref)}/git/refs/heads/${options.branch.split("/").map(encodeURIComponent).join("/")}`, { sha: commit.sha, force: true });
    } else {
      await this.request("POST", `${this.repoPath(ref)}/git/refs`, { ref: `refs/heads/${options.branch}`, sha: commit.sha });
    }
    return { sha: commit.sha, branch: options.branch, created: !existing };
  }

  /** Open a pull request (or return the open one for the same head). */
  async openPullRequest(ref: GitHubRepoRef, options: { head: string; base: string; title: string; body: string; draft?: boolean }): Promise<{ number: number; url: string; existing: boolean }> {
    const open = (await this.request<Array<{ number: number; html_url: string }>>("GET", `${this.repoPath(ref)}/pulls?state=open&head=${encodeURIComponent(`${ref.owner}:${options.head}`)}`)) ?? [];
    if (open[0]) return { number: open[0].number, url: open[0].html_url, existing: true };
    const pr = (await this.request<{ number: number; html_url: string }>("POST", `${this.repoPath(ref)}/pulls`, { title: options.title, head: options.head, base: options.base, body: options.body, draft: options.draft ?? true })) as { number: number; html_url: string };
    return { number: pr.number, url: pr.html_url, existing: false };
  }
}
