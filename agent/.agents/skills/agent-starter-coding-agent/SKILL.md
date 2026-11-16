---
name: agent-starter-coding-agent
description: Build and change the Cursor-class coding agent of an Agent Starter project — the Coder agent (coding module), its reviewer subagent, the tenant-isolated R2 workspace with view/grep/patch tools (injective storageSegment names), agent git (AgentGit, three-way merges, checkout that never overwrites uncommitted edits, conflict resolution commits that record main), the coding tools from createCodingTools (protected main and agent/* branches, commit_changes, branch_diff, run_tests and run_command in a boat.dev VM via syncTreeToSandbox, test-gated and approval-gated merge_to_main, GitHub import_repo / push_branch / open_pull_request with a per-tenant repo allowlist, heartbeats during long tools), the diff review UI (DiffView, CoderWorkbench, /api/coder diff route) and the runtime coding-workflow skill. Use when touching src/agents/coder.ts, src/coding/*, web/CoderWorkbench.tsx, src/skills/coding-workflow/SKILL.md, workspace/git/test/PR tools, or when wiring tests, pushes or deploys into an agent.
---

# Coding agent (Coder)

```
User (CoderWorkbench / chat, /agents/coder/<conversationId>)
  └─ Coder (Flue DO, one workspace per conversation: tenants/<tenant>/workspaces/<storageSegment(conversation)>/)
       ├─ get code  import_repo (configured GitHub repo → workspace main)          GitHub REST, token stays in the Worker
       ├─ explore   list_files · search_files · view_lines                           WorkspaceFS over R2 (flue createWorkspaceTools, no git tools)
       ├─ plan      plan_goals · update_goal
       ├─ branch    create_branch agent/<name>                                       main is never a writable argument
       ├─ edit      patch_file · write_file · delete_file
       ├─ commit    commit_changes (auto-detects changes) → commitId + diff          AgentGit (SQLite refs + R2 blobs); diff published for the UI
       ├─ test      run_tests (committed head → VM, deps on lockfile change)        boat.dev VM via VmRunManager, live output, result recorded
       │            run_command (lint/build on working copy; not a test run)
       ├─ review    branch_diff → reviewer subagent
       └─ land      merge_to_main  HIGH + approval + passing tests on that commit
                    push_branch / open_pull_request  HIGH + approval
```

## When to use
Changing the Coder's tools, prompt or workflow; adding test suites, PR or deploy steps; letting several
agents edit one workspace; building review UIs for agent diffs.

## Mental model — who owns what

| Concern | File (generated project) | Library source |
|---|---|---|
| Agent, tool wiring, reviewer subagent, hibernation, `useCustomSkills()` | `src/agents/coder.ts` (`Coder`, `/agents/coder`) | — |
| Workspace/git/diff/remote wiring | `src/coding/workspace.ts` (`workspaceFs`, `workspaceGit`, `publishDiff`, `codingRemote`, `CodingEnv`) | — |
| Pure policy: storage names, diff keys, tenant → repo | `src/coding/policy.ts` (`workspaceName`, `diffKey`, `COMMIT_ID_PATTERN`, `resolveTenantRepo`; tested in `test/coding-policy.test.ts`) | core `storageSegment` (`workspace-fs.ts`) |
| The coder's VM (self-contained; no computer-use module needed; on only with `integrations.boatdev` + `BOAT_DEV_API_KEY`) | `src/coding/vm.ts` (`coderVmConfigured`, `coderVm`, `withCoderSandbox`, `hibernateCoderVm`, `stopCoderVm`, recovery hook `coding:vm`) | `packages/integrations/src/boatdev.ts` (`VmRunManager`, `boatSandboxPort`) |
| Diff + teardown routes | `src/coding/routes.ts` (`codingRoutes`) | — |
| Review UI | `web/CoderWorkbench.tsx` | `packages/react/src/components/DiffView.tsx` |
| Coding loop the model follows | `src/skills/coding-workflow/SKILL.md` | — |
| Coding tools, test ledger, branch protection | — | `packages/core/src/workspace/coding-tools.ts` (`createCodingTools`, `computeBranchDiff`, `CodingLedger`) |
| Workspace ↔ VM sync | — | `packages/core/src/workspace/sandbox-sync.ts` (`syncTreeToSandbox`, `importFromSandbox`, `readTree`, `SandboxPort`) |
| GitHub remote | — | `packages/core/src/workspace/github.ts` (`GitHubClient`, `parseRepoRef`) |
| File primitives / agent git | — | `workspace-fs.ts` `WorkspaceFS`, `agent-git.ts` `AgentGit`, `merge.ts` |
| Config | vars `CODER_TEST_COMMAND`, `CODER_SETUP_COMMAND`, `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_TENANTS`, `BOAT_GOLDEN_SNAPSHOT_ID`, `BOAT_USD_PER_SECOND`, `BOAT_REGION`; secrets `BOAT_DEV_API_KEY`, `GITHUB_TOKEN`; optional `CODER_LINT_COMMAND`; KV `coding:repo:<tenantId>` | `templates/modules/coding/module.json` |

## API reference (from source)

```ts
// packages/core/src/workspace/coding-tools.ts
createCodingTools({ fs: () => WorkspaceFS, git: () => AgentGit, sql: () => SqlStore, agentId?, branchPrefix? /*"agent/"*/, mainBranch? /*"main"*/,
  sandbox?: (ctx, fn: (port: SandboxPort, sandboxKey) => Promise<T>) => Promise<T>, sandboxDir? /*"workspace/repo"*/,
  testCommands? /*{ test: "npm test" }*/, setupCommand?, setupTriggers?, testTimeoutSeconds? /*300, ≤600*/, sandboxFeatures? /*["computerUse"]*/,
  remote?: (ctx) => { client: GitHubClient; repo: GitHubRepoRef } | undefined, publishDiff?: (ctx, diff: BranchDiff) => Promise<void>, maxPatchChars?,
  heartbeatIntervalMs? /*30_000: ctx.services.heartbeat beats during run_tests, run_command, import_repo, push_branch*/ })
