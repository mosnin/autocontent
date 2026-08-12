import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3777";
const OUT = "/tmp/claude-0/-home-user-autocontent/0b678101-5c74-56af-85b5-284fca27af4e/scratchpad/shots";
fs.mkdirSync(OUT, { recursive: true });

const MINE = [
  "/features",
  "/features/campaigns",
  "/features/scheduling",
  "/features/niches",
  "/features/templates",
  "/features/library",
];
const ALL14 = [
  "/features/video", "/features/articles", "/features/analytics",
  "/features/automation", "/features/ads", "/features/ugc",
  "/features/dramas", "/features/motion", "/features/seo-audit",
  "/features/campaigns", "/features/scheduling", "/features/niches",
  "/features/templates", "/features/library",
];

/* ---------- contrast helpers ---------- */
function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum([r, g, b]) { return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); }
function parse(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
}
function over(fg, bg) {
  return fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = { pages: [], links: [], contrast: [], fails: [] };

async function auditPage(page, path) {
  const errors = [];
  page.on("requestfailed", (r) => { if (!/fonts\.(googleapis|gstatic)\.com/.test(r.url())) errors.push("REQFAIL " + r.url() + " " + (r.failure()?.errorText)); });
  page.on("response", (r) => { if (r.status() >= 400 && !/fonts\.(googleapis|gstatic)\.com/.test(r.url())) errors.push("HTTP" + r.status() + " " + r.url()); });
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(m.location()?.url || "")) errors.push("CONSOLE " + m.text() + " @ " + (m.location()?.url || "")); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const resp = await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const status = resp.status();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  return { path, status, height, errors };
}

/* ---------- 1. my 6 routes at 1440 ---------- */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
for (const path of MINE) {
  const page = await ctx.newPage();
  const r = await auditPage(page, path);

  // contrast sampling
  const samples = await page.evaluate(() => {
    function bgOf(el) {
      let n = el;
      while (n) {
        const s = getComputedStyle(n);
        const bg = s.backgroundColor;
        const m = bg.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
          const a = p.length > 3 ? p[3] : 1;
          if (a > 0.95) return bg;
        }
        n = n.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }
    const out = [];
    const sel = "h1, h2, h3, p.os-lede, p.os-body, .os-hl, .os-stat__value, .os-eyebrow, p.os-meta, .os-chip, .os-btn";
    const seen = new Set();
    for (const el of document.querySelectorAll(sel)) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) continue;
      const key = el.className + "|" + el.tagName;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = getComputedStyle(el);
      out.push({
        tag: el.tagName, cls: el.className, color: s.color, bg: bgOf(el),
        size: s.fontSize, weight: s.fontWeight,
        text: (el.textContent || "").trim().slice(0, 40),
      });
    }
    return out;
  });

  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const nearWhite = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 20) continue;
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      const a = p.length > 3 ? p[3] : 1;
      if (a < 0.9) continue;
      if (p[0] > 235 && p[1] > 235 && p[2] > 235) {
        bad.push(el.tagName + "." + String(el.className).slice(0, 40) + " " + bg);
      }
    }
    return bad.slice(0, 5);
  });

  const cont = [];
  for (const s of samples) {
    const fg = parse(s.color), bgp = parse(s.bg);
    if (!fg || !bgp) continue;
    const bgRgb = bgp.rgb;
    const eff = over(fg, bgRgb);
    const cr = ratio(eff, bgRgb);
    cont.push({ ...s, ratio: +cr.toFixed(2) });
  }
  const worst = cont.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 6);
  results.contrast.push({ path: path, bodyBg, worst, nearWhite });

  // horizontal overflow at 1440
  const ovf1440 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

  await page.screenshot({ path: `${OUT}/${path.replace(/\//g, "_") || "root"}-1440.png`, fullPage: true });
  results.pages.push({ ...r, ovf1440 });
  await page.close();
}
await ctx.close();

/* ---------- 2. mobile 390 ---------- */
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
for (const path of MINE) {
  const page = await mctx.newPage();
  await page.goto(BASE + path, { waitUntil: "load" });
  const ovf = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 || r.left < -1) bad.push(el.tagName + "." + String(el.className).slice(0, 50) + " right=" + Math.round(r.right));
    }
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: w, offenders: bad.slice(0, 6) };
  });
  await page.screenshot({ path: `${OUT}/${path.replace(/\//g, "_") || "root"}-390.png`, fullPage: true });
  const rec = results.pages.find((p) => p.path === path);
  rec.mobile = ovf;
  await page.close();
}
await mctx.close();

/* ---------- 3. hub link check ---------- */
const lctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const hub = await lctx.newPage();
await hub.goto(BASE + "/features", { waitUntil: "load" });
const hubHrefs = await hub.evaluate(() =>
  [...new Set([...document.querySelectorAll('main a[href^="/features/"]')].map((a) => a.getAttribute("href")))]
);
await hub.close();

for (const path of ALL14) {
  const present = hubHrefs.includes(path);
  const page = await lctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(m.location()?.url || "")) errs.push("CONSOLE " + m.text() + " @ " + (m.location()?.url || "")); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const resp = await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  results.links.push({ path, onHub: present, status: resp.status(), height: h, errors: errs.length });
  await page.close();
}
results.hubHrefs = hubHrefs;
await lctx.close();
await browser.close();

fs.writeFileSync("/tmp/claude-0/-home-user-autocontent/0b678101-5c74-56af-85b5-284fca27af4e/scratchpad/results.json", JSON.stringify(results, null, 2));

/* ---------- report ---------- */
console.log("=== MY 6 ROUTES ===");
for (const p of results.pages) {
  console.log(`${p.path.padEnd(24)} status=${p.status} h=${p.height} consoleErrs=${p.errors.length} ovf1440=${p.ovf1440} mobileScroll=${p.mobile.scrollWidth}/${p.mobile.clientWidth} mobileOffenders=${p.mobile.offenders.length}`);
  if (p.errors.length) console.log("   ERRORS:", p.errors.slice(0, 3));
  if (p.mobile.offenders.length) console.log("   OVERFLOW:", p.mobile.offenders);
}
console.log("\n=== HUB LINK CHECK ===");
console.log("hub hrefs found:", results.hubHrefs.length, results.hubHrefs.join(" "));
for (const l of results.links) {
  console.log(`${l.path.padEnd(24)} onHub=${l.onHub} status=${l.status} h=${l.height} errs=${l.errors}`);
}
console.log("\n=== CONTRAST (worst per page) ===");
for (const c of results.contrast) {
  console.log(`\n${c.path}  bodyBg=${c.bodyBg}  nearWhiteBlocks=${c.nearWhite.length}`);
  if (c.nearWhite.length) console.log("  NEAR-WHITE:", c.nearWhite);
  for (const w of c.worst) {
    console.log(`  ${String(w.ratio).padStart(6)}:1  ${w.tag} .${String(w.cls).slice(0, 26).padEnd(26)} ${w.size}/${w.weight} fg=${w.color} bg=${w.bg}  "${w.text}"`);
  }
}
