// End-to-end check of sign-in, workspaces, roles and tokens against a real
// Postgres and a running dev server. Not part of `npm test` (it needs both).
//
//   1. sign up one step at a time (email, password, the six-digit code from
//      the dev log) and land signed in; the same email still carries the link
//   2. onboarding creates a workspace (named from the email domain)
//   3. invite a second person as Analyst; they accept, get no extra workspace,
//      and can't approve or invite
//   4. the owner enrols TOTP, signs out, and signs back in with a computed code
//   5. a session is revoked from Settings → Security and stops working
//   6. a stub backend verifies the proxied JWT against /api/auth/jwks
//      (iss, aud, sub, sid, org)
//   7. the 6th failed sign-in within a minute is rate limited
//
// Run (see docs/auth/web.md):
//   E2E_DEV_LOG=<dev server log> E2E_DATABASE_URL=postgres://… node test/e2e-auth.cjs
// The dev server must run with NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3199
// (this script serves the stub backend there) and no RESEND_API_KEY, so email
// links are printed to its log.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const WEB = path.join(__dirname, "..");
const { Pool } = require(path.join(WEB, "node_modules/pg"));

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const STUB_PORT = Number(process.env.E2E_STUB_PORT || 3199);
const LOG = process.env.E2E_DEV_LOG;
const DB = process.env.E2E_DATABASE_URL;
if (!LOG || !DB) {
  console.error("Set E2E_DEV_LOG (the dev server's log file) and E2E_DATABASE_URL.");
  process.exit(2);
}

const run = crypto.randomBytes(3).toString("hex");
const OWNER = { name: "Olive Owner", email: `owner-${run}@acme-foods.test`, password: `Owner-${crypto.randomBytes(12).toString("base64url")}` };
const ANALYST = { name: "Andy Analyst", email: `analyst-${run}@acme-foods.test`, password: `Analyst-${crypto.randomBytes(12).toString("base64url")}` };

const pool = new Pool({ connectionString: DB, max: 2 });
const runStart = new Date();
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    for (const [i, pg] of (globalThis.__pages || []).entries()) {
      console.log(`     page ${i}: ${pg.url()}`);
      await pg.screenshot({ path: path.join(process.env.E2E_SHOTS || "/tmp", `e2e-fail-${i}.png`) }).catch(() => undefined);
    }
    console.log(`FAIL ${name}\n     ${String(e && e.stack ? e.stack : e).split("\n").slice(0, 4).join("\n     ")}`);
    throw e;
  }
};

// ── email links from the dev log ────────────────────────────────────────────
const logStart = fs.statSync(LOG).size;
async function codeFor(email, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const text = fs.readFileSync(LOG).subarray(logStart).toString("utf8");
    const lines = text.split("\n").filter((l) => l.includes(`[auth-email] to=${email} `) && / code=\d{6} /.test(l));
    if (lines.length) return lines[lines.length - 1].match(/ code=(\d{6}) /)[1];
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no verification code for ${email}`);
}

async function linkFor(email, subjectRe, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const text = fs.readFileSync(LOG).subarray(logStart).toString("utf8");
    const lines = text.split("\n").filter((l) => l.includes(`[auth-email] to=${email} `) && subjectRe.test(l));
    if (lines.length) return lines[lines.length - 1].split(" link=")[1].trim();
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no email for ${email} matching ${subjectRe}`);
}

// ── TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ──────────────────────────────────
function base32(s) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += alpha.indexOf(c).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, t = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / 30)));
  const h = crypto.createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

// ── stub backend: verifies the JWT the proxy attaches ───────────────────────
const seen = [];
let jose;
async function startStub() {
  jose = await import(path.join(WEB, "node_modules/jose/dist/webapi/index.js"));
  const jwks = jose.createRemoteJWKSet(new URL(`${BASE}/api/auth/jwks`));
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    let claims;
    try {
      ({ payload: claims } = await jose.jwtVerify(token, jwks, { issuer: BASE, audience: "marketer-api", algorithms: ["RS256"] }));
    } catch {
      return send(401, { detail: "invalid token" });
    }
    seen.push({ path: req.url, claims });
    const now = new Date().toISOString();
    if (req.url.startsWith("/api/v1/_whoami")) return send(200, claims);
    if (req.url.startsWith("/api/v1/brand-kit")) return send(200, { brand_name: "Acme Foods", tagline: "", tone_of_voice: "", target_audience: "", banned_words: [], preferred_hashtags: [], color_hex: "" });
    if (req.url.startsWith("/api/v1/niches")) return send(200, []);
    if (req.url.startsWith("/api/v1/jobs")) return send(200, []);
    if (req.url.startsWith("/api/v1/workspace/inbox"))
      return send(200, { items: [{ id: "i1", kind: "video", ref_id: "v1", title: "Spring launch video", detail: "Ready to post", niche_id: null, created_at: now }], counts: { total: 1, video: 1, carousel: 0, ad_change: 0, required_action: 0 }, required_actions: [] });
    return send(404, { detail: "not in the stub" });
  });
  await new Promise((r) => server.listen(STUB_PORT, "127.0.0.1", r));
  return server;
}

