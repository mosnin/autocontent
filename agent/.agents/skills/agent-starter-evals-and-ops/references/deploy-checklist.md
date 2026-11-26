# Deploy checklist

Work top to bottom. Every item has a check. Paths are for a generated project.

## 0. Dependencies
- [ ] `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` pinned to `1.4.0` (`overrides` + `pnpm.overrides` in `package.json`; at the workspace root in a monorepo). Check: `pnpm why @earendil-works/pi-ai` shows only 1.4.0. 1.5.0 removed the `Type` export Flue 2.3.0 imports.
- [ ] `@modelcontextprotocol/client` overridden to `2.3.1` (Flue 2.3.0 pins a vulnerable 2.0.0) and `pnpm audit --prod --audit-level high` passes.
- [ ] `registerExtendedModels()` and `installAgentStarterObserver(observerOptions())` run at module top level in `src/app.ts`, after `import "@agent-starter/flue/cloudflare"`. Check: `grep -n "registerExtendedModels()\|installAgentStarterObserver" src/app.ts`. Without the first, `openai/gpt-6.1-terra` fails with "Unknown model ID".

## 1. Infrastructure (once per account / environment)
- [ ] `pnpm infra:init` (= `bash scripts/init-cloudflare-infra.sh`, safe to re-run: existing resources are skipped) created everything `wrangler.jsonc` references (names carry the project name, `<name>`):
  - KV `TENANT_CONFIG`, `AGENT_CACHE` (+ `WIDGET_KEYS` for widget, `OAUTH_KV` for in-app), titled `<name>-<BINDING>`
  - R2 `<name>-workspaces` (artifacts, snapshots, workspaces, eval datasets)
  - Vectorize `<name>-memory` (768 dims, cosine) **and** metadata indexes `tenantId`, `documentId` (+ `userId` with chat) — tenant-filtered queries fail without them
  - Queues `<name>-events` + `<name>-events-dlq` (background), `<name>-bus` + `<name>-bus-dlq` (multi-agent)
  - Optional AI Search: a separate `<name>-knowledge` bucket, `wrangler ai-search create <name>-search --type r2 --source <name>-knowledge`, tenant documents under `<tenantId>/`, and `AI_SEARCH_INSTANCE` set
  Check: `npx wrangler kv namespace list`, `npx wrangler r2 bucket list`, `npx wrangler vectorize list`, `npx wrangler queues list`.
- [ ] KV ids copied into `wrangler.jsonc` (no `REPLACE_WITH_` left). Check: `grep -n REPLACE_WITH_ wrangler.jsonc` is empty (`pnpm run deploy` refuses to start otherwise).
- [ ] Computer-use only: golden VM built (`node scripts/build-golden-vm.mjs <name>`) and `BOAT_GOLDEN_SNAPSHOT_ID` set.
- [ ] Widget only: each site registered in `WIDGET_KEYS` (`widget:<pk>` → `{ tenantId, allowedOrigins }`) and its origin added to `ALLOWED_ORIGINS`.

## 2. Secrets (`npx wrangler secret put NAME`; never in `wrangler.jsonc`, never committed)
- [ ] Required: `OPENAI_API_KEY`, `SESSION_SIGNING_SECRET`, `APPROVAL_SIGNING_SECRET`, `WEBHOOK_SIGNING_SECRET`.
- [ ] Module: `SAAS_SERVICE_TOKEN` (background, in-app), `BOAT_DEV_API_KEY` (computer-use).
- [ ] Optional: `SESSION_SIGNING_SECRET_PREVIOUS` (rotation), `SENDRAVEN_API_KEY` (approval emails), `PUSHER_APP_ID`/`PUSHER_KEY`/`PUSHER_SECRET`/`PUSHER_CLUSTER`, `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_BASE_URL`, `OTLP_TRACES_TOKEN`, `CF_API_TOKEN` (Browser Rendering), `COMPOSIO_API_KEY`, `MANYCHAT_WEBHOOK_SECRET`, one secret per `mcpServers[].tokenSecret`.
- [ ] `EVAL_HARNESS_SECRET`: **unset in production** (harness returns 404) or ≥32 random chars and only on a staging Worker.
- [ ] Generated with `openssl rand -base64 48`; host SaaS uses the same `SESSION_SIGNING_SECRET` / `WEBHOOK_SIGNING_SECRET`. Check: `npx wrangler secret list`.

