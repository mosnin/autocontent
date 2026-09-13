const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const out = path.resolve(__dirname, "../docs/website-repositioning/evidence");
  const base = process.env.WEBSITE_BASE_URL || "http://localhost:3107";
  await page.goto(base + "/pricing", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  const medium = await page
    .locator("header")
    .first()
    .evaluate((h) => {
      const links = [...h.querySelectorAll("a,button")].filter(
        (x) =>
          x.getBoundingClientRect().width &&
          x.getBoundingClientRect().height &&
          getComputedStyle(x).visibility !== "hidden",
      );
      return links.map((x) => ({
        text: x.textContent.trim() || x.getAttribute("aria-label"),
        x: x.getBoundingClientRect().x,
        right: x.getBoundingClientRect().right,
      }));
    });
  await page.screenshot({ path: path.join(out, "pricing-1024.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  const wide = await page
    .locator("header")
    .first()
    .evaluate((h) =>
      [...h.querySelectorAll("a,button")]
        .filter(
          (x) =>
            x.getBoundingClientRect().width &&
            x.getBoundingClientRect().height &&
            getComputedStyle(x).visibility !== "hidden",
        )
        .map((x) => ({
          text: x.textContent.trim() || x.getAttribute("aria-label"),
          x: x.getBoundingClientRect().x,
          right: x.getBoundingClientRect().right,
        })),
    );
  const overlaps = (list) =>
    list.some((a, i) =>
      list.some(
        (b, j) => i < j && Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1,
      ),
    );
  if (overlaps(medium) || overlaps(wide))
    throw new Error("Navigation controls overlap");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(base + "/features/content", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { level: 1 }).waitFor();
  const narrow = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    heading: getComputedStyle(document.querySelector("h1")).fontSize,
  }));
  await page.screenshot({ path: path.join(out, "content-320.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector("h1")).opacity === "1",
    {},
    { timeout: 15000 },
  );
  await page.screenshot({ path: path.join(out, "home-motion.png") });
  await page.locator("#overview").scrollIntoViewIfNeeded();
  await page
    .getByText("Videos that explain your product", { exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(out, "features-motion.png") });
  const normal = {
    headlineVisible: await page.locator("h1").count(),
    featuresVisible: await page
      .getByText("Videos that explain your product", { exact: true })
      .isVisible(),
  };
  fs.writeFileSync(
    path.join(out, "detail-checks.json"),
    JSON.stringify({ medium, wide, narrow, normal }, null, 2),
  );
  console.log({ medium, wide, narrow, normal });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
