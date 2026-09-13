const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const out =
  path.resolve(__dirname, "../docs/website-repositioning/evidence") + "/";
const base = process.env.WEBSITE_BASE_URL || "http://localhost:3107";
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [name, path] of [
    ["home", "/"],
    ["content", "/features/content"],
    ["pricing", "/pricing"],
    ["demo", "/demo?plan=grow"],
  ]) {
    const r = await page.goto(base + path, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: out + name + "-desktop.png",
      fullPage: true,
    });
    console.log(name, r.status(), await page.locator("h1").allTextContents());
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of [
    ["home", "/"],
    ["pricing", "/pricing"],
    ["saas", "/use-cases/saas"],
  ]) {
    await page.goto(base + path, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: out + name + "-mobile.png", fullPage: true });
    console.log(
      name,
      "mobile overflow",
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    );
  }
  fs.writeFileSync(
    out + "browser-errors.json",
    JSON.stringify(errors, null, 2),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
