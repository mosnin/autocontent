import { chromium } from "playwright";
import fs from "node:fs";

const OUT =
  "/tmp/claude-0/-home-user-autocontent/0b678101-5c74-56af-85b5-284fca27af4e/scratchpad/shots";
fs.mkdirSync(OUT, { recursive: true });

const SIZES = [
  ["desktop", 1440, 900],
  ["tablet", 834, 1112],
  ["mobile", 390, 844],
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});

const summary = {};

for (const [name, w, h] of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  page.on("requestfailed", (r) =>
    errors.push("requestfailed: " + r.url() + " " + (r.failure()?.errorText ?? "")),
  );

  await page.goto("http://localhost:3400/", {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.waitForTimeout(2500);

  const report = await page.evaluate(() => {
    const hero = document.querySelector(".mkt-hero");
    const out = {};
    const navs = [...document.querySelectorAll("nav")];
    out.navTotal = navs.length;
    out.navRendered = navs.filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(n).display !== "none";
    }).length;
    out.heroInsideNav = !!hero?.closest("nav");
    out.navsInsideHero = hero ? hero.querySelectorAll("nav").length : null;
    out.nextSection = hero?.nextElementSibling?.getAttribute("data-framer-name") ?? null;
    out.firstSectionName =
      document.querySelector("#main section")?.getAttribute("data-framer-name") ?? null;
    out.heroRect = hero ? hero.getBoundingClientRect().toJSON() : null;
    out.docScrollWidth = document.documentElement.scrollWidth;
    out.bodyScrollWidth = document.body.scrollWidth;
    out.winWidth = window.innerWidth;

    let maxHeading = 0;
    let maxTag = "";
    hero?.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > maxHeading) {
        maxHeading = fs;
        maxTag = el.tagName + "." + el.className;
      }
    });
    out.maxHeading = maxHeading;
    out.maxHeadingEl = maxTag;
    out.headingFont = hero ? getComputedStyle(hero.querySelector("h1")).fontFamily : null;
    out.headingWeight = hero ? getComputedStyle(hero.querySelector("h1")).fontWeight : null;
    out.ledeFont = hero
      ? getComputedStyle(hero.querySelector(".mkt-hero__lede")).fontFamily
      : null;
    out.eyebrowFont = hero
      ? getComputedStyle(hero.querySelector(".mkt-hero__eyebrow-tag")).fontFamily
      : null;
    out.ctaFont = hero
      ? getComputedStyle(hero.querySelector(".mkt-hero__cta-face")).fontFamily
      : null;

    // Every colour-bearing computed property in the hero subtree.
    const props = [
      "color",
      "backgroundColor",
      "backgroundImage",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "boxShadow",
      "outlineColor",
      "fill",
      "stroke",
      "textDecorationColor",
      "webkitTextFillColor",
    ];
    const offenders = [];
    const scan = (raw, el, prop) => {
      if (!raw || raw === "none") return false;
      if ((prop === "fill" || prop === "stroke") && !(el instanceof SVGElement)) return false;
      // Drop fully transparent colours — they paint nothing.
      const v = String(raw).replace(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/g, "");
      const hits = [];
      if (/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(?:,\s*(?:1|0?\.\d+)\s*)?\)/.test(v)) hits.push("black");
      const rgbRe = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/g;
      let m;
      while ((m = rgbRe.exec(v))) {
        const [r, g, b] = [+m[1], +m[2], +m[3]];
        // Warm/orange: strongly red-dominant with green above blue.
        if (r > 90 && r - g > 40 && g >= b && r - b > 60) hits.push(`orange rgb(${r},${g},${b})`);
      }
      return hits.length ? hits.join("; ") : false;
    };
    if (hero) {
      for (const el of [hero, ...hero.querySelectorAll("*")]) {
        const cs = getComputedStyle(el);
        for (const p of props) {
          const bad = scan(cs[p], el, p);
          if (bad)
            offenders.push({
              el: el.tagName + "." + String(el.className || "").slice(0, 50),
              prop: p,
              value: String(cs[p]).slice(0, 140),
              why: bad,
            });
        }
      }
    }
    out.offenderCount = offenders.length;
    out.offenders = offenders.slice(0, 25);

    // Gutter alignment: hero rails vs. the next section's inner container.
    const rails = hero?.querySelector(".mkt-hero__rails");
    const nextInner = hero?.nextElementSibling?.querySelector('[data-framer-name="Main Container"]');
    out.railsRect = rails ? rails.getBoundingClientRect().toJSON() : null;
    out.nextInnerRect = nextInner ? nextInner.getBoundingClientRect().toJSON() : null;
    return out;
  });

  await page.screenshot({ path: `${OUT}/${name}-top.png` });
  await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: false });

  // --- seam: read real pixels above and below the hero's bottom edge -----
  const bottom = await page.evaluate(() => {
    const hero = document.querySelector(".mkt-hero");
    return hero.getBoundingClientRect().bottom + window.scrollY;
  });
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, Math.round(y) - 400)), bottom);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}-seam.png` });

  const seamY = await page.evaluate(() => {
    const hero = document.querySelector(".mkt-hero");
    return Math.round(hero.getBoundingClientRect().bottom);
  });
  const strip = await page.screenshot({
    clip: { x: 0, y: Math.max(0, seamY - 8), width: Math.min(w, 600), height: 16 },
  });
  const b64 = strip.toString("base64");
  const seamPixels = await page.evaluate(
    async ({ data }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const rows = [];
      for (let y = 0; y < img.height; y++) {
        const px = g.getImageData(0, y, img.width, 1).data;
        // sample five columns across the strip
        const cols = [10, Math.floor(img.width * 0.25), Math.floor(img.width / 2),
          Math.floor(img.width * 0.75), img.width - 10];
        rows.push(cols.map((x) => `${px[x * 4]},${px[x * 4 + 1]},${px[x * 4 + 2]}`));
      }
      return rows;
    },
    { data: b64 },
  );

  report.seamRows = seamPixels;
  report.errors = errors;
  summary[name] = report;
  console.log(`\n===== ${name} ${w}x${h}`);
  console.log(JSON.stringify(report, null, 2));
  await ctx.close();
}

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(summary, null, 2));
await browser.close();
