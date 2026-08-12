import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const path of ["/features/ads", "/features", "/features/campaigns", "/"]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const fails = [];
  const jsErr = [];
  p.on("requestfailed", (r) => fails.push(r.url() + " :: " + (r.failure()?.errorText)));
  p.on("response", (r) => { if (r.status() >= 400) fails.push(r.url() + " :: HTTP " + r.status()); });
  p.on("pageerror", (e) => jsErr.push(e.message));
  await p.goto("http://localhost:3777" + path, { waitUntil: "load" });
  await p.waitForTimeout(2000);
  console.log("\n### " + path);
  console.log("  jsErrors:", jsErr.length ? jsErr : "none");
  console.log("  failedRequests:");
  for (const f of [...new Set(fails)]) console.log("    " + f);
  await ctx.close();
}
await b.close();
