#!/usr/bin/env node
// Playwright smoke suite: proves the marketer.sh web app actually serves.
//
// Builds the Next.js app once, starts it on a free local port with
// placeholder Clerk env, then:
//   - hits every public marketing page and asserts 200 + the expected
//     h1 + no hydration-error signal, with a screenshot as evidence.
//   - hits every gated app route and asserts it never 500s: it either
//     serves the page (routes middleware doesn't protect) or the auth
//     gate blocks it (redirect or Clerk's signed-out block), which is
//     also a pass.
//
// Uses the environment's GLOBAL Playwright install (NODE_PATH points at
// it) and the pre-fetched Chromium binary; nothing is added to
// package.json and no browsers are downloaded. See e2e/README.md.
//
// Usage: node e2e/smoke.mjs [--skip-build] [--keep-alive]

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

// Node's ESM `import` resolver ignores NODE_PATH (it is a CommonJS-only
// mechanism), so the global Playwright install (this repo does not, and
// must not, depend on it via package.json) is loaded through a CJS
// `require` instead, which does honor NODE_PATH.
const require = createRequire(import.meta.url);
const { chromium, request: pwRequest } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "web");
const SHOTS_DIR = path.join(__dirname, "shots");
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium";

// Same placeholder Clerk publishable key .github/workflows/ci.yml uses for
// the compile-only build gate. It decodes to a non-existent Frontend API
// domain (base64 "clerk.clerk.dev$"), which is enough for Clerk's SDK to
// initialize without a real account. There is no real secret key available
// in this environment either, so a syntactically valid but inert one is
// supplied purely so clerkMiddleware() does not throw at startup.
const CLERK_PUBLISHABLE_KEY = "pk_test_Y2xlcmsuY2xlcmsuZGV2JA";
const CLERK_SECRET_KEY =
  "sk_test_0000000000000000000000000000000000000000";

const SKIP_BUILD = process.argv.includes("--skip-build");
const KEEP_ALIVE = process.argv.includes("--keep-alive");

const MARKETING_PAGES = [
  { path: "/", h1: "Marketing that runs itself." },
  { path: "/pricing", h1: "Pay for what ships. Nothing else." },
  { path: "/features", h1: "Everything the campaign needs. One system." },
  { path: "/use-cases", h1: "Built for how you actually market." },
  { path: "/company", h1: "Marketing should compound, not consume you." },
  { path: "/resources", h1: "Learn it. Script it. Ship it." },
  { path: "/legal/terms", h1: "Terms of Service" },
];

// These are behind web/middleware.ts's route matcher (dashboard, press,
// ads) or not (studio, library); see e2e/README.md for what that split
// means for the asserted outcome of each.
const APP_ROUTES = ["/dashboard", "/press", "/studio", "/library", "/ads"];

