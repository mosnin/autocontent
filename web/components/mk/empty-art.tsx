"use client";

import { useId, useMemo, type ReactNode } from "react";

/*
 * Small isometric spot illustrations for empty states.
 *
 * True 30° isometric: a world point (x, y, z) lands at
 * ((x − y)·cos30°, (x + y)·sin30° − z). x runs down-right, y down-left, z up.
 * Shapes are painted back to front, bottom to top. Every surface is a gradient
 * of one hue, sky blue (`--sky`): tops lightest, the left (+y) face mid, the
 * right (+x) face darkest, with round bodies shaded smoothly between the two.
 * No strokes. Tones are CSS variables mixed against the card colour, so the
 * same markup reads on the light and the dark theme.
 */

export type EmptyArtKind =
  | "messages"
  | "calls"
  | "texts"
  | "phone"
  | "activity"
  | "search"
  | "meetings"
  | "notes"
  | "pins"
  | "files"
  | "people"
  | "apps";

type Tone = "base" | "deep" | "acc";

const COS = Math.sqrt(3) / 2;
/** A floor circle of radius r projects to an ellipse with these semi-axes. */
const RX = Math.SQRT2 * COS;
const RY = Math.SQRT1_2;
const VIEW = 116;

const f = (n: number) => String(Math.round(n * 100) / 100);
const proj = (x: number, y: number, z: number): [number, number] => [(x - y) * COS, (x + y) / 2 - z];

type PlanPt = { x: number; y: number; a: number };

/** A rounded rectangle on the floor plan, walked clockwise, with the outward normal angle of each point. */
function plan(x: number, y: number, w: number, d: number, r: number): PlanPt[] {
  r = Math.max(0, Math.min(r, w / 2, d / 2));
  const n = r <= 0 ? 2 : r > 8 ? 12 : r > 3 ? 8 : 4;
  const corners: [number, number, number][] = [
    [x + w - r, y + r, -90],
    [x + w - r, y + d - r, 0],
    [x + r, y + d - r, 90],
    [x + r, y + r, 180],
  ];
  const out: PlanPt[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (90 * i) / n;
      const t = (a * Math.PI) / 180;
      out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), a });
    }
  }
  return out;
}

/** How far a side normal turns from the left face (0) to the right face (1). */
const facing = (a: number) => {
  const t = (a * Math.PI) / 180;
  return Math.max(0, Math.min(1, (Math.cos(t) - Math.sin(t)) / 2 + 0.5));
};

const mixSide = (tone: Tone, w: number) =>
  `color-mix(in oklab, var(--ea-${tone}-l), var(--ea-${tone}-r) ${Math.round(w * 100)}%)`;

class Art {
  defs: string[] = [];
  private n = 0;
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  constructor(readonly p: string) {}

  ref(name: string) {
    return `url(#${this.p}-${name})`;
  }

  private pt(x: number, y: number, z: number): [number, number] {
    const q = proj(x, y, z);
    this.see(q[0], q[1]);
    return q;
  }

  private see(x: number, y: number) {
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
  }

  private d(pts: [number, number][]) {
    return "M" + pts.map((q) => `${f(q[0])} ${f(q[1])}`).join("L") + "Z";
  }