## 3. Vars (`wrangler.jsonc` `vars`)
- [ ] `PUBLIC_BASE_URL` = the public Worker origin (approval and artifact links are built from it). Check: `bash scripts/canary.sh preflight` passes (it refuses localhost and placeholders); an approval email link opens `/approvals/<token>`.
- [ ] `ALLOWED_ORIGINS` lists every host app and widget site.
- [ ] `PRIMARY_SAAS_API_URL`, `PRIMARY_SAAS_WEBHOOK_URL`, `OPS_ALERT_EMAIL` (DLQ, budget, stall and VM-halt alerts are skipped while empty), `AI_SEARCH_INSTANCE` (optional), `CF_ACCOUNT_ID`, `AI_GATEWAY_ID` + `AI_GATEWAY_CACHE_TTL` (optional), `OTLP_TRACES_ENDPOINT` (optional).
- [ ] `AGENT_MODEL` (default `openai/gpt-6.1-terra`), `AGENT_FALLBACK_MODELS`, `FIRST_LINE_MODEL`.
- [ ] `CODE_VERSION` bumped for this release (shown by `/health`).

## 4. Migrations
- [ ] Durable Object migrations are append-only: every new agent/DO class has a **new** tag with `new_sqlite_classes` (`Flue<Pascal>Agent` from `flueClassName`); no applied tag was edited or removed. Check: `git diff wrangler.jsonc` only appends to `migrations`.
- [ ] In-DO SQLite schemas (`CORE_MIGRATIONS`, `ROOM_MIGRATIONS`, your own `MigrationSet`s) only add new versions; each has `down` statements so `MigrationRunner.rollbackTo` works. Check: core test "rolls back a failing migration atomically" pattern for your set.
- [ ] Renamed/removed tools or persisted-state shapes are compatible with runs already in flight (no version gate is wired); for breaking changes, drain long jobs first (pause ingestion or wait for `active()` runs to settle).

## 5. Gates
- [ ] `pnpm typecheck && pnpm lint && pnpm test:coverage && pnpm build` (and `pnpm typecheck:web` when React snippets exist); `pnpm audit --prod --audit-level high`.
- [ ] Evals green against a dev/staging Worker: `pnpm evals` (exits non-zero on any failing case; `EVAL_BASE_URL` points it at staging).
- [ ] CI secrets set in GitHub: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `OPENAI_API_KEY`, `EVAL_HARNESS_SECRET`.

## 6. Deploy + canary
- [ ] `pnpm run deploy` (`scripts/deploy.sh`: `canary.sh preflight` (KV ids, PUBLIC_BASE_URL) → `tsc --noEmit` → `vitest run` → `vite build` → `wrangler deploy` → `canary.sh verify`). Check: prints `✅ Production deployment verified at <url> (health=200, validation=400)`. CI deploys run the same preflight and canary.
- [ ] On canary failure: `npx wrangler rollback`, then investigate with `npx wrangler tail`.

## 7. After deploy
- [ ] Crons registered (`* * * * *` sentinel, `17 6 * * *` report). Check: Cloudflare dashboard → Worker → Triggers, or `wrangler tail` shows `[sentinel]` lines when runs stall.
- [ ] Queue consumers attached with `max_retries` and DLQs, and the `<name>-events-dlq` / `<name>-bus-dlq` consumers attached. Check: dashboard → Queues.
- [ ] Production tenants were NOT seeded with `pnpm seed:dev` (it only writes local KV; it refuses `--remote`).
- [ ] Pilot tenants' config synced (`PUT /internal/tenants/:tenantId/config`, signed). Check: agents stop using secure freemium defaults.
- [ ] Host routes live: token minting, signed webhook receiver (accepts OUTBOUND_WEBHOOK_SECRET and WEBHOOK_SIGNING_SECRET, dedupes on `x-agent-event-id`), Pusher auth (`web/host-routes.example.ts`, or the Worker's own `POST /api/pusher/auth`).
- [ ] Smoke one conversation per mounted agent and one webhook per event source; one approval end to end.
