#!/usr/bin/env bash
# canary.sh: deploy checks shared by scripts/deploy.sh and the CI deploy job.
#   bash scripts/canary.sh preflight   before deploying: real KV namespace ids, and a public PUBLIC_BASE_URL
#                                      (approval links, artifact links and email senders are built from it)
#   bash scripts/canary.sh verify      after deploying: /health answers 200 and the edge router rejects a malformed
#                                      approval token with 400 (routing + validation are live). CANARY_BASE_URL
#                                      overrides the target (default: PUBLIC_BASE_URL from wrangler.jsonc).
set -euo pipefail

public_base_url() {
  node -e "const c=require('fs').readFileSync('wrangler.jsonc','utf8').replace(/^\s*\/\/.*$/mg,'');console.log(JSON.parse(c).vars.PUBLIC_BASE_URL||'')"
}

# Exit 0 for a deployable URL: http(s), not loopback / localhost, not a template placeholder.
is_public_url() {
  node -e '
    let u;
    try { u = new URL(process.argv[1]); } catch { process.exit(1); }
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const local = ["localhost", "0.0.0.0", "::1", "::"].includes(host) || host.endsWith(".localhost") || /^127\./.test(host);
    const placeholder = /REPLACE_WITH|[<>]|your-subdomain/i.test(process.argv[1]) || /(^|\.)example\.(com|org|net)$/.test(host);
    process.exit(/^https?:$/.test(u.protocol) && !local && !placeholder ? 0 : 1);
  ' "$1"
}

preflight() {
  # KV namespace ids must be real before wrangler deploy (pnpm infra:init prints them).
  if grep -q 'REPLACE_WITH_[A-Z_]*_KV_ID' wrangler.jsonc; then
    echo "🚫 wrangler.jsonc still has REPLACE_WITH_*_KV_ID placeholders:"
    grep -n 'REPLACE_WITH_[A-Z_]*_KV_ID' wrangler.jsonc
    echo "   Run pnpm infra:init, paste the printed KV namespace ids (npx wrangler kv namespace list), then deploy again."
    exit 1
  fi
  local url
  url="$(public_base_url)"
  if ! is_public_url "$url"; then
    echo "🚫 PUBLIC_BASE_URL in wrangler.jsonc is \"$url\": a local or placeholder address."
    echo "   Approval links, artifact download links and the canary are built from it. Set it to the deployed origin"
    echo "   (https://<worker>.<your-subdomain>.workers.dev or your custom domain), then deploy again."
    exit 1
  fi
}

verify() {
  local base="${CANARY_BASE_URL:-$(public_base_url)}"
  if ! is_public_url "$base"; then
    echo "🚫 Canary target \"$base\" is a local or placeholder address; set PUBLIC_BASE_URL (or CANARY_BASE_URL) to the deployed origin."
    exit 1
  fi
  base="${base%/}"
  local health reject attempt
  for attempt in 1 2 3 4 5; do
    health=$(curl -s -o /dev/null -w "%{http_code}" "$base/health" || true)
    [ "$health" = "200" ] && break
    sleep 3
  done
  # A malformed approval token must be rejected with 400 by the edge router (proves routing + validation are live).
  reject=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$base/approvals/malformed-token" || true)
  if [ "$health" = "200" ] && [ "$reject" = "400" ]; then
    echo "✅ Production deployment verified at $base (health=$health, validation=$reject)"
  else
    echo "🚨 Canary failed at $base (health=$health, validation=$reject): roll back with: npx wrangler rollback"
    exit 1
  fi
}

case "${1:-}" in
  preflight) preflight ;;
  verify) verify ;;
  *) echo "usage: bash scripts/canary.sh preflight|verify" >&2; exit 2 ;;
esac
