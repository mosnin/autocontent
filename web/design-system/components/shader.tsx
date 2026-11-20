"use client";

/**
 * Shader fields: soft, grainy gradient light behind onboarding cards and
 * banners. It's the one place Podium spends color, so it reads as alive while
 * the rest of the interface stays quiet.
 *
 * Plain WebGL1, no dependencies. DPR is capped, rendering pauses when the
 * canvas is offscreen or the tab is hidden, reduced motion gets one still
 * frame, and without WebGL a CSS gradient in the same palette takes its place.
 */
import { type CSSProperties, useEffect, useRef, useState } from "react";

const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(" ");

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** Four colors: base wash, then three lights that drift over it. */
export const PALETTES = {
  sky: ["#a9c6ff", "#7f8cff", "#8fe0ff", "#f4f6ff"],
  sunrise: ["#7fd6ec", "#ffd36b", "#ff9f5a", "#fff3d6"],
  bloom: ["#f5a8d8", "#ff9a6b", "#ffd36b", "#f7c6ef"],
  lagoon: ["#5fc7c1", "#2f8fd8", "#a6f0c6", "#e6fbff"],
  dusk: ["#b9a7ff", "#ffb8a1", "#7fa4ff", "#fbe9ff"],
  ember: ["#ffb36b", "#ff6f91", "#ffd56b", "#fff0e0"],
  mono: ["#d8d8de", "#bfc3cc", "#eef0f4", "#ffffff"],
} as const satisfies Record<string, readonly [string, string, string, string]>;
export type Palette = keyof typeof PALETTES;

/** Agent colour fields: every agent owns one palette, picked from its name so it's the same everywhere (avatar, call tile, profile, DM). */
const FIELDS: Palette[] = ["sky", "bloom", "lagoon", "sunrise", "dusk", "ember"];
export function paletteFor(name: string): Palette {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FIELDS[h % FIELDS.length]!;
}

/** A compact version of the field for small surfaces (avatars, chips): a highlight over a two-stop wash. */
export function fieldGradient(palette: Palette) {
  const [a, b, c, d] = PALETTES[palette];
  return `radial-gradient(90% 90% at 22% 18%, ${d} 0%, transparent 60%), radial-gradient(80% 80% at 85% 90%, ${c} 0%, transparent 65%), linear-gradient(150deg, ${a}, ${b})`;
}

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uC0, uC1, uC2, uC3;
uniform float uSeed;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv; p.x *= uRes.x / uRes.y;
  float t = uTime * 0.06 + uSeed;

  // Domain warp gives the lights their soft, petal-like edges.
  vec2 q = vec2(fbm(p * 1.2 + vec2(t, -t * 0.7)), fbm(p * 1.2 + vec2(5.2 - t * 0.6, 1.3 + t)));
  vec2 w = p + (q - 0.5) * 0.9;

  vec2 b1 = vec2(0.35 + 0.25 * sin(t * 1.3), 0.30 + 0.20 * cos(t * 1.1));
  vec2 b2 = vec2(0.75 + 0.22 * cos(t * 0.9 + 1.0), 0.65 + 0.18 * sin(t * 1.2));
  vec2 b3 = vec2(0.55 + 0.30 * sin(t * 0.7 + 2.0), 0.15 + 0.15 * cos(t * 0.8 + 0.5));
  float ar = uRes.x / uRes.y;
  b1.x *= ar; b2.x *= ar; b3.x *= ar;

  float k1 = exp(-pow(length(w - b1), 2.0) * 5.0);
  float k2 = exp(-pow(length(w - b2), 2.0) * 4.0);
  float k3 = exp(-pow(length(w - b3), 2.0) * 7.0);

  vec3 col = uC0;
  col = mix(col, uC1, k1 * 0.95);
  col = mix(col, uC2, k2 * 0.9);
  col = mix(col, uC3, k3 * 0.75);

  // Fine woven texture and film grain, so it reads as printed light, not a CSS gradient.
  vec2 fc = gl_FragCoord.xy;
  float weave = (sin(fc.x * 1.9) * sin(fc.y * 1.9)) * 0.02;
  float grain = (hash(fc + fract(uTime) * 61.0) - 0.5) * 0.11;
  col += weave + grain;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function cssFallback(palette: Palette) {
  const [a, b, c, d] = PALETTES[palette];
  return `radial-gradient(60% 90% at 30% 30%, ${b} 0%, transparent 70%), radial-gradient(50% 80% at 78% 70%, ${c} 0%, transparent 70%), radial-gradient(40% 60% at 55% 10%, ${d} 0%, transparent 70%), ${a}`;
}

export function Shader({ palette = "sky", className, style, seed = 0, speed = 1 }: { palette?: Palette; className?: string; style?: CSSProperties; seed?: number; speed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "low-power" });
    if (!gl) {
      setFailed(true);
      return;
    }
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    } catch {
      setFailed(true);
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const [c0, c1, c2, c3] = PALETTES[palette].map(hex);
    gl.uniform3fv(u("uC0"), c0!);
    gl.uniform3fv(u("uC1"), c1!);
    gl.uniform3fv(u("uC2"), c2!);
    gl.uniform3fv(u("uC3"), c3!);
    gl.uniform1f(u("uSeed"), seed);
    const uRes = u("uRes");
    const uTime = u("uTime");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    };
    const draw = (time: number) => {
      gl.uniform1f(uTime, (time / 1000) * speed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const still = reducedMotion();
    let raf = 0;
    let visible = true;
    const start = performance.now() - seed * 1000;
    const loop = () => {
      raf = 0;
      if (!visible || document.hidden) return;
      draw(performance.now() - start);
      raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (still) return draw(4000);
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const ro = new ResizeObserver(() => {
      resize();
      if (still) draw(4000);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) kick();
    });
    io.observe(canvas);
    const onVis = () => !document.hidden && kick();
    document.addEventListener("visibilitychange", onVis);
    resize();
    kick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [palette, seed, speed]);

  if (failed) return <div aria-hidden className={cx("size-full", className)} style={{ background: cssFallback(palette), ...style }} />;
  return <canvas ref={ref} aria-hidden className={cx("block size-full", className)} style={{ background: cssFallback(palette), ...style }} />;
}
