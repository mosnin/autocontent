#!/usr/bin/env bash
# init-cloudflare-infra.sh — one-time production bootstrap for marketer-agents.
# Creates every binding referenced in wrangler.jsonc, then prompts for secrets.
# Safe to re-run: a resource that already exists is reported and skipped.
# Queue, R2 bucket and Vectorize index names carry the project name (marketer-agents-*): they are global per account.
# Afterwards, copy the printed KV namespace ids into wrangler.jsonc (REPLACE_WITH_* placeholders) before deploying.
set -euo pipefail

echo "=== Agent Starter infrastructure bootstrap: marketer-agents ==="

# Edge tenant-config cache (SaaS → edge sync) and general agent cache (semantic cache, rate limits, page cache).
# Wrangler titles them "marketer-agents-<BINDING>"; paste each printed id into wrangler.jsonc.
npx wrangler kv namespace create TENANT_CONFIG || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"
npx wrangler kv namespace create AGENT_CACHE || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"

# Durable workspace / artifact / snapshot / eval-dataset bucket
npx wrangler r2 bucket create marketer-agents-workspaces || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"

# Long-term semantic memory (768 dims = @cf/baai/bge-base-en-v1.5) + tenant metadata index for isolation filters
npx wrangler vectorize create marketer-agents-memory --dimensions=768 --metric=cosine || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"
npx wrangler vectorize create-metadata-index marketer-agents-memory --property-name=tenantId --type=string || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"
npx wrangler vectorize create-metadata-index marketer-agents-memory --property-name=documentId --type=string || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"
# Retrieval filters on userId (own memories + tenant-wide ones) in every project: without this index it returns nothing.
npx wrangler vectorize create-metadata-index marketer-agents-memory --property-name=userId --type=string || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"

# Optional, one secret per purpose (each falls back to WEBHOOK_SIGNING_SECRET):
#   npx wrangler secret put INBOUND_WEBHOOK_SECRET    # signed event ingestion (/events, /webhooks)
#   npx wrangler secret put OUTBOUND_WEBHOOK_SECRET   # signatures on webhooks to your SaaS
#   npx wrangler secret put TENANT_SYNC_SECRET        # PUT /internal/tenants/:id/config from your SaaS
#   npx wrangler secret put ARTIFACT_SIGNING_SECRET   # signed artifact download links (GET /artifacts/...)
#   npx wrangler secret put OTLP_TRACES_TOKEN         # bearer for the OTLP_TRACES_ENDPOINT collector

# Optional: Cloudflare AI Search (managed RAG over your help center / docs), queried by AiSearchSource.
# Keep knowledge in its OWN bucket (never the workspace bucket) and store each tenant's documents under
# "<tenantId>/" (flat): retrieval filters on that folder, so tenants never see each other's documents.
# tenantDocumentKey()/putTenantDocument() from @agent-starter/cloudflare write keys in that layout.
#   npx wrangler r2 bucket create marketer-agents-knowledge
#   npx wrangler ai-search create marketer-agents-search --type r2 --source marketer-agents-knowledge
#   npx wrangler r2 object put marketer-agents-knowledge/tenant_alpha/getting-started.md --file ./docs/getting-started.md --remote
#   npx wrangler ai-search stats marketer-agents-search      # wait until indexing finished
# Then set "AI_SEARCH_INSTANCE": "marketer-agents-search" in wrangler.jsonc vars (empty = AI Search off).

# --- Module resources -------------------------------------------------------
npx wrangler kv namespace create OAUTH_KV || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"
npx wrangler queues create marketer-agents-events || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"
npx wrangler queues create marketer-agents-events-dlq || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"
# Senders sign method + path + body: signRequest(secret, { method: 'POST', path: '/events/<source>/<tenant>', body }) -> x-agent-signature.
# Per-tenant webhook secret (optional; tenants without one use the shared WEBHOOK_SIGNING_SECRET, bound to the signed path):
# npx wrangler kv key put --binding TENANT_CONFIG 'webhook-secrets:tenant_alpha' '["<secret-at-least-16-chars>"]'
# Stripe (POST /webhooks/stripe/<tenant>): each tenant's own endpoint secret(s), no shared fallback:
# npx wrangler kv key put --binding TENANT_CONFIG 'stripe-webhook-secrets:tenant_alpha' '["whsec_..."]'
# Marketer pipeline events (POST /webhooks/marketer/<clerk user id>): register the endpoint in Marketer
# (POST /api/v1/webhook-endpoints, events job.done/job.failed/job.awaiting_approval/article.done/article.failed) and
# store the secret it returns once, per account, no shared fallback (Marketer signs t.body only):
# npx wrangler kv key put --binding TENANT_CONFIG 'marketer-webhook-secrets:user_2abc...' '["<endpoint secret>"]'
npx wrangler queues create marketer-agents-bus || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"
npx wrangler queues create marketer-agents-bus-dlq || echo "  ↳ already exists (or failed): skipped — check with the matching 'list' command"
# Persistent agents: PERSISTENT_EGRESS_ALLOW (wrangler.jsonc vars) is the platform allowlist every persistent agent's fetches must match; empty = no outbound fetches.
# Credentials the broker may inject are mapped to Worker secrets in src/persistent/credentials.ts (e.g. github -> GITHUB_TOKEN); the agent only ever names them.
# Create an agent: PUT /api/persistent/<agentId>/config with { config, expectedVersion: 0 } as a tenant admin (see web/PersistentAgentConsole.tsx).
# Marketer autopilot: PERSISTENT_EGRESS_ALLOW must list the Marketer API host (the host of PRIMARY_SAAS_API_URL), and the
# config from src/marketer/heartbeat.ts (marketerAutopilotConfig) binds the `saas` credential to that host.

# --- Marketer API ----------------------------------------------------------------
# Set PRIMARY_SAAS_API_URL in wrangler.jsonc vars to the Marketer backend origin (e.g. https://api.marketer.sh, no /api/v1).
# SAAS_SERVICE_TOKEN (below) MUST equal the backend's MARKETER_AGENT_SERVICE_TOKEN: the backend then acts as the user in
# x-tenant-id (always role "user", never admin). Generate one value (openssl rand -base64 48) and set it on both sides.
# SESSION_SIGNING_SECRET (below) MUST equal the Next.js web app's SESSION_SIGNING_SECRET: the web app mints session tokens
# for the signed-in Clerk user (tenant id = Clerk user id).

# --- Secrets (prompted interactively; re-running overwrites) -----------------
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put SESSION_SIGNING_SECRET      # = web app (../web) SESSION_SIGNING_SECRET
npx wrangler secret put APPROVAL_SIGNING_SECRET
npx wrangler secret put WEBHOOK_SIGNING_SECRET
npx wrangler secret put EVAL_HARNESS_SECRET
npx wrangler secret put SAAS_SERVICE_TOKEN          # = backend MARKETER_AGENT_SERVICE_TOKEN
npx wrangler secret put PERSISTENT_ASSERTION_SECRET

echo ""
echo "✅ Infrastructure ready."
echo "Next: paste the KV namespace ids printed above (incl. module KV namespaces) over the REPLACE_WITH_*_KV_ID placeholders in wrangler.jsonc"
echo "      (lost them? npx wrangler kv namespace list), then run: pnpm run deploy"