  private gradX(x0: number, x1: number, stops: [number, string][]) {
    const id = `${this.p}-g${this.n++}`;
    const s = stops.map(([o, c]) => `<stop offset="${f(o)}" style="stop-color:${c}"/>`).join("");
    this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x0)}" y1="0" x2="${f(x1)}" y2="0">${s}</linearGradient>`);
    return `url(#${id})`;
  }

  /** An extruded rounded rectangle: smooth side shading, a lighter top. */
  slab(o: { x: number; y: number; w: number; d: number; r?: number; z?: number; h: number; tone?: Tone }) {
    const { x, y, w, d, r = 0, z = 0, h, tone = "base" } = o;
    const pl = plan(x, y, w, d, r);
    const top = this.d(pl.map((q) => this.pt(q.x, q.y, z + h)));
    if (h <= 0) return `<path d="${top}" fill="${this.ref(`top-${tone}`)}"/>`;
    const chain = pl.filter((q) => q.a >= -45 - 1e-6 && q.a <= 135 + 1e-6);
    const bot = chain.map((q) => this.pt(q.x, q.y, z));
    const up = chain.map((q) => this.pt(q.x, q.y, z + h)).reverse();
    const left = bot[bot.length - 1]![0];
    const right = bot[0]![0];
    const span = right - left || 1;
    const stops: [number, string][] = chain
      .map((q, i) => [(bot[i]![0] - left) / span, mixSide(tone, facing(q.a))] as [number, string])
      .reverse();
    const side = this.gradX(left, right, stops);
    return `<path d="${this.d([...bot, ...up])}" fill="${side}"/><path d="${top}" fill="${this.ref(`top-${tone}`)}"/>`;
  }

  cyl(cx: number, cy: number, r: number, z: number, h: number, tone: Tone = "base") {
    return this.slab({ x: cx - r, y: cy - r, w: 2 * r, d: 2 * r, r, z, h, tone });
  }

  /** A flat shape lying on a horizontal plane (text lines, screens). */
  inlay(x: number, y: number, w: number, d: number, r: number, z: number, fill: string, cls = "") {
    const pts = plan(x, y, w, d, r).map((q) => this.pt(q.x, q.y, z));
    return `<path${cls ? ` class="${cls}"` : ""} d="${this.d(pts)}" fill="${this.ref(fill)}"/>`;
  }

  /** A flat rounded shape on the vertical plane y = Y (the left-facing side). */
  onY(Y: number, x: number, z: number, w: number, h: number, r: number, fill: string, cls = "") {
    const pts = plan(x, z, w, h, r).map((q) => this.pt(q.x, Y, q.y));
    return `<path${cls ? ` class="${cls}"` : ""} d="${this.d(pts)}" fill="${this.ref(fill)}"/>`;
  }

  sphere(x: number, y: number, z: number, r: number, tone: Tone = "base") {
    const [cx, cy] = this.pt(x, y, z);
    this.see(cx - r, cy - r);
    this.see(cx + r, cy + r);
    return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${this.ref(`sph-${tone}`)}"/>`;
  }

  /** A soft floor shadow: a radial gradient of the hue on an ellipse. */
  shadow(x: number, y: number, z: number, r: number, cls = "") {
    const [cx, cy] = this.pt(x, y, z);
    return `<ellipse${cls ? ` class="${cls}"` : ""} cx="${f(cx)}" cy="${f(cy)}" rx="${f(r * RX)}" ry="${f(r * RY)}" fill="${this.ref("shadow")}"/>`;
  }

  /** A body of revolution about a vertical axis; profile is [height, radius] from the bottom up. */
  lathe(x: number, y: number, z0: number, prof: [number, number][], tone: Tone = "base") {
    const [X, Y0] = proj(x, y, z0);
    const L = prof.map(([dz, r]) => [X - RX * r, Y0 - dz] as [number, number]);
    const R = prof.map(([dz, r]) => [X + RX * r, Y0 - dz] as [number, number]);
    const r0 = prof[0]![1];
    const rt = prof[prof.length - 1]![1];
    const rmax = Math.max(...prof.map((q) => q[1]));
    for (const q of [...L, ...R]) this.see(q[0], q[1]);
    this.see(X, Y0 + RY * r0);
    const leftDown = [...L].reverse().map((q) => `${f(q[0])} ${f(q[1])}`).join("L");
    const rightUp = R.map((q) => `${f(q[0])} ${f(q[1])}`).join("L");
    let d = `M${leftDown}A${f(RX * r0)} ${f(RY * r0)} 0 0 0 ${f(R[0]![0])} ${f(R[0]![1])}L${rightUp}`;
    const tl = L[L.length - 1]!;
    d += rt > 0 ? `A${f(RX * rt)} ${f(RY * rt)} 0 0 0 ${f(tl[0])} ${f(tl[1])}Z` : "Z";
    const side = this.gradX(X - RX * rmax, X + RX * rmax, [
      [0, mixSide(tone, 0)],
      [0.5, mixSide(tone, 0.4)],
      [1, mixSide(tone, 1)],
    ]);
    let out = `<path d="${d}" fill="${side}"/>`;
    if (rt > 0) {
      const ty = Y0 - prof[prof.length - 1]![0];
      out += `<ellipse cx="${f(X)}" cy="${f(ty)}" rx="${f(RX * rt)}" ry="${f(RY * rt)}" fill="${this.ref(`top-${tone}`)}"/>`;
    }
    return out;
  }

  /** A flat ring (a lens rim) with glass in the middle, seen through. */
  ring(cx: number, cy: number, z: number, R: number, ri: number, h: number, tone: Tone) {
    const side = this.slab({ x: cx - R, y: cy - R, w: 2 * R, d: 2 * R, r: R, z, h, tone }).split("/>")[0] + "/>";
    const outer = plan(cx - R, cy - R, 2 * R, 2 * R, R).map((q) => this.pt(q.x, q.y, z + h));
    const inner = plan(cx - ri, cy - ri, 2 * ri, 2 * ri, ri).map((q) => this.pt(q.x, q.y, z + h));
    const [ix, iy] = proj(cx, cy, z + h);
    const wall = `M${f(ix - RX * ri)} ${f(iy)}a${f(RX * ri)} ${f(RY * ri)} 0 1 0 ${f(2 * RX * ri)} 0a${f(RX * ri)} ${f(RY * ri)} 0 1 0 ${f(-2 * RX * ri)} 0Z`;
    const low = `M${f(ix - RX * ri)} ${f(iy + h)}a${f(RX * ri)} ${f(RY * ri)} 0 1 0 ${f(2 * RX * ri)} 0a${f(RX * ri)} ${f(RY * ri)} 0 1 0 ${f(-2 * RX * ri)} 0Z`;
    const clip = `${this.p}-c${this.n++}`;
    this.defs.push(`<clipPath id="${clip}"><path d="${wall}"/></clipPath>`);
    return (
      side +
      `<path d="${wall}${low}" fill-rule="evenodd" clip-path="url(#${clip})" fill="${this.ref(`wall-${tone}`)}"/>` +
      `<path d="${this.d(outer)}${this.d(inner)}" fill-rule="evenodd" fill="${this.ref(`top-${tone}`)}"/>` +
      `<path d="${wall}" fill="${this.ref("glass")}"/>`
    );
  }
}

