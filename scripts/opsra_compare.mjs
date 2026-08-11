// Screenshot the original Framer export and the React transcription under
// identical conditions and diff them.
//
// JavaScript is disabled on BOTH sides on purpose. The export's 43
// scroll-reveal nodes are driven by the Framer runtime; leaving it on would
// compare "revealed original" against "unrevealed port" and drown the real
// signal in animation state. With JS off, both render their static ground
// truth, which is exactly what the transcription is responsible for.
import { chromium } from "playwright";
import { PNG } from "pngjs";
import fs from "node:fs";

const OUT = "/tmp/claude-0/-home-user-autocontent/0b678101-5c74-56af-85b5-284fca27af4e/scratchpad/shots";
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1200 },
  { name: "tablet", width: 834, height: 1100 },
  { name: "phone", width: 390, height: 900 },
];

const TARGETS = {
  original: "http://127.0.0.1:8123/index.html",
  port: "http://127.0.0.1:3000/opsra-port",
};

const browser = await chromium.launch({
  // The environment ships Chromium build 1194; a freshly-installed
  // playwright looks for whatever build it was pinned to. Point at the
  // installed one rather than downloading a second copy.
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--force-device-scale-factor=1", "--hide-scrollbars"],
});

const results = [];

for (const vp of VIEWPORTS) {
  const shots = {};
  for (const [label, url] of Object.entries(TARGETS)) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
      reducedMotion: "reduce",
      bypassCSP: true,
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 120000 });
    // Fonts must be resolved before pixels mean anything — a screenshot
    // taken mid-swap diffs as a wholesale text-metric change.
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(2500);
    const file = `${OUT}/${vp.name}-${label}.png`;
    await page.screenshot({ path: file, fullPage: true });
    shots[label] = file;
    await ctx.close();
  }

  const a = PNG.sync.read(fs.readFileSync(shots.original));
  const b = PNG.sync.read(fs.readFileSync(shots.port));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);

  let diff = 0;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (a.width * y + x) << 2;
      const ib = (b.width * y + x) << 2;
      const io = (w * y + x) << 2;
      const d =
        Math.abs(a.data[ia] - b.data[ib]) +
        Math.abs(a.data[ia + 1] - b.data[ib + 1]) +
        Math.abs(a.data[ia + 2] - b.data[ib + 2]);
      // 24 across three channels tolerates font antialiasing, not layout.
      if (d > 24) {
        diff++;
        out.data[io] = 255; out.data[io + 1] = 0; out.data[io + 2] = 0; out.data[io + 3] = 255;
      } else {
        const g = 235;
        out.data[io] = g; out.data[io + 1] = g; out.data[io + 2] = g; out.data[io + 3] = 255;
      }
    }
  }
  fs.writeFileSync(`${OUT}/${vp.name}-diff.png`, PNG.sync.write(out));

  results.push({
    viewport: vp.name,
    origSize: `${a.width}x${a.height}`,
    portSize: `${b.width}x${b.height}`,
    heightDelta: b.height - a.height,
    diffPct: ((diff / (w * h)) * 100).toFixed(2),
  });
}

await browser.close();
console.table(results);
