const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const fs = require("fs");
const path = require("path");
const out = path.resolve(__dirname, "../docs/website-repositioning/evidence");
const base = process.env.WEBSITE_BASE_URL || "http://localhost:3107";
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const results = [];
  const routes = [
    ...new Set([
      "/demo?plan=grow",
      ...fs
        .readdirSync(path.join(__dirname, "app/(marketing)"), {
          recursive: true,
        })
        .filter((f) => f.endsWith("page.tsx"))
        .map((f) => "/" + f.split(path.sep).slice(0, -1).join("/"))
        .filter((r) => r !== "/company"),
    ]),
  ];
  for (const route of routes) {
    const r = await page.goto(base + route, { waitUntil: "domcontentloaded" });
    await page
      .locator("h1")
      .waitFor({ state: "attached" })
      .catch(() => console.log("Missing heading", route));
    const entry = {
      route,
      status: r.status(),
      h1: await page.locator("h1").count(),
      title: await page.title(),
      description: await page
        .locator('meta[name="description"]')
        .getAttribute("content"),
      canonical: await page
        .locator('link[rel="canonical"]')
        .getAttribute("href"),
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      badImages: await page
        .locator("img")
        .evaluateAll((imgs) =>
          imgs
            .filter((i) => i.complete && i.naturalWidth === 0)
            .map((i) => i.src),
        ),
    };
    results.push(entry);
  }
  fs.writeFileSync(
    path.join(out, "route-checks.json"),
    JSON.stringify(results, null, 2),
  );
  console.log("Routes checked:", results.length);
  await page.goto(base + "/pricing", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector("header")).opacity === "1",
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000); // Allow inherited entrance transitions to settle before measuring contrast.
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  fs.writeFileSync(
    path.join(out, "pricing-accessibility.json"),
    JSON.stringify(accessibility.violations, null, 2),
  );
  console.log(
    "Pricing axe violations:",
    accessibility.violations.map((v) => [v.id, v.nodes.length]),
  );
  const additionalAccessibility = [];
  for (const route of [
    "/features/content",
    "/demo?plan=grow",
    "/resources/guides/content-brief",
  ]) {
    await page.goto(base + route, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector("header")).opacity === "1",
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000); // Measure the stable rendered state, not an entrance-fade frame.
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    additionalAccessibility.push({ route, violations: scan.violations });
  }
  fs.writeFileSync(
    path.join(out, "additional-accessibility.json"),
    JSON.stringify(additionalAccessibility, null, 2),
  );
  await page.goto(base + "/pricing", { waitUntil: "domcontentloaded" });
  const menus = [];
  for (const label of ["Product", "Solutions", "Resources", "Company"]) {
    const btn = page.getByRole("button", { name: label, exact: true });
    await btn.focus();
    await page.keyboard.press("Enter");
    menus.push({ label, expanded: await btn.getAttribute("aria-expanded") });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    menus[menus.length - 1].closed =
      (await btn.getAttribute("aria-expanded")) === "false";
    menus[menus.length - 1].focusReturned = await btn.evaluate(
      (e) => document.activeElement === e,
    );
  }
  await page.goto(base + "/demo?plan=grow", { waitUntil: "domcontentloaded" });
  const form = {
    reason: await page.getByLabel("What is this about?").inputValue(),
    message: await page.locator("textarea").inputValue(),
    button: await page
      .getByRole("button", { name: "Open email draft" })
      .count(),
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/pricing", { waitUntil: "domcontentloaded" });
  const toggle = page.getByRole("button", { name: /menu/i }).first();
  await toggle.click();
  const mobile = {
    expanded: await toggle.getAttribute("aria-expanded"),
    solutions: await page
      .getByRole("link", { name: "Founders and SaaS teams", exact: true })
      .first()
      .isVisible(),
  };
  await page.keyboard.press("Escape");
  mobile.closed = (await toggle.getAttribute("aria-expanded")) === "false";
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(base + "/features/content", {
    waitUntil: "domcontentloaded",
  });
  const tablet = {
    overflow: await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  };
  await page.screenshot({
    path: path.join(out, "content-tablet.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({
    path: path.join(out, "content-dark.png"),
    fullPage: true,
  });
  fs.writeFileSync(
    path.join(out, "functional-checks.json"),
    JSON.stringify(
      {
        results,
        errors,
        accessibility: accessibility.violations,
        menus,
        form,
        mobile,
        tablet,
      },
      null,
      2,
    ),
  );
  console.log({ errors, menus, form, mobile, tablet });
  const failures = results.filter(
    (r) =>
      r.status !== 200 ||
      r.h1 !== 1 ||
      !r.description ||
      !r.canonical ||
      r.overflow ||
      r.badImages.length,
  );
  if (
    failures.length ||
    errors.length ||
    accessibility.violations.length ||
    additionalAccessibility.some((s) => s.violations.length) ||
    menus.some((m) => m.expanded !== "true" || !m.closed || !m.focusReturned) ||
    !mobile.closed ||
    !mobile.solutions ||
    tablet.overflow
  )
    process.exitCode = 1;
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