const g = (cls: string, ...parts: string[]) => `<g class="${cls}">${parts.join("")}</g>`;

/* Each figure is drawn back to front. World units are about one pixel at 150px. */
const FIGURES: Record<EmptyArtKind, (a: Art) => string> = {
  messages: (a) =>
    a.shadow(36, 34, 0, 36) +
    a.slab({ x: 4, y: 26, w: 54, d: 34, r: 11, z: 6, h: 5, tone: "base" }) +
    a.inlay(13, 35, 34, 4, 2, 11, "line") +
    a.inlay(13, 44, 22, 4, 2, 11, "line") +
    a.cyl(6, 64, 4, 6, 4, "base") +
    a.shadow(46, 22, 11, 20, "ea-shb") +
    g(
      "ea-bob",
      a.slab({ x: 22, y: 4, w: 52, d: 32, r: 11, z: 24, h: 5, tone: "acc" }),
      a.cyl(36, 20, 3.2, 29, 1.6, "base"),
      a.cyl(48, 20, 3.2, 29, 1.6, "base"),
      a.cyl(60, 20, 3.2, 29, 1.6, "base"),
      a.cyl(76, 6, 3.6, 24, 4, "acc"),
    ),

  calls: (a) =>
    a.shadow(36, 30, 0, 38) +
    a.slab({ x: 8, y: 18, w: 56, d: 18, r: 4, z: 0, h: 4, tone: "deep" }) +
    a.slab({ x: 6, y: 22, w: 60, d: 6, r: 2, z: 4, h: 44, tone: "base" }) +
    a.onY(28.05, 10, 8, 52, 36, 3, "screen") +
    a.onY(28.1, 24, 8, 24, 13, 7, "figure") +
    a.onY(28.1, 29.5, 23, 13, 13, 6.5, "figure") +
    a.shadow(64, 48, 0, 11, "ea-shb") +
    g("ea-bob", a.cyl(64, 48, 8, 9, 3.5, "acc"), a.inlay(61, 45, 6, 6, 3, 12.5, "line")),

  texts: (a) =>
    a.shadow(30, 40, 0, 38) +
    a.slab({ x: 10, y: 6, w: 38, d: 66, r: 7, z: 0, h: 5, tone: "base" }) +
    a.inlay(13.5, 9.5, 31, 59, 4.5, 5, "screen") +
    a.inlay(24, 12.5, 10, 2, 1, 5.05, "line") +
    a.shadow(34, 40, 5, 18, "ea-shb") +
    g(
      "ea-bob",
      a.slab({ x: 16, y: 26, w: 44, d: 24, r: 9, z: 22, h: 4.5, tone: "acc" }),
      a.inlay(23, 33, 28, 3.5, 1.75, 26.5, "line-acc"),
      a.inlay(23, 40, 18, 3.5, 1.75, 26.5, "line-acc"),
    ),

  phone: (a) => {
    let s = a.shadow(30, 34, 0, 40);
    s += a.slab({ x: 0, y: 0, w: 60, d: 70, r: 9, z: 0, h: 9, tone: "deep" });
    s += a.inlay(7, 6, 46, 14, 4, 9, "screen", "ea-pulse");
    s += a.inlay(13, 11, 20, 3, 1.5, 9.05, "line");
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        const call = row === 3 && col === 1;
        s += a.cyl(15 + col * 15, 30 + row * 11, 4.3, 9, 2.6, call ? "acc" : "base");
      }
    }
    return s;
  },

  activity: (a) =>
    a.shadow(30, 30, 0, 34) +
    a.cyl(30, 30, 24, 0, 7, "deep") +
    a.shadow(30, 30, 7, 16) +
    g(
      "ea-swing",
      a.sphere(30, 30, 48, 3.8, "base"),
      a.sphere(30, 30, 14, 4.6, "deep"),
      a.lathe(30, 30, 17, [
        [0, 19.5],
        [1.7, 18.4],
        [4.6, 15.6],
        [11.5, 14],
        [19.5, 12.6],
        [25.3, 10.8],
        [29.3, 8],
        [31, 5.2],
      ]),
    ) +
    a.sphere(44, 20, 44, 5.6, "acc"),

  search: (a) =>
    a.shadow(34, 34, 0, 40) +
    a.slab({ x: 4, y: 2, w: 50, d: 34, r: 5, z: 0, h: 3, tone: "deep" }) +
    a.inlay(11, 10, 30, 3.5, 1.75, 3, "line") +
    a.inlay(11, 18, 20, 3.5, 1.75, 3, "line") +
    a.slab({ x: 16, y: 30, w: 50, d: 34, r: 5, z: 0, h: 3, tone: "base" }) +
    a.inlay(23, 38, 32, 3.5, 1.75, 3, "line") +
    a.inlay(23, 46, 22, 3.5, 1.75, 3, "line") +
    a.inlay(23, 54, 28, 3.5, 1.75, 3, "line") +
    g(
      "ea-drift",
      a.shadow(34, 30, 3, 16),
      a.ring(30, 26, 22, 15, 11, 4, "acc"),
      a.slab({ x: 43, y: 23, w: 24, d: 6, r: 3, z: 22.5, h: 3, tone: "acc" }),
    ),

  meetings: (a) => {
    let s = a.shadow(30, 30, 0, 38);
    s += a.slab({ x: 0, y: 0, w: 60, d: 58, r: 6, z: 0, h: 14, tone: "base" });
    s += a.slab({ x: 2, y: 2, w: 56, d: 13, r: 4, z: 14, h: 3, tone: "acc" });
    s += a.cyl(17, 8.5, 2.4, 17, 4, "base");
    s += a.cyl(43, 8.5, 2.4, 17, 4, "base");
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 2) continue;
        s += a.inlay(6 + col * 17, 21 + row * 12, 14, 9, 2, 14, "line");
      }
    }
    s += a.inlay(40, 33, 14, 9, 2, 14, "line");
    s += g("ea-bob", a.slab({ x: 40, y: 33, w: 14, d: 9, r: 2, z: 16, h: 3, tone: "acc" }));
    return s;
  },

  notes: (a) =>
    a.shadow(30, 36, 0, 38) +
    a.slab({ x: 5, y: 7, w: 48, d: 62, r: 4, z: 0, h: 2, tone: "deep" }) +
    a.slab({ x: 2.5, y: 3.5, w: 48, d: 62, r: 4, z: 2, h: 2, tone: "base" }) +
    a.slab({ x: 0, y: 0, w: 48, d: 62, r: 4, z: 4, h: 2, tone: "base" }) +
    a.slab({ x: 0, y: 0, w: 48, d: 9, r: 4, z: 6, h: 2.5, tone: "acc" }) +
    a.inlay(7, 16, 32, 3.2, 1.6, 6, "line") +
    a.inlay(7, 24, 28, 3.2, 1.6, 6, "line") +
    a.inlay(7, 32, 32, 3.2, 1.6, 6, "line") +
    a.inlay(7, 40, 18, 3.2, 1.6, 6, "line") +
    a.shadow(46, 52, 6, 12) +
    g("ea-glide", a.slab({ x: 26, y: 48, w: 40, d: 6, r: 3, z: 6, h: 6, tone: "acc" })),

  pins: (a) =>
    a.shadow(30, 26, 0, 36) +
    a.slab({ x: 0, y: 0, w: 60, d: 48, r: 6, z: 0, h: 4, tone: "base" }) +
    a.inlay(8, 22, 34, 3.5, 1.75, 4, "line") +
    a.inlay(8, 30, 40, 3.5, 1.75, 4, "line") +
    a.inlay(8, 38, 24, 3.5, 1.75, 4, "line") +
    a.shadow(44, 12, 4, 7, "ea-shb") +
    a.cyl(44, 12, 1.4, 4, 0.01, "deep") +
    g(
      "ea-bob",
      a.cyl(44, 12, 0.9, 7, 8, "deep"),
      a.cyl(44, 12, 3.4, 14, 7, "acc"),
      a.cyl(44, 12, 7, 21, 4, "acc"),
    ),

  files: (a) =>
    a.shadow(30, 28, 0, 38) +
    a.slab({ x: 3, y: -7, w: 22, d: 10, r: 3, z: 0, h: 3, tone: "deep" }) +
    a.slab({ x: 0, y: 0, w: 60, d: 50, r: 5, z: 0, h: 3, tone: "deep" }) +
    a.slab({ x: 6, y: 5, w: 46, d: 36, r: 3, z: 3, h: 1.5, tone: "base" }) +
    g(
      "ea-slide",
      a.slab({ x: 9, y: 1, w: 44, d: 36, r: 3, z: 4.5, h: 1.5, tone: "base" }),
      a.inlay(15, 6, 26, 3.2, 1.6, 6, "line"),
      a.inlay(15, 12, 18, 3.2, 1.6, 6, "line"),
    ) +
    a.slab({ x: 0, y: 18, w: 60, d: 32, r: 5, z: 3, h: 5, tone: "acc" }),

  people: (a) =>
    a.shadow(34, 28, 0, 44) +
    a.cyl(18, 42, 15, 0, 7, "deep") +
    a.lathe(18, 42, 7, [
      [0, 10],
      [7, 10],
      [11, 9],
      [14, 6.5],
      [15.5, 3],
    ]) +
    a.sphere(18, 42, 30, 7, "base") +
    a.cyl(50, 12, 15, 0, 13, "deep") +
    a.shadow(50, 12, 13, 10, "ea-shb") +
    g(
      "ea-bob",
      a.lathe(50, 12, 16, [
        [0, 9.5],
        [6.5, 9.5],
        [10.5, 8.5],
        [13.5, 6],
        [15, 3],
      ], "acc"),
      a.sphere(50, 12, 38.5, 6.8, "acc"),
    ),

  apps: (a) => {
    let s = a.shadow(32, 32, 0, 42);
    s += a.slab({ x: 0, y: 0, w: 64, d: 64, r: 8, z: 0, h: 4, tone: "deep" });
    s += a.slab({ x: 4, y: 4, w: 26, d: 26, r: 6, z: 4, h: 12, tone: "base" });
    s += a.shadow(47, 17, 4, 12);
    s += g("ea-drop", a.slab({ x: 34, y: 4, w: 26, d: 26, r: 6, z: 4, h: 12, tone: "acc" }));
    s += a.slab({ x: 4, y: 34, w: 26, d: 26, r: 6, z: 4, h: 12, tone: "base" });
    s += a.slab({ x: 34, y: 34, w: 26, d: 26, r: 6, z: 4, h: 12, tone: "base" });
    return s;
  },
};

