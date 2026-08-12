import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("http://localhost:3600/features/video", { waitUntil: "load" });
await p.waitForTimeout(600);
const out = await p.evaluate(() => {
  const hits = [];
  const main = document.querySelector("#main");
  document.querySelectorAll("*").forEach((el) => {
    const cs = getComputedStyle(el);
    for (const prop of ["color", "backgroundColor", "borderTopColor", "fill", "stroke"]) {
      const v = cs[prop];
      if (typeof v === "string" && v.replace(/\s/g, "") === "rgb(65,255,243)") {
        const r = el.getBoundingClientRect();
        hits.push({
          tag: el.tagName,
          cls: String(el.className).slice(0, 60),
          prop,
          inMain: !!(main && main.contains(el)),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
  });
  return hits.slice(0, 25);
});
console.log(JSON.stringify(out, null, 2));
await b.close();
