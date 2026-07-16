"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

// Warm brand aurora. Three stops (amber, rose, amber) so the ramp loops
// seamlessly, matching --gradient-warm rather than the library's default
// purple/blue. Adapted from the React Bits Aurora (ogl WebGL) component.
const BRAND_WARM_STOPS = ["#f59e0b", "#f43f5e", "#f59e0b"];

// A CSS-only warm wash that stands in for the shader when WebGL is
// unavailable or the user prefers reduced motion, so the surface is never
// blank.
const FALLBACK_BG =
  "radial-gradient(120% 120% at 50% 0%, rgba(245,158,11,0.28) 0%, rgba(244,63,94,0.16) 40%, transparent 72%)";

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ),
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \
  int index = 0;                                            \
  for (int i = 0; i < 2; i++) {                               \
     ColorStop currentColor = colors[i];                    \
     bool isInBetween = currentColor.position <= factor;    \
     index = int(mix(float(index), float(i), float(isInBetween))); \
  }                                                         \
  ColorStop currentColor = colors[index];                   \
  ColorStop nextColor = colors[index + 1];                  \
  float range = nextColor.position - currentColor.position; \
  float lerpFactor = (factor - currentColor.position) / range; \
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

export interface AuroraProps {
  /** Three hex colors defining the gradient ramp. Defaults to brand warm. */
  colorStops?: string[];
  /** Animation speed. */
  speed?: number;
  /** Blend of the aurora edge into the background. */
  blend?: number;
  /** Height intensity of the aurora. */
  amplitude?: number;
  className?: string;
}

/**
 * Animated aurora backdrop (WebGL via ogl). Renders a colored ramp driven by
 * simplex noise. Degrades gracefully: a warm CSS wash shows underneath, so if
 * WebGL is unavailable — or the visitor prefers reduced motion — the surface
 * still reads as an intentional gradient instead of going blank. Pauses
 * drawing while scrolled offscreen.
 */
export function Aurora({
  colorStops = BRAND_WARM_STOPS,
  speed = 0.5,
  blend = 0.5,
  amplitude = 1.0,
  className,
}: AuroraProps) {
  const reduced = useReducedMotion();
  const ctnRef = React.useRef<HTMLDivElement>(null);
  const propsRef = React.useRef({ colorStops, speed, blend, amplitude });
  propsRef.current = { colorStops, speed, blend, amplitude };

  React.useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    const visible = { current: true };

    (async () => {
      const ctn = ctnRef.current;
      if (!ctn) return;

      let ogl: typeof import("ogl");
      try {
        ogl = await import("ogl");
      } catch {
        return; // ogl failed to load — CSS fallback stays.
      }
      if (disposed) return;

      const { Renderer, Program, Mesh, Color, Triangle } = ogl;

      let renderer: InstanceType<typeof Renderer>;
      try {
        renderer = new Renderer({
          alpha: true,
          premultipliedAlpha: true,
          antialias: true,
        });
      } catch {
        return; // No WebGL context — CSS fallback stays.
      }

      const gl = renderer.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.canvas.style.backgroundColor = "transparent";
      gl.canvas.style.width = "100%";
      gl.canvas.style.height = "100%";

      const geometry = new Triangle(gl);
      if (geometry.attributes.uv) delete geometry.attributes.uv;

      const toRgb = (hex: string) => {
        const c = new Color(hex);
        return [c.r, c.g, c.b];
      };

      const program = new Program(gl, {
        vertex: VERT,
        fragment: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uAmplitude: { value: amplitude },
          uColorStops: { value: colorStops.map(toRgb) },
          uResolution: { value: [ctn.offsetWidth, ctn.offsetHeight] },
          uBlend: { value: blend },
        },
      });

      const mesh = new Mesh(gl, { geometry, program });
      ctn.appendChild(gl.canvas);

      function resize() {
        if (!ctn) return;
        renderer.setSize(ctn.offsetWidth, ctn.offsetHeight);
        program.uniforms.uResolution.value = [ctn.offsetWidth, ctn.offsetHeight];
      }
      window.addEventListener("resize", resize);
      resize();

      // Pause the draw loop while the backdrop is scrolled out of view.
      const io = new IntersectionObserver(
        ([entry]) => {
          visible.current = entry.isIntersecting;
        },
        { threshold: 0 },
      );
      io.observe(ctn);

      let raf = 0;
      const render = (t: number) => {
        const p = propsRef.current;
        program.uniforms.uTime.value = t * 0.01 * (p.speed ?? 1) * 0.1;
        program.uniforms.uAmplitude.value = p.amplitude ?? 1.0;
        program.uniforms.uBlend.value = p.blend ?? blend;
        program.uniforms.uColorStops.value = (p.colorStops ?? colorStops).map(
          toRgb,
        );
        renderer.render({ scene: mesh });
      };

      if (reduced) {
        // One quiet static frame — the aurora shape without motion.
        program.uniforms.uTime.value = 4.0;
        renderer.render({ scene: mesh });
      } else {
        const loop = (t: number) => {
          raf = requestAnimationFrame(loop);
          if (!visible.current || document.hidden) return;
          render(t);
        };
        raf = requestAnimationFrame(loop);
      }

      cleanup = () => {
        cancelAnimationFrame(raf);
        io.disconnect();
        window.removeEventListener("resize", resize);
        if (gl.canvas.parentNode === ctn) ctn.removeChild(gl.canvas);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
    // Re-init when motion preference or amplitude changes; other props update
    // live through propsRef inside the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, amplitude]);

  return (
    <div className={cn("relative overflow-hidden", className)} aria-hidden>
      <div className="absolute inset-0" style={{ background: FALLBACK_BG }} />
      <div ref={ctnRef} className="absolute inset-0" />
    </div>
  );
}
