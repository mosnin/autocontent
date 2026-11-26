#!/usr/bin/env node
// replay-dlq.mjs: inspect, replay or purge the events dead-letter queue of ONE tenant.
//
// Dead letters are parked in R2 by the DLQ consumer (src/background/dlq.ts). This script
// calls the operator routes with a session token for that tenant (a role whose catalog permissions include security:manage: owner or admin; `pnpm seed:dev --token` mints an owner token):
//
//   AGENT_BASE_URL=https://agents.example.com AGENT_OPERATOR_TOKEN=... pnpm dlq:replay            # list
//   ... pnpm dlq:replay --replay                  # re-enqueue every dead letter
//   ... pnpm dlq:replay --replay --key dlq/...    # re-enqueue one (repeat --key)
//   ... pnpm dlq:replay --purge --key dlq/...     # drop without replaying
//
// Locally: AGENT_BASE_URL defaults to http://localhost:5173 and `pnpm seed:dev --token`
// prints an operator token for the dev tenant.
const args = process.argv.slice(2).filter((a) => a !== "--");
const keys = args.flatMap((a, i) => (a === "--key" && args[i + 1] ? [args[i + 1]] : []));
const action = args.includes("--purge") ? "purge" : args.includes("--replay") ? "replay" : "list";
const base = (process.env.AGENT_BASE_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const token = process.env.AGENT_OPERATOR_TOKEN;
if (!token) {
  console.error("✖ Set AGENT_OPERATOR_TOKEN to an admin/operator session token for the tenant (locally: pnpm seed:dev --token).");
  process.exit(1);
}
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const res =
  action === "list"
    ? await fetch(`${base}/api/dlq`, { headers })
    : await fetch(`${base}/api/dlq/${action}`, { method: "POST", headers, body: JSON.stringify(keys.length ? { keys } : {}) });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`✖ ${res.status}`, body);
  process.exit(1);
}
if (action === "list") {
  console.log(`${body.count} dead letter(s) for tenant ${body.tenantId}`);
  for (const letter of body.letters ?? []) console.log(`- ${letter.key}  attempts=${letter.attempts}  dead=${new Date(letter.deadAt).toISOString()}`);
} else {
  console.log(JSON.stringify(body, null, 2));
}