// create_branch {name}                         LOW/write      commit_changes {branch, message, paths?}  LOW/write → { commitId, files, diff }
//   (after a conflicted sync: also commits every path the merge touched, refuses while <<<<<<< markers remain, records main as 2nd parent)
// branch_diff {branch}                         LOW/read       delete_file {path}                        MEDIUM/write
// sync_with_main {branch}                      LOW/write → { status: "up-to-date" | "fast-forward" | "merged", deleted, keptModified, mergedIntoUncommitted?, conflicted?, note? }
//   | { status: "conflict", files, appliedFromMain, next }   (clean changes + markers staged in the workspace; pending merge recorded)
//   | { status: "uncommitted_changes", uncommitted, conflicting }   (merge would touch uncommitted files: nothing changed)
// merge_to_main {branch, commitId, summary}    HIGH/write, requiresApproval; head must equal commitId; last run_tests on commitId must pass;
//   the workspace keeps edits made while the merge waited (keptModified / mergedIntoUncommitted / conflicted)
// with sandbox: run_tests {branch, suite}      MEDIUM/external (records pass/fail per commit)   run_command {command, timeoutSeconds≤300} MEDIUM/external
// with remote:  import_repo {ref?}             MEDIUM/write (empty workspace only)
//               push_branch {branch, commitId, message}   HIGH/external, approval      open_pull_request {branch, title, body?, draft?=true} HIGH/external, approval
computeBranchDiff(git, branch, main?) → { branch, commitId, base, files: [{ path, status, additions, deletions }], patch }
new CodingLedger(sql, workspace) .recordTest .lastTest(branch) .manifest .saveManifest .remote .saveRemote .push .savePush
  .pendingMerge(branch) .savePendingMerge(branch, mergeHead, paths) .clearPendingMerge(branch)   // tables as_code_*

// packages/core/src/workspace/sandbox-sync.ts
interface SandboxPort { exec(cmd, { cwd?, timeoutSeconds?, signal?, onOutput? }); writeFile(path, content, { encoding? }); readFile(path, { encoding? }) }
syncTreeToSandbox({ files, sandbox, dir, manifest?, concurrency?, signal? }) → { written, deleted, unchanged, manifest }   // hash-incremental
importFromSandbox({ sandbox, dir, fs, maxFiles?, maxFileBytes? }) → { imported, skipped }    readTree(git, tree)    shellQuote(value)