// Sign-up is one thing at a time: email, then password, then the code step.
async function signUp(page, who, next) {
  await page.goto(`${BASE}/sign-up${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("Work email").fill(who.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Verification code").waitFor();
}

async function signIn(page, who) {
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('input[name="password"]').fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

(async () => {
  const stub = await startStub();
  const browser = await chromium.launch();
  const owner = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const op = await owner.newPage();
  globalThis.__pages = [op];
  let orgId;
  let ownerId;

  try {
    await step("1. sign up step by step, verify with the emailed code, land signed in", async () => {
      await signUp(op, OWNER);
      // One email carries both: the code for this page and the link as a fallback.
      const link = await linkFor(OWNER.email, /Verify your email/);
      assert.ok(link.startsWith(`${BASE}/api/auth/verify-email?token=`), "verification link");
      // A wrong code is refused on the page, without leaving the step.
      await op.getByLabel("Verification code").fill("000000");
      await op.getByText("That code didn't work").or(op.getByText("Too many attempts")).first().waitFor();
      await op.getByLabel("Verification code").fill(await codeFor(OWNER.email));
      await op.waitForURL(/\/onboarding|\/home/, { timeout: 60_000 });
      const u = await pool.query(`select id, "emailVerified" from auth."user" where email = $1`, [OWNER.email]);
      assert.equal(u.rows[0].emailVerified, true);
      ownerId = u.rows[0].id;
    });

    await step("2. onboarding creates a workspace named from the email domain", async () => {
      await op.goto(`${BASE}/onboarding`);
      await op.waitForLoadState("networkidle");
      const r = await pool.query(`select o.id, o.name, o."tenantId", m.role from auth.member m join auth.organization o on o.id = m."organizationId" where m."userId" = $1`, [ownerId]);
      assert.equal(r.rows.length, 1, "exactly one workspace");
      assert.equal(r.rows[0].name, "Acme Foods");
      assert.equal(r.rows[0].role, "owner");
      assert.equal(r.rows[0].tenantId, r.rows[0].id, "tenantId = organization id");
      orgId = r.rows[0].id;
      const s = await pool.query(`select "activeOrganizationId" from auth.session where "userId" = $1 order by "createdAt" desc limit 1`, [ownerId]);
      assert.equal(s.rows[0].activeOrganizationId, orgId);
    });

    await step("6. the stub backend verifies the proxied JWT (iss, aud, sub, sid, org)", async () => {
      await op.goto(`${BASE}/home`);
      await op.waitForLoadState("networkidle");
      const claims = await op.evaluate(async () => (await fetch("/api/proxy/api/v1/_whoami")).json());
      const sid = (await pool.query(`select id from auth.session where "userId" = $1 order by "createdAt" desc limit 1`, [ownerId])).rows[0].id;
      assert.equal(claims.iss, BASE);
      assert.equal(claims.aud, "marketer-api");
      assert.equal(claims.sub, ownerId);
      assert.equal(claims.sid, sid);
      assert.equal(claims.org, orgId);
      assert.equal(claims.email, OWNER.email);
      assert.ok(claims.exp - claims.iat <= 300, "five minutes");
      // The browser never gets a token: the plugin's endpoint is off, get-session carries none.
      const tok = await op.evaluate(async () => (await fetch("/api/auth/token")).status);
      assert.equal(tok, 404);
      const jwtHeader = await op.evaluate(async () => (await fetch("/api/auth/get-session")).headers.get("set-auth-jwt"));
      assert.equal(jwtHeader, null);
      // A forged token is refused by the backend.
      const forged = await fetch(`http://127.0.0.1:${STUB_PORT}/api/v1/_whoami`, { headers: { authorization: "Bearer eyJhbGciOiJub25lIn0.e30." } });
      assert.equal(forged.status, 401);
    });

    let analyst;
    let ap;
    await step("3. invite an Analyst, who accepts and can't approve or invite", async () => {
      await op.goto(`${BASE}/settings#team`);
      await op.getByRole("radio", { name: "Team" }).or(op.getByRole("tab", { name: "Team" })).first().click().catch(() => undefined);
      await op.getByRole("button", { name: "Invite people" }).click();
      await op.getByPlaceholder("name@company.com").fill(ANALYST.email);
      await op.getByLabel("Role for the invitation").selectOption("analyst");
      await op.getByRole("button", { name: "Send invitation" }).click();
      await op.getByText(`Invitation sent to ${ANALYST.email}.`).waitFor();
      const invite = await linkFor(ANALYST.email, /Join Acme Foods/);
      assert.match(invite, /\/accept-invitation\//);

      analyst = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      ap = await analyst.newPage();
      globalThis.__pages.push(ap);
      await ap.goto(invite);
      await ap.getByRole("link", { name: "Create an account" }).click();
      await ap.waitForURL(/\/sign-up\?next=/);
      await ap.getByLabel("Work email").fill(ANALYST.email);
      await ap.getByRole("button", { name: "Continue" }).click();
      await ap.getByLabel("Password", { exact: true }).fill(ANALYST.password);
      await ap.getByRole("button", { name: "Create account" }).click();
      await ap.getByLabel("Verification code").waitFor();
      // The analyst uses the link fallback instead of the code.
      await ap.goto(await linkFor(ANALYST.email, /Verify your email/));
      await ap.waitForURL(/\/sign-in\?verified=1/);
      await signIn(ap, ANALYST);
      await ap.waitForURL(/\/accept-invitation\//, { timeout: 60_000 });
      await ap.getByRole("button", { name: "Join Acme Foods" }).click();
      await ap.waitForURL(/\/home/, { timeout: 60_000 });

      const a = await pool.query(`select m.role, m."organizationId" from auth.member m join auth."user" u on u.id = m."userId" where u.email = $1`, [ANALYST.email]);
      assert.equal(a.rows.length, 1, "no extra workspace for an invited person");
      assert.equal(a.rows[0].role, "analyst");
      assert.equal(a.rows[0].organizationId, orgId);

      // Can't approve: the approval card shows the reason, not the buttons.
      await ap.goto(`${BASE}/inbox`);
      await ap.getByTestId("approval-blocked").first().waitFor({ timeout: 30_000 });
      assert.equal(await ap.getByRole("button", { name: "Approve & Run" }).count(), 0);
      // Can't invite: the UI says so, and the server refuses.
      await ap.goto(`${BASE}/settings#team`);
      await ap.getByText("Owners and admins invite people.").waitFor();
      const status = await ap.evaluate(async (orgId) => (await fetch("/api/auth/organization/invite-member", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@acme-foods.test", role: "analyst", organizationId: orgId }) })).status, orgId);
      assert.ok(status === 403 || status === 401, `invite as analyst → ${status}`);
      // Can't change their own role, or anyone's.
      const self = await ap.evaluate(async (orgId) => {
        const r = await fetch("/api/auth/organization/get-active-member");
        const me = await r.json();
        return (await fetch("/api/auth/organization/update-member-role", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: me.id, role: "owner", organizationId: orgId }) })).status;
      }, orgId);
      assert.ok(self >= 400 && self < 500, `self promotion → ${self}`);
      // Nothing can hand out Better Auth's default "member" role, or the agent role.
      for (const role of ["member", "agent"]) {
        const inv = await op.evaluate(async ([orgId, role]) => (await fetch("/api/auth/organization/invite-member", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `nobody-${role}@acme-foods.test`, role, organizationId: orgId }) })).status, [orgId, role]);
        assert.ok(inv >= 400 && inv < 500, `invite as ${role} → ${inv}`);
        const analystMember = (await pool.query(`select m.id from auth.member m join auth."user" u on u.id = m."userId" where u.email = $1`, [ANALYST.email])).rows[0].id;
        const chg = await op.evaluate(async ([orgId, role, memberId]) => (await fetch("/api/auth/organization/update-member-role", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId, role, organizationId: orgId }) })).status, [orgId, role, analystMember]);
        assert.ok(chg >= 400 && chg < 500, `change to ${role} → ${chg}`);
      }
      assert.equal((await pool.query(`select count(*)::int as n from auth.member where role not in ('owner','admin','marketer','analyst','billing')`)).rows[0].n, 0);
      // Their agent token would carry the analyst role (here the harness isn't configured, so: not forbidden).
      const agent = await ap.evaluate(async () => (await fetch("/api/agent/session")).status);
      assert.equal(agent, 200);
    });

    await step("4. the owner enrols TOTP, signs out, and signs back in with a computed code", async () => {
      await op.goto(`${BASE}/home`);
      await op.goto(`${BASE}/settings#security`);
      await op.getByRole("button", { name: "Set up" }).click();
      await op.getByLabel("Confirm your password").fill(OWNER.password);
      await op.getByRole("button", { name: "Continue" }).click();
      const secret = (await op.getByTestId("totp-secret").textContent()).trim();
      assert.equal((await op.getByTestId("backup-codes").locator("li").count()) >= 8, true);
      await op.getByLabel("Code from the app").fill(totp(secret));
      await op.getByRole("button", { name: "Turn on two-factor" }).click();
      await op.getByText("On", { exact: true }).waitFor();
      const u = await pool.query(`select "twoFactorEnabled" from auth."user" where id = $1`, [ownerId]);
      assert.equal(u.rows[0].twoFactorEnabled, true);

      await op.locator('[data-testid="user-menu"]:visible').click();
      await op.getByRole("option", { name: "Sign out" }).click();
      await op.waitForURL(/\/sign-in/);
      await signIn(op, OWNER);
      // The second factor is the next step on the same page.
      await op.getByLabel("Code from your authenticator app").waitFor();
      assert.match(op.url(), /\/sign-in/);
      // A fresh code in a fresh 30 s window, so it can't be the enrolment code.
      const wait = 30_000 - (Date.now() % 30_000) + 500;
      await new Promise((r) => setTimeout(r, wait));
      // Six digits submit by themselves.
      await op.getByLabel("Code from your authenticator app").fill(totp(secret));
      await op.waitForURL(/\/home/, { timeout: 60_000 });
    });

    await step("5. a revoked session stops working", async () => {
      const second = await browser.newContext();
      const sp = await second.newPage();
      await sp.goto(`${BASE}/sign-in`);
      await signIn(sp, ANALYST);
      await sp.waitForURL(/\/home/, { timeout: 60_000 });
      await ap.goto(`${BASE}/home`);
      await ap.goto(`${BASE}/settings#security`);
      const revoke = ap.getByTestId("revoke-session");
      await revoke.first().waitFor();
      assert.equal(await revoke.count(), 1, "one other session");
      await revoke.first().click();
      await ap.waitForFunction(() => document.querySelectorAll('[data-testid="revoke-session"]').length === 0);
      await sp.goto(`${BASE}/settings`);
      await sp.waitForURL(/\/sign-in/);
      const st = await sp.evaluate(async () => (await fetch("/api/proxy/api/v1/_whoami")).status);
      assert.equal(st, 401);
      await second.close();
    });

    await step("7. the 6th failed sign-in within a minute is rate limited", async () => {
      // A dedicated client address, so this bucket starts empty (see the IP note in docs/auth/web.md).
      const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
      const codes = [];
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip }, body: JSON.stringify({ email: OWNER.email, password: "not-the-password-0000" }) });
        codes.push(r.status);
      }
      assert.deepEqual(codes.slice(0, 5), [401, 401, 401, 401, 401]);
      assert.equal(codes[5], 429);
    });

    await step("security log has every event", async () => {
    // verify-email has no session yet, so its rows carry no actor: look at this run's window.
    const audit = await pool.query(`select action, outcome from public.security_audit_log where at >= $1`, [runStart]);
    const actions = new Set(audit.rows.map((r) => `${r.action}:${r.outcome}`));
    for (const a of ["auth.sign_up:success", "auth.sign_in:success", "auth.sign_in:denied", "workspace.created:success", "member.invited:success", "invitation.accepted:success", "auth.two_factor_enabled:success", "auth.sign_out:success", "session.revoked:success"]) assert.ok(actions.has(a), `audit has ${a}`);
    for (const a of ["auth.email_verified:success"]) assert.ok(actions.has(a), `audit has ${a}`);
    });
  } finally {
    await browser.close();
    stub.close();
    await pool.end();
  }
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed`);
})().catch(() => process.exit(1));