const HYDRATION_ERROR_PATTERNS = [
  /hydration failed/i,
  /error while hydrating/i,
  /text content does not match server-rendered html/i,
  /there was an error while hydrating/i,
  /minified react error #4(1[89]|2[0-9])/i, // #418/#419/#421-#425: hydration mismatches
  /application error: a client-side exception has occurred/i,
];

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? ": " + detail : ""}`);
}

function killServer(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Group already gone, or platform doesn't support negative-pid kill;
    // fall back to killing just the direct child.
    try {
      child.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
    child.on("error", reject);
  });
}

async function buildWebApp() {
  console.log("== Building web app (next build --no-lint) ==");
  await run("npx", ["next", "build", "--no-lint"], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_PUBLISHABLE_KEY,
    },
  });
}

async function startWebApp(port) {
  console.log(`== Starting web app on port ${port} ==`);
  // `npx next start` is really npx -> sh -c -> next-server: three
  // processes. detached:true makes the child the leader of a new process
  // group, so killing the whole group (negative pid) on shutdown reliably
  // takes the real server with it instead of leaving it orphaned; a
  // plain SIGTERM to just the npx wrapper does not cascade to it.
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_PUBLISHABLE_KEY,
      CLERK_SECRET_KEY,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let out = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (out += d.toString()));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (/Ready in/i.test(out)) break;
    if (child.exitCode !== null) {
      throw new Error(`next start exited early (${child.exitCode}):\n${out}`);
    }
    await sleep(300);
  }
  // Confirm it actually answers before handing back control.
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(base + "/robots.txt");
      if (res.status < 500) return { child, base };
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error(`web app never answered on ${base}\n${out}`);
}

async function checkMarketingPage(page, base, { path: p, h1 }) {
  const name = `marketing ${p}`;
  const consoleErrors = [];
  const pageErrors = [];
  const onConsole = (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  };
  const onError = (e) => pageErrors.push(e.message);
  page.on("console", onConsole);
  page.on("pageerror", onError);

  try {
    const resp = await page.goto(base + p, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    const status = resp ? resp.status() : null;
    if (status !== 200) {
      record(name, false, `expected 200, got ${status}`);
      return;
    }

    await page.waitForTimeout(500); // let staged reveal animations settle

    const actualH1 = await page
      .locator("h1")
      .first()
      .innerText()
      .catch(() => null);
    const h1Ok = actualH1 && actualH1.replace(/\s+/g, " ").trim() === h1;

    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
    const hydrationHit = HYDRATION_ERROR_PATTERNS.find(
      (re) => re.test(bodyText) || consoleErrors.some((c) => re.test(c)),
    );

    const slug = p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "-");
    await page.screenshot({
      path: path.join(SHOTS_DIR, `marketing-${slug}.png`),
      fullPage: false,
    });

    if (!h1Ok) {
      record(name, false, `h1 mismatch: expected "${h1}", got "${actualH1}"`);
    } else if (hydrationHit) {
      record(name, false, `hydration error signal: ${hydrationHit}`);
    } else if (pageErrors.length) {
      record(name, false, `page error: ${pageErrors[0]}`);
    } else {
      record(name, true, `200, h1 ok, screenshot saved`);
    }
  } catch (err) {
    record(name, false, err.message.split("\n")[0]);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onError);
  }
}

async function checkAppRoute(apiCtx, browser, base, p) {
  const name = `app route ${p}`;
  // A plain HTTP GET (no client JS) reliably reports the top-level status
  // that web/middleware.ts's clerkMiddleware() produces. A full browser
  // navigation to a route the auth gate blocks tries to follow Clerk's
  // cross-origin "dev browser" handshake, which cannot complete against
  // the placeholder key's non-existent Frontend API domain and just hangs,
  // an artifact of testing without a real Clerk instance, not a
  // reflection of app behavior, so we don't let it fail the check.
  let status;
  let clerkAuthStatus;
  try {
    const resp = await apiCtx.get(base + p, {
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: 15_000,
    });
    status = resp.status();
    clerkAuthStatus = resp.headers()["x-clerk-auth-status"];
  } catch (err) {
    record(name, false, `request failed: ${err.message.split("\n")[0]}`);
    return;
  }

  if (status >= 500) {
    record(name, false, `server error ${status}`);
    return;
  }

  const is2xx = status >= 200 && status < 300;
  const is3xx = status >= 300 && status < 400;
  const blockedByAuthGate = clerkAuthStatus === "signed-out";

  if (!is2xx && !is3xx && !blockedByAuthGate) {
    record(name, false, `unexpected status ${status}, no auth-gate signal`);
    return;
  }

  const outcome = is2xx
    ? "served the page (not middleware-protected)"
    : is3xx
      ? "redirected (auth gate)"
      : `auth gate blocked it (status ${status}, x-clerk-auth-status=signed-out)`;

  // Full render + screenshot only for routes that actually serve a page:
  // gated routes never reach a paintable DOM in this keyless setup (see
  // above), so a browser screenshot there would just be noise.
  if (is2xx) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    try {
      await page.goto(base + p, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(500);
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
      const hydrationHit = HYDRATION_ERROR_PATTERNS.find((re) => re.test(bodyText));
      const slug = p.replace(/^\//, "").replace(/\//g, "-");
      await page.screenshot({ path: path.join(SHOTS_DIR, `app-${slug}.png`) });
      if (hydrationHit) {
        record(name, false, `hydration error signal: ${hydrationHit}`);
        await page.close();
        return;
      }
      if (pageErrors.length) {
        record(name, false, `page error: ${pageErrors[0]}`);
        await page.close();
        return;
      }
    } catch (err) {
      // Never 500 is the actual assertion; a slow/failed full render on a
      // route middleware doesn't protect is noted but not fatal.
      console.log(`  (screenshot skipped for ${p}: ${err.message.split("\n")[0]})`);
    }
    await page.close();
  }

  record(name, true, `status ${status}: ${outcome}`);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  if (!SKIP_BUILD) {
    await buildWebApp();
  } else {
    console.log("== Skipping build (--skip-build) ==");
  }

  const port = await freePort();
  const { child: serverProcess, base } = await startWebApp(port);

  let exitCode = 0;
  try {
    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
    const apiCtx = await pwRequest.newContext();
    try {
      const page = await browser.newPage();
      for (const spec of MARKETING_PAGES) {
        await checkMarketingPage(page, base, spec);
      }
      await page.close();

      for (const p of APP_ROUTES) {
        await checkAppRoute(apiCtx, browser, base, p);
      }
    } finally {
      await apiCtx.dispose();
      await browser.close();
    }

    console.log("\n== Results ==");
    const failed = results.filter((r) => !r.pass);
    for (const r of results) {
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    }
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length) exitCode = 1;
  } finally {
    if (KEEP_ALIVE) {
      console.log(`\nweb app left running at ${base} (--keep-alive). Ctrl-C to stop.`);
    } else {
      killServer(serverProcess);
      // Give it a beat to release the port before the process exits.
      await sleep(300);
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("smoke suite crashed:", err);
  process.exit(1);
});
