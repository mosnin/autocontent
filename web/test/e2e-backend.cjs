// Web (Better Auth) -> real backend (FastAPI) integration test.
//
// Proves the two halves agree: the backend accepts the JWT the web app mints,
// scopes data to the workspace tenant, enforces roles from the catalog, writes
// denials to security_audit_log, and drops a removed member within its 15 s
// identity cache.
//
// Setup (one Postgres with every migration applied):
//   backend: MARKETER_DATABASE_URL=… MARKETER_AUTH_ISSUER=http://localhost:3100 \
//            uvicorn backend.main:create_app --factory --port 8399
//   web:     AUTH_DATABASE_URL=… BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 \
//            NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8399 npx next dev -p 3100 > web.log
//   run:     cd web && node test/e2e-backend.cjs web.log postgres://…
// Sign-up is rate limited (3 a minute per IP): wait a minute between runs.
const { chromium } = require("playwright");
const fs = require("fs");
const { Pool } = require(process.cwd() + "/node_modules/pg");
const BASE = "http://localhost:3100";
const LOG = process.argv[2];
const pool = new Pool({ connectionString: process.argv[3] });
const logStart = fs.statSync(LOG).size;
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`); };
async function linkFor(email) {
  for (let i = 0; i < 70; i++) {
    const t = fs.readFileSync(LOG).subarray(logStart).toString("utf8");
    const l = t.split("\n").filter((x) => x.includes(`[auth-email] to=${email} `) && /Verify your email/.test(x));
    if (l.length) return l[l.length - 1].split(" link=")[1].trim();
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("no verification email for " + email);
}
async function signUpVerify(page, who) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByLabel("Your name").fill(who.name);
  await page.getByLabel("Work email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify-email/);
  await page.goto(await linkFor(who.email));
  await page.waitForURL(/\/sign-in\?verified=1/);
}
async function signIn(page, who) {
  await page.getByLabel("Email").fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
const call = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch(`/api/proxy${p}`, { method: m, headers: b ? { "content-type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}, [method, path, body]);

(async () => {
  const stamp = Date.now();
  const OWNER = { name: "Olive Owner", email: `olive.${stamp}@integ-foods.test`, password: "correct-horse-battery-41" };
  const ANALYST = { name: "Andy Analyst", email: `andy.${stamp}@integ-foods.test`, password: "correct-horse-battery-42" };
  const browser = await chromium.launch();
  try {
    const op = await (await browser.newContext()).newPage();
    await signUpVerify(op, OWNER);
    await signIn(op, OWNER);
    await op.waitForURL(/\/onboarding|\/home/, { timeout: 60000 });
    await op.goto(`${BASE}/onboarding`); await op.waitForLoadState("networkidle");
    const org = (await pool.query(`select o.id, o."tenantId" from auth.member m join auth.organization o on o.id=m."organizationId" join auth."user" u on u.id=m."userId" where u.email=$1`, [OWNER.email])).rows[0];
    check("owner gets a workspace", !!org);

    const me = await call(op, "GET", "/api/v1/users/me");
    check("owner: real backend accepts the web-minted JWT", me.status === 200, `status ${me.status}`);
    check("owner: backend scopes data to the workspace tenant", me.body && me.body.id === org.tenantId, `id ${me.body && me.body.id}`);
    const tok = await call(op, "POST", "/api/v1/tokens", { name: "integ" });
    check("owner: may create an API token (api_token:create)", tok.status === 200 || tok.status === 201, `status ${tok.status}`);

    const ap = await (await browser.newContext()).newPage();
    await signUpVerify(ap, ANALYST);
    const aid = (await pool.query(`select id from auth."user" where email=$1`, [ANALYST.email])).rows[0].id;
    await pool.query(`insert into auth.member (id, "organizationId", "userId", role, "createdAt") values ($1,$2,$3,'analyst', now())`, [`integ_${stamp}`, org.id, aid]);
    await signIn(ap, ANALYST);
    await ap.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 60000 });
    await ap.waitForLoadState("networkidle");
    const ame = await call(ap, "GET", "/api/v1/users/me");
    check("analyst: same workspace, read allowed", ame.status === 200 && ame.body && ame.body.id === org.tenantId, `status ${ame.status}`);
    const niches = await call(ap, "GET", "/api/v1/niches");
    check("analyst: playbook:read allowed", niches.status === 200, `status ${niches.status}`);
    const atok = await call(ap, "POST", "/api/v1/tokens", { name: "nope" });
    check("analyst: api_token:create refused with 403", atok.status === 403 && atok.body && atok.body.permission === "api_token:create", `status ${atok.status} ${JSON.stringify(atok.body)}`);
    await new Promise((r) => setTimeout(r, 1500));
    const den = await pool.query(`select count(*)::int n from security_audit_log where action='permission.denied' and actor_id=$1`, [aid]);
    check("denial written to security_audit_log", den.rows[0].n >= 1, `rows ${den.rows[0].n}`);

    await pool.query(`delete from auth.member where "userId"=$1 and "organizationId"=$2`, [aid, org.id]);
    await new Promise((r) => setTimeout(r, 16500));
    const gone = await call(ap, "GET", "/api/v1/users/me");
    check("removed member is refused within the 15 s cache window", gone.status === 401 || gone.status === 403, `status ${gone.status}`);
  } catch (e) {
    check("run", false, String(e).slice(0, 300));
  } finally {
    await browser.close(); await pool.end();
    console.log(`${results.filter(Boolean).length}/${results.length} passed`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