const mix = (pct: number) => `color-mix(in oklab, hsl(var(--sky)) ${pct}%, hsl(var(--card)))`;
const shade = (pct: number) => `color-mix(in oklab, hsl(var(--sky)) ${pct}%, black)`;

/* Tones: t0→t1 top, l/r the two side faces. Light mixes the hue into the card; dark lifts it out of the dark card. */
const STYLE = `
.ea{--ea-base-t0:${mix(7)};--ea-base-t1:${mix(16)};--ea-base-l:${mix(24)};--ea-base-r:${mix(42)};
--ea-deep-t0:${mix(12)};--ea-deep-t1:${mix(20)};--ea-deep-l:${mix(30)};--ea-deep-r:${mix(46)};
--ea-acc-t0:${mix(58)};--ea-acc-t1:${mix(82)};--ea-acc-l:${shade(92)};--ea-acc-r:${shade(74)};
--ea-line:${mix(20)};--ea-line2:${mix(9)};--ea-line-acc:${mix(30)};--ea-sh:.22;--ea-glass:.16}
.dark .ea{--ea-base-t0:${mix(50)};--ea-base-t1:${mix(40)};--ea-base-l:${mix(33)};--ea-base-r:${mix(21)};
--ea-deep-t0:${mix(32)};--ea-deep-t1:${mix(26)};--ea-deep-l:${mix(18)};--ea-deep-r:${mix(11)};
--ea-acc-t0:${mix(100)};--ea-acc-t1:${mix(80)};--ea-acc-l:${mix(58)};--ea-acc-r:${mix(40)};
--ea-line:${mix(22)};--ea-line2:${mix(30)};--ea-line-acc:${mix(100)};--ea-sh:.3;--ea-glass:.2}
.ea-bob{animation:ea-bob 4.8s ease-in-out infinite}
.ea-shb{animation:ea-shb 4.8s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.ea-swing{animation:ea-swing 4.4s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 0}
.ea-pulse{animation:ea-pulse 3.6s ease-in-out infinite}
.ea-drift{animation:ea-drift 6s ease-in-out infinite}
.ea-glide{animation:ea-glide 5s ease-in-out infinite}
.ea-slide{animation:ea-slide 5.2s ease-in-out infinite}
.ea-drop{animation:ea-drop 5s ease-in-out infinite}
@keyframes ea-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3.5px)}}
@keyframes ea-shb{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.9);opacity:.7}}
@keyframes ea-swing{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
@keyframes ea-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes ea-drift{0%,100%{transform:translate(0,0)}33%{transform:translate(3.5px,-2px)}66%{transform:translate(-2.5px,1.5px)}}
@keyframes ea-glide{0%,100%{transform:translate(0,0)}50%{transform:translate(-5.2px,-3px)}}
@keyframes ea-slide{0%,100%{transform:translate(0,0)}50%{transform:translate(4.3px,-2.5px)}}
@keyframes ea-drop{0%,100%{transform:translateY(-7px)}45%,70%{transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.ea *{animation:none!important}}
`.replace(/\n/g, "");

