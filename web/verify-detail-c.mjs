import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/claude-0/-home-user-autocontent/0b678101-5c74-56af-85b5-284fca27af4e/scratchpad/shots";
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = ["video", "articles", "analytics", "automation"];
const BASE = "http://localhost:3600/features/";

/* --- contrast helpers --- */
function parseRgb(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(",").map((x) => parseFloat(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function lin(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function lum({ r, g, b }) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(fg, bg) {
  const a = lum(fg) + 0.05;
  const b = lum(bg) + 0.05;
  return a > b ? a / b : b / a;
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});

const report = [];
let failures = 0;

for (const route of ROUTES) {
  const url = BASE + route;

  /* ---------- desktop ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const badRequests = [];
  page.on("requestfailed", (r) =>
    badRequests.push(`FAILED ${r.url()} :: ${r.failure()?.errorText}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url()}`);
  });

  const resp = await page.goto(url, { waitUntil: "load" });
  const status = resp.status();
  await page.waitForTimeout(700);

  const metrics = await page.evaluate(() => {
    const toRgb = (s) => s;
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const main = document.querySelector("#main") || document.body;
    const mainBg = getComputedStyle(main).backgroundColor;

    // Walk up for the first non-transparent background.
    const bgOf = (el) => {
      let n = el;
      while (n) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
        n = n.parentElement;
      }
      return "rgb(255,255,255)";
    };

    const samples = [];
    const sel = [
      "h1", "h2", "h3", ".os-h", ".os-title", ".os-lede", ".os-body",
      ".os-bullets li", ".os-stat__label", ".os-stat__value", ".os-chip",
      ".os-meta", ".os-eyebrow", ".os-num", ".os-pre", ".os-codeblock__title",
      ".os-hl", ".os-btn",
    ];
    for (const s of sel) {
      const els = Array.from(document.querySelectorAll(s)).slice(0, 6);
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        samples.push({
          sel: s,
          color: toRgb(cs.color),
          bg: bgOf(el),
          size: parseFloat(cs.fontSize),
          weight: cs.fontWeight,
          text: (el.textContent || "").trim().slice(0, 40),
        });
      }
    }

    // Colours used by the PAGE BODY (`#main main`) — the surface these four
    // pages own. The site nav/footer live outside it and belong to another
    // agent; they are reported separately below.
    const palette = new Set();
    const shellPalette = new Set();
    const body = document.querySelector("#main main");
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      const into = body && body.contains(el) ? palette : shellPalette;
      into.add(cs.color);
      if (cs.backgroundColor !== "rgba(0, 0, 0, 0)") into.add(cs.backgroundColor);
      if (cs.borderTopColor) into.add(cs.borderTopColor);
    });

    return {
      height: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      bodyBg,
      mainBg,
      samples,
      palette: Array.from(palette),
      shellPalette: Array.from(shellPalette),
    };
  });

  await page.screenshot({ path: `${OUT}/${route}-1440.png`, fullPage: true });

  /* contrast evaluation */
  const contrasts = [];
  for (const s of metrics.samples) {
    const fg = parseRgb(s.color);
    const bg = parseRgb(s.bg);
    if (!fg || !bg) continue;
    const r = ratio(fg, bg);
    contrasts.push({ ...s, ratio: +r.toFixed(2) });
  }
  const worst = contrasts.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 6);
  const under = contrasts.filter((c) => c.ratio < 4.5);

  /* hunt for orange / teal / near-white backgrounds */
  const hunt = (list) => {
    const bad = [];
    for (const c of list) {
    const p = parseRgb(c);
    if (!p || (p.a !== undefined && p.a < 0.2)) continue;
    const { r, g, b } = p;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (sat < 0.25) continue;
    // hue
    let h;
    const d = mx - mn;
    if (d === 0) h = 0;
    else if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (h >= 15 && h <= 45 && mx > 90) bad.push({ c, hue: Math.round(h), kind: "orange" });
    if (h >= 160 && h <= 200 && mx > 90) bad.push({ c, hue: Math.round(h), kind: "teal" });
    }
    return bad;
  };
  const bad = hunt(metrics.palette);
  const shellBad = hunt(metrics.shellPalette);

  const nearWhiteBg = [];
  {
    const bb = parseRgb(metrics.bodyBg);
    const mb = parseRgb(metrics.mainBg);
    for (const [name, p] of [["body", bb], ["#main", mb]]) {
      if (p && lum(p) > 0.6) nearWhiteBg.push(`${name}=${JSON.stringify(p)}`);
    }
    // any large element with a near-white background
    // (checked in-page below via palette luminance on section grounds)
  }
  const largeNearWhite = await page.evaluate(() => {
    const out = [];
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    document.querySelectorAll("#main *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 40000) return;
      const cs = getComputedStyle(el);
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!m) return;
      const p = m[1].split(",").map((x) => parseFloat(x.trim()));
      if (p.length > 3 && p[3] < 0.5) return;
      const L = 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
      if (L > 0.6) out.push(`${el.tagName}.${el.className} ${cs.backgroundColor}`);
    });
    return out.slice(0, 5);
  });

  await ctx.close();

  /* ---------- mobile ---------- */
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const mpage = await mctx.newPage();
  const mErrors = [];
  mpage.on("console", (m) => { if (m.type() === "error") mErrors.push(m.text()); });
  mpage.on("pageerror", (e) => mErrors.push(String(e)));
  await mpage.goto(url, { waitUntil: "load" });
  await mpage.waitForTimeout(500);
  const m = await mpage.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth,
    height: document.documentElement.scrollHeight,
    // Elements poking past the viewport. Descendants of a container that
    // scrolls or clips on its own axis are excluded — a wide code block or
    // table inside `overflow-x: auto` is the intended behaviour, not a
    // page-level overflow.
    overflowing: Array.from(document.querySelectorAll("#main *"))
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .filter((el) => {
        let n = el.parentElement;
        while (n && n !== document.documentElement) {
          const o = getComputedStyle(n);
          if (["auto", "scroll", "hidden"].includes(o.overflowX)) return false;
          n = n.parentElement;
        }
        return true;
      })
      .slice(0, 6)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)} right=${Math.round(el.getBoundingClientRect().right)}`),
  }));
  await mpage.screenshot({ path: `${OUT}/${route}-390.png`, fullPage: true });
  await mctx.close();

  const ok =
    status === 200 &&
    consoleErrors.length === 0 &&
    pageErrors.length === 0 &&
    mErrors.length === 0 &&
    metrics.height > 1500 &&
    under.length === 0 &&
    bad.length === 0 &&
    nearWhiteBg.length === 0 &&
    largeNearWhite.length === 0 &&
    m.scrollW <= m.clientW + 1;

  if (!ok) failures++;

  report.push({
    route,
    status,
    height1440: metrics.height,
    height390: m.height,
    consoleErrors,
    badRequests,
    pageErrors,
    mobileErrors: mErrors,
    bodyBg: metrics.bodyBg,
    mainBg: metrics.mainBg,
    worstContrast: worst,
    belowAA: under,
    orangeOrTeal: bad,
    shellOrangeOrTeal: shellBad,
    nearWhiteBg,
    largeNearWhite,
    mobileScroll: { scrollW: m.scrollW, clientW: m.clientW, overflowing: m.overflowing },
    ok,
  });
}

await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(`\n=== /features/${r.route} — ${r.ok ? "PASS" : "FAIL"} ===`);
  console.log(`  status=${r.status} h1440=${r.height1440} h390=${r.height390}`);
  console.log(`  bodyBg=${r.bodyBg} mainBg=${r.mainBg}`);
  console.log(`  consoleErrors=${r.consoleErrors.length} pageErrors=${r.pageErrors.length} mobileErrors=${r.mobileErrors.length}`);
  console.log(`  mobile scrollW=${r.mobileScroll.scrollW} clientW=${r.mobileScroll.clientW} overflow=${JSON.stringify(r.mobileScroll.overflowing)}`);
  console.log(`  orange/teal=${JSON.stringify(r.orangeOrTeal)}`);
  console.log(`  nearWhiteBg=${JSON.stringify(r.nearWhiteBg)} large=${JSON.stringify(r.largeNearWhite)}`);
  console.log(`  belowAA(${r.belowAA.length}): ${JSON.stringify(r.belowAA.slice(0, 5))}`);
  console.log(`  worst: ${r.worstContrast.map((w) => `${w.sel}@${w.size}px ${w.ratio}:1`).join(", ")}`);
}
console.log(`\nFAILURES=${failures}`);
process.exit(failures ? 1 : 0);
