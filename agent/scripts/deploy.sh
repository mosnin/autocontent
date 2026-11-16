#!/usr/bin/env bash
# deploy.sh — preflight, type-check, test, build, deploy, then canary-verify the live Worker.
set -euo pipefail

# Real KV namespace ids and a public PUBLIC_BASE_URL (never localhost or a placeholder) before anything else.
bash scripts/canary.sh preflight

echo "=== 1/5 Type safety audit ==="
npx tsc --noEmit

echo "=== 2/5 Contract & unit tests ==="
npx vitest run

echo "=== 3/5 Build (Flue + Vite) ==="
npx vite build

echo "=== 4/5 Deploy to Cloudflare ==="
npx wrangler deploy

echo "=== 5/5 Canary verification ==="
bash scripts/canary.sh verify