function sharedDefs(p: string) {
  const lin = (name: string, a: string, b: string, x2 = 1, y2 = 1) =>
    `<linearGradient id="${p}-${name}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" style="stop-color:var(${a})"/><stop offset="1" style="stop-color:var(${b})"/></linearGradient>`;
  const tones: Tone[] = ["base", "deep", "acc"];
  let s = "";
  for (const t of tones) {
    s += lin(`top-${t}`, `--ea-${t}-t0`, `--ea-${t}-t1`);
    s += lin(`wall-${t}`, `--ea-${t}-r`, `--ea-${t}-l`, 1, 0);
    s += `<radialGradient id="${p}-sph-${t}" cx=".38" cy=".32" r=".75"><stop offset="0" style="stop-color:var(--ea-${t}-t0)"/><stop offset=".55" style="stop-color:var(--ea-${t}-l)"/><stop offset="1" style="stop-color:var(--ea-${t}-r)"/></radialGradient>`;
  }
  s += lin("line", "--ea-line", "--ea-line2");
  s += lin("line-acc", "--ea-line-acc", "--ea-acc-t0");
  s += lin("figure", "--ea-base-t0", "--ea-base-t1", 0, 1);
  s += `<linearGradient id="${p}-screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--ea-acc-t0)"/><stop offset="1" style="stop-color:var(--ea-acc-l)"/></linearGradient>`;
  s += `<radialGradient id="${p}-shadow"><stop offset="0" style="stop-color:hsl(var(--sky));stop-opacity:var(--ea-sh)"/><stop offset="1" style="stop-color:hsl(var(--sky));stop-opacity:0"/></radialGradient>`;
  s += `<linearGradient id="${p}-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:hsl(var(--sky));stop-opacity:calc(var(--ea-glass) * .4)"/><stop offset=".6" style="stop-color:hsl(var(--sky));stop-opacity:var(--ea-glass)"/><stop offset="1" style="stop-color:hsl(var(--sky));stop-opacity:calc(var(--ea-glass) * 1.6)"/></linearGradient>`;
  return s;
}