// packages/core/src/workspace/github.ts
new GitHubClient({ token: () => string | undefined, fetch?, baseUrl?, userAgent? })
  .getRepo(ref) .branchSha(ref, branch) .downloadTree(ref, sha, { maxFiles?, maxFileBytes? }) .pushCommit(ref, { branch, baseSha, changes, message, author? }) .openPullRequest(ref, { head, base, title, body, draft? })
parseRepoRef("owner/repo")

// packages/core/src/workspace/agent-git.ts
new AgentGit(sql, blobs, workspace).commit · merge · branches · head · tree · readFile · mergeBase · trackedHistory(commitId)
  .merge(source, target, author) → { status, commitId?, conflicts?, clean? /*on conflict: cleanly merged paths*/, sourceHead? }
  .checkout(branch, fs, { from?, prune? }) → { written, deleted, kept, merged, conflicted }
  //   from = the ref/commit the workspace was at. Clean files (= from's version; without from: any committed version) are updated.
  //   Dirty files are never silently overwritten: untouched → kept; changed → 3-way merged (merged) or written with
  //   <<<<<<< workspace (uncommitted) markers holding both sides (conflicted); local deletions kept. prune: true = exact mirror.
  .uncommittedPaths(ref, fs, paths?) → string[]   // workspace paths that differ from ref's tree

// packages/core/src/workspace/workspace-fs.ts
storageSegment(id) → "<sanitized prefix ≤48>~<sha256(id)[0:32]>"   // injective, path-safe R2 segment for conversation/run ids

