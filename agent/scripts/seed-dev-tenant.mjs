#!/usr/bin/env node
// seed-dev-tenant.mjs: make a fresh LOCAL install usable (R-APP-08).
//
// Unknown tenants fall back to the secure freemium defaults (5 turns, $0.15 per
// conversation, every feature flag off), so a brand-new app stops chatting almost
// immediately. This script writes a generous development TenantConfig into the
// LOCAL TENANT_CONFIG KV namespace (the same .wrangler/state that `pnpm dev`
// uses) and can print a matching development session token.
//
//   pnpm seed:dev                          # seed tenant "dev_tenant"
//   pnpm seed:dev --tenant acme --token    # seed "acme" and print a token for dev_user
//   pnpm seed:dev --print                  # only print the config JSON
//
// It never touches production: --remote is refused. Real tenants get their
// limits from your SaaS via the signed PUT /internal/tenants/:tenantId/config.
// Platform ceilings in agent-starter.config.ts (budget) still apply on top.
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEV_TENANT_ID = "dev_tenant";
export const DEV_USER_ID = "dev_user";
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** A generous TenantConfig for local development (matches TenantConfigSchema in @agent-starter/core). */
export function devTenantConfig(options = {}) {
  return {
    tier: "enterprise",
    maxTurnsPerSession: 200,
    maxBudgetUsd: 10,
    // The hook enforces profiles: "first-line" alone would pin every conversation to the cheap model.
    allowedModelProfiles: ["frontier", "first-line"],
    deniedTools: [],
    rateLimit: { eventsPerMinute: 600, burst: 120 },
    autonomy: { confidenceThreshold: 0.85, maxAutonomousTier: "MEDIUM" },
    features: {
      autonomousBrowserUse: true,
      multiAgentGroupChat: true,
      computerUse: true,
      codeExecution: true,
      longTermMemory: true,
      voice: true,
      // Real email only when you opt in (--email) and SENDRAVEN_API_KEY is set.
      outboundEmail: options.email === true,
    },
  };
}

/** Parse a .dev.vars file (KEY=value or KEY="value" lines). */
export function parseDevVars(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    vars[match[1]] = value;
  }
  return vars;
}

const b64url = (input) => Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The workspace roles a dev token gets by default: the web app mints one catalog role per token. */
export const DEV_ROLES = ["owner"];

/**
 * The permissions the catalog (docs/auth/permissions.json) gives these roles, as `resource:action` scopes, the way
 * the web app mints them. Unknown roles give nothing; a missing catalog file gives nothing (fail closed).
 */
export function catalogScopes(roles, catalogPath = new URL("../../docs/auth/permissions.json", import.meta.url)) {
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch {
    return [];
  }
  const all = Object.entries(catalog.resources ?? {}).flatMap(([resource, actions]) => actions.map((action) => `${resource}:${action}`));
  const out = new Set();
  for (const role of roles) {
    const entry = Object.prototype.hasOwnProperty.call(catalog.roles ?? {}, role) ? catalog.roles[role] : undefined;
    if (!entry || entry.assignable !== true) continue;
    if (entry.grants === "*") all.forEach((p) => out.add(p));
    else for (const [resource, actions] of Object.entries(entry.grants ?? {})) for (const action of actions) out.add(`${resource}:${action}`);
  }
  return all.filter((p) => out.has(p));
}

/** Same format as createSessionToken() in @agent-starter/core: base64url(claims).base64url(HMAC-SHA256). */
export function mintDevSessionToken(secret, { tenantId = DEV_TENANT_ID, userId = DEV_USER_ID, roles = DEV_ROLES, scopes = catalogScopes(roles), ttlSeconds = 12 * 3600, now = Date.now() } = {}) {
  if (!secret) throw new Error("SESSION_SIGNING_SECRET is empty: set it in .dev.vars first.");
  const iat = Math.floor(now / 1000);
  const body = b64url(JSON.stringify({ sub: userId, tid: tenantId, roles, scopes, iat, exp: iat + ttlSeconds, env: "development" }));
  return `${body}.${b64url(createHmac("sha256", secret).update(body).digest())}`;
}

export function parseArgs(argv) {
  const args = { tenant: DEV_TENANT_ID, user: DEV_USER_ID, roles: DEV_ROLES, token: false, print: false, email: false, remote: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--tenant") args.tenant = next();
    else if (arg === "--user") args.user = next();
    else if (arg === "--roles") args.roles = next().split(",").map((r) => r.trim()).filter(Boolean);
    else if (arg === "--token") args.token = true;
    else if (arg === "--print") args.print = true;
    else if (arg === "--email") args.email = true;
    else if (arg === "--remote" || arg === "--env" || arg === "--production") args.remote = true;
    else if (arg !== "--") throw new Error(`Unknown argument ${arg}`);
  }
  if (!TENANT_ID_PATTERN.test(args.tenant)) throw new Error(`Invalid tenant id "${args.tenant}"`);
  return args;
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv);
  if (args.remote) {
    throw new Error("seed-dev-tenant only writes LOCAL development KV. Configure real tenants from your SaaS with the signed PUT /internal/tenants/:tenantId/config route.");
  }
  const config = devTenantConfig({ email: args.email });
  const json = JSON.stringify(config);
  if (args.print) {
    console.log(JSON.stringify(config, null, 2));
    return { config };
  }
  const key = `config:${args.tenant}`;
  execFileSync("npx", ["wrangler", "kv", "key", "put", "--binding", "TENANT_CONFIG", "--local", key, json], { cwd, stdio: "inherit", shell: process.platform === "win32" });
  console.log(`\n✔ Seeded local tenant "${args.tenant}" (KV ${key}): ${config.maxTurnsPerSession} turns / $${config.maxBudgetUsd} per conversation, all module features on.`);
  console.log("  Restart `pnpm dev` (or wait ~60 s) so cached tenant configs refresh.");
  let token;
  if (args.token) {
    const devVarsPath = resolve(cwd, ".dev.vars");
    const vars = existsSync(devVarsPath) ? parseDevVars(readFileSync(devVarsPath, "utf8")) : {};
    token = mintDevSessionToken(vars.SESSION_SIGNING_SECRET ?? "", { tenantId: args.tenant, userId: args.user, roles: args.roles });
    console.log(`\nDevelopment session token (tenant ${args.tenant}, user ${args.user}, roles ${args.roles.join(",")}, 12 h):\n${token}`);
  }
  return { config, token };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