function draw(kind: EmptyArtKind, p: string) {
  const a = new Art(p);
  const body = FIGURES[kind](a);
  const cx = (a.minX + a.maxX) / 2;
  const cy = (a.minY + a.maxY) / 2 - 3; // room above for the float
  const size = Math.max(VIEW, a.maxX - a.minX + 12, a.maxY - a.minY + 16);
  const viewBox = `${f(cx - size / 2)} ${f(cy - size / 2)} ${f(size)} ${f(size)}`;
  const html = `<style>${STYLE}</style><defs>${sharedDefs(p)}${a.defs.join("")}</defs>${body}`;
  return { viewBox, html };
}

export function EmptyArt({ kind, size = 140, className }: { kind: EmptyArtKind; size?: number; className?: string }) {
  const p = "ea" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const { viewBox, html } = useMemo(() => draw(kind, p), [kind, p]);
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className ? `ea shrink-0 ${className}` : "ea shrink-0"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function EmptyState({
  kind,
  title,
  children,
  action,
  compact,
}: {
  kind: EmptyArtKind;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`mx-auto flex max-w-sm flex-col items-center text-center ${compact ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-10"}`}>
      <EmptyArt kind={kind} size={compact ? 96 : 140} className={compact ? "mb-0.5" : "mb-1"} />
      {title && <div className="text-[14px] font-medium text-foreground">{title}</div>}
      {children && <div className="text-[13px] leading-5 text-pretty text-muted-foreground">{children}</div>}
      {action && <div className={compact ? "mt-2" : "mt-3"}>{action}</div>}
    </div>
  );
}