// packages/react/src/components/DiffView.tsx
<DiffView patch | files title? collapsed? maxLinesPerFile? emptyText? />   parseUnifiedDiff(patch) → DiffFile[]   diffFromArgs(args)
```

## Recipes

### 1. Isolation (never change)
Workspace = `workspaces/<storageSegment(conversationId)>` inside `TenantScopedBlobStore(workspaceBlobs(), tenantId)`
(`src/coding/policy.ts`). Never name storage with a lossy replace: `alice:2Esmith` (user `alice.smith`) and
`alice_2Esmith` would share one workspace and diff store. The repository comes from KV `coding:repo:<tenantId>`,
or `GITHUB_REPOSITORY` only for tenants listed in `GITHUB_REPOSITORY_TENANTS` (`resolveTenantRepo`); the token
from `GITHUB_TOKEN`. None of these are tool arguments. The VM never gets credentials.

### 2. Test suites and setup
```bash
# wrangler.jsonc vars (or .dev.vars)
CODER_TEST_COMMAND="pnpm test --run"      CODER_LINT_COMMAND="pnpm lint"      CODER_SETUP_COMMAND="pnpm install --frozen-lockfile"
```
`run_tests` tests the **committed** branch head (so a merge approval binds to tested code), installs
dependencies on a fresh VM or when a manifest/lockfile changed and streams output (`sandbox` TelemetryEvents).
`run_tests`, `run_command`, `import_repo` and `push_branch` beat `ctx.services.heartbeat` every 30 s (and
`withCoderSandbox` passes the same beat, or a direct registry beat, into `VmRunManager.withVm`), so long suites
and large imports are never swept as deadlocks. The VM stops after every response, approval waits included (the
coder keeps no live page, so there is no approval grace as in computer use); its lifecycle reaches the telemetry sinks
as `status` events (PROVISIONING / RUNNING / STOPPING) and its output events carry `data.vmSeconds`, the billed VM time
`AgentControlPanel` shows. `run_tests` and `merge_to_main` are unavailable unless `coderVmConfigured()`
(`integrations.boatdev` in `agent-starter.config.ts` AND `BOAT_DEV_API_KEY`); stopping a VM never depends on the flag.

### 3. Gated merges and protected main
`merge_to_main` parks for approval (HIGH). On approval it re-checks that the branch head still equals the
approved `commitId` and that the last `run_tests` on that branch passed on that commit; otherwise it refuses.
Every branch argument must match `agent/<name>`; there is no tool that writes `main` directly. Do not mount
flue's `createWorkspaceTools({ sql })` git tools in the coder (`commit_changes`/`merge_branch` there are unprotected).

### 4. Real repositories (GitHub)
1. `GITHUB_TOKEN` (fine-grained: contents + pull requests on the repo) and `GITHUB_REPOSITORY=owner/repo` (or the KV mapping).
2. The agent calls `import_repo` (text files ≤1 MB, ≤2000 files; binaries skipped) → workspace `main`.
3. Work on `agent/*`, `run_tests`, then `push_branch` (one commit on the imported base, ref `refs/heads/agent/…`) and `open_pull_request` (draft, body includes the test status). Both are HIGH and need approval.
For multi-tenant SaaS prefer per-tenant GitHub App installation tokens over one shared PAT.

### 5. Diff review UI and approval previews
`commit_changes` publishes `computeBranchDiff` to `tenants/<tenant>/diffs/<conversation>/<commitId>.json`;
`GET /api/coder/:conversationId/diff/:commitId` serves it to the conversation owner (or a tenant operator).
`web/CoderWorkbench.tsx` shows each pending `merge_to_main`/`push_branch` approval with `HumanOversightCard`
plus `DiffView` of exactly the approved commit, and a live terminal from `sandbox` telemetry.

### 6. Syncing, conflicts and uncommitted work
Each agent commits to its own `agent/<name>` branch; `sync_with_main` brings `main` in and never overwrites
uncommitted edits (R8):
- clean merge → committed; the workspace checkout keeps, merges or marks uncommitted edits (see `checkout`);
- conflict → if a conflicting or incoming file has uncommitted edits, `uncommitted_changes` (nothing changed:
  commit first); otherwise clean incoming changes and `<<<<<<<` markers are staged in the workspace and a pending
  merge is recorded. The next `commit_changes` on that branch commits every touched path, refuses while markers
  remain, and records `main` as a second parent, so the next sync is up to date and `merge_to_main` fast-forwards.

### 7. Emergency stop
`POST /api/coder/:conversationId/teardown` (operator session) force-stops the coder's VM, marks the run halted,
aborts it and sets the registry to `HALTED`. The sentinel's recovery hook `coding:vm` stops the VM of a stalled coder run.

## Checklist — spec requirements for this topic
- [ ] **Explore → plan → edit → test → review → merge loop** (R-CODE-01). Verify: `coding-workflow` skill + reviewer `useSubagent` in `src/agents/coder.ts`; core tests in `packages/core/test/workspace-coding.test.ts`.
- [ ] **Per-conversation, tenant-isolated workspace** (R-CODE-02). Verify: `TenantScopedBlobStore` in `src/coding/workspace.ts`; core test "confines blob keys to the tenant prefix and blocks traversal".
- [ ] **Edits verified by running the workspace's tests in a VM (workspace ↔ sandbox sync)** (R-CODE-03). Verify: test "run_tests syncs the committed head into the VM (setup on first sync / lockfile change), streams output and records the result"; "writes only changed files, deletes files that left the tree…".
- [ ] **Real repositories: import, branch, test, push, PR** (R-APP-11). Verify: test "imports the configured repo, pushes the agent branch as one commit and opens a draft PR with the test status".
- [ ] **Protected main.** Verify: test "protects main: branch arguments must be agent/<name>…".
- [ ] **Test-gated, approval-gated merge.** Verify: test "merge_to_main is HIGH risk, parks for approval, and needs a passing run_tests on exactly the approved commit".
- [ ] **Pushes/PRs need approval.** Verify: `push_branch`/`open_pull_request` HIGH + `requiresApproval` (same GitHub test).
- [ ] **Checkout removes files deleted on the branch, keeps local edits.** Verify: test "deletes files the branch removed, keeps locally modified and untracked files".
- [ ] **Sync/merge never overwrite uncommitted workspace edits** (runtime audit R8). Verify: `packages/core/test/workspace-safety.test.ts` "audit probe: an uncommitted edit to a file the merge does not touch is kept and reported", "an uncommitted edit to a file main also changed is three-way merged…", "a conflicting sync with uncommitted edits…", "merge_to_main keeps edits made while the merge waited for approval".
- [ ] **Conflict resolution converges** (resolution commit records `main`; no re-conflict loop). Verify: test "conflict → resolve → commit → sync is up to date → merge_to_main fast-forwards with main's other changes intact".
- [ ] **Injective workspace / diff storage names** (SEC-08). Verify: core test "keeps ids apart that lossy sanitising would merge (security audit probe)"; generated `test/coding-policy.test.ts`.
- [ ] **Default repository only for allowlisted tenants** (SEC-16). Verify: generated `test/coding-policy.test.ts` "is used only by allowlisted tenants; KV mappings always win".
- [ ] **Heartbeats during long coding tools** (R3). Verify: core test "run_tests beats ctx.services.heartbeat every 30 s while the suite runs, and stops beating afterwards".
- [ ] **Diff review UI.** Verify: `packages/react/test/diff-view.test.tsx`; `web/CoderWorkbench.tsx` type-checks (`pnpm typecheck:web`).
- [ ] **VM cost/teardown for coder runs.** Verify: `withCoderSandbox` uses `VmRunManager.withVm`; integrations tests for `VmRunManager`.
- [ ] **Sandboxed code execution** (`run_code`, no network) over read-only workspace tools. Verify: `createCodeExecutionTool({ loader, tools: readOnly })` in `coder.ts`.

## Pitfalls
- `run_tests` tests committed code: commit first. `run_command` uses the working copy and never counts for merges.
- Approvals bind to `commitId`: any new commit after approval makes the merge/push refuse — re-test and ask again.
- Repository content is untrusted (prompt injection in comments/READMEs); the reviewer prompt and `untrusted-content` skill say so.
- Keep setup + test under the tool timeout (`testTimeoutSeconds`, default 300 s each).
- A shared `GITHUB_TOKEN` can reach every repo it is scoped to; map tenants to repos server-side (KV), list only trusted tenants in `GITHUB_REPOSITORY_TENANTS`, and scope the token tightly.
- Upgrading from a version that named workspaces with a lossy replace: existing workspaces live under the old key and are not migrated (the old naming was the SEC-08 bug); start new conversations.
- `checkout` without `from` cannot three-way merge a dirty file (no base): it keeps it and reports `kept`. Pass `from` (the pre-merge head) whenever you have it.
- `import_repo` only fills an empty workspace (start a new conversation for a fresh import).

## Verify
```bash
pnpm --filter @agent-starter/core test           # coding tools, sync, GitHub client, AgentGit checkout
pnpm --filter @agent-starter/integrations test   # VmRunManager, boatSandboxPort, streaming
pnpm --filter @agent-starter/react test          # DiffView
pnpm typecheck && pnpm typecheck:web && pnpm test   # generated project
```
Manual: open the workbench, ask for a small change; expect `create_branch`, `commit_changes` (diff), `run_tests`
(live terminal), reviewer task, then a `merge_to_main` approval card showing the diff.

## Related skills
`agent-starter-computer-use` (VMs, teardown) · `agent-starter-tools-and-firewall` (risk tiers, approvals) ·
`agent-starter-memory-and-context` (workspace/R2) · `agent-starter-planning-and-cognition` (plans, subagents) ·
`agent-starter-generative-ui` (chat, approvals UI) · `agent-starter-security` (tenancy, secrets) · `agent-starter-definition-of-done`.

## Not yet implemented
- Repositories are imported through the GitHub API into R2 (text files only, size/count caps); there is no full `git clone` with history inside the VM, and no pull of later upstream changes into an existing workspace.
- Deploy tools (preview/production) are not shipped; add them as HIGH/CRITICAL tools with fixed targets.
- Flue's shared `commit_changes`/`merge_branch` (`packages/flue/src/cognitive-tools.ts`) are still unprotected for other agents that mount them with `sql` (protection lives in `createCodingTools`).
- `HumanOversightCard` itself does not render diffs; the workbench pairs it with `DiffView` (`diffFromArgs` is available for cards that receive a diff in args).
