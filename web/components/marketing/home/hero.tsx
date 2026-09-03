"use client";

import { markIntroDone } from "@/lib/marketing/intro";
import { CAMPAIGN_SRCS } from "@/lib/marketing/campaign-media";
import { MagneticLink } from "@/components/marketing/magnetic-link";
import { softEase, useReducedMotion } from "@/lib/marketing/motion";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  AnimatePresence,
  motion,
  useScroll,
  useTransform,
  useVelocity,
  type MotionValue,
} from "motion/react";
import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import * as THREE from "three";

/**
 * Remote hero images (CORS-enabled, required for WebGL textures).
 * Tiles repeat through this list; swap in your own URLs here.
 */
const HERO_IMAGES = CAMPAIGN_SRCS;

const IMAGE_COUNT = HERO_IMAGES.length;

type Ring = {
  /** Radius in vmax units (responsive) */
  radiusVmax: number;
  /** Radius cap in px so rings stop growing on very wide screens */
  radiusMax: number;
  /** Seconds per revolution at rest */
  duration: number;
  count: number;
  phase: number;
};

const RINGS: Ring[] = [
  { radiusVmax: 20, radiusMax: 280, duration: 50, count: 9, phase: 0 },
  { radiusVmax: 38.5, radiusMax: 580, duration: 85, count: 13, phase: 24 },
  { radiusVmax: 57, radiusMax: 880, duration: 120, count: 17, phase: 42 },
  { radiusVmax: 75.5, radiusMax: 1180, duration: 155, count: 21, phase: 60 },
];

const TILE_MAX_PX = 144;
const TILE_VW = 0.14;
const IMAGE_MAX_PX = 236;
const IMAGE_VW = 0.225;
const PAN_RADIUS = 22;
const STACK_COUNT = 8;
/** Extra quad padding so the SDF edge anti-aliasing has room */
const TILE_PAD = 2;

/** Center fade mask stops scaling past this width on ultra-wides */
const FIELD_CAP_PX = 1800;
/** Visible dissolve at the bottom of the hero (fraction of section height) */
const BOTTOM_FADE_FRACTION = 0.28;
const BOTTOM_FADE_MAX_PX = 340;

/** Scroll-reactive spin tuning */
const SPEED_DIVISOR = 300; // px/s of scroll velocity per boost unit
const MAX_BOOST = 14; // max extra spin speed at the innermost ring
const BOOST_STAGGER = 0.6; // each outer ring amplifies the boost further
const LAG_BASE = 0.1; // s, response lag of the innermost ring
const LAG_STEP = 0.14; // s, extra lag per ring (staggered ripple)
const STRETCH_BASE = 0.08; // ring spacing stretch at full boost
const STRETCH_STEP = 0.06; // extra stretch per ring (rows separate)

const DEG = Math.PI / 180;

function imageSrc(index: number): string {
  return HERO_IMAGES[index % IMAGE_COUNT] ?? "";
}

/**
 * Tile shader: SDF rounded rect (anti-aliased edge + 1px border), image
 * sampled in world space so photos stay upright while tiles rotate, and both
 * the center radial fade and bottom edge fade are computed per-pixel here,
 * so no CSS masks or canvas composite passes are needed.
 */
const TILE_VERTEX = /* glsl */ `
  uniform vec2 uQuadSize;
  varying vec2 vLocal;
  varying vec2 vWorld;
  void main() {
    vLocal = position.xy * uQuadSize;
    vec4 world = modelMatrix * vec4(vLocal, 0.0, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const TILE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec2 uTileHalf;
  uniform float uRadius;
  uniform vec2 uImgCenter;
  uniform float uImgSize;
  uniform vec4 uBorder;
  uniform vec4 uFade;       // rx, ry, fade center y, unused
  uniform vec2 uBottomFade; // bottom edge y, fade height
  varying vec2 vLocal;
  varying vec2 vWorld;

  float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    float d = sdRoundRect(vLocal, uTileHalf, uRadius);
    float shape = 1.0 - smoothstep(-0.75, 0.75, d);
    if (shape <= 0.001) discard;

    vec2 uv = (vWorld - uImgCenter) / uImgSize + 0.5;
    vec4 tex = texture2D(uMap, uv);
    vec3 rgb = mix(vec3(0.0), tex.rgb, uHasMap);
    float alpha = uHasMap;

    // ~1px border just inside the edge
    float border = (1.0 - smoothstep(0.5, 1.5, abs(d + 1.0))) * uBorder.a;
    rgb = mix(rgb, uBorder.rgb, border);
    alpha = max(alpha, border);

    // center radial fade (piecewise, matches the original CSS gradient)
    vec2 q = vec2(vWorld.x / uFade.x, (vWorld.y - uFade.z) / uFade.y);
    float t = length(q);
    float fade = t < 0.42
      ? mix(0.0, 0.5, clamp((t - 0.24) / 0.18, 0.0, 1.0))
      : t < 0.62
        ? mix(0.5, 0.9, clamp((t - 0.42) / 0.20, 0.0, 1.0))
        : mix(0.9, 1.0, clamp((t - 0.62) / 0.16, 0.0, 1.0));

    // bottom edge fade so tiles never hard-clip mid-page
    float bottom = clamp((vWorld.y - uBottomFade.x) / uBottomFade.y, 0.0, 1.0);

    gl_FragColor = vec4(rgb, shape * alpha * fade * bottom);
  }
`;

type TileUniforms = {
  uMap: { value: THREE.Texture | null };
  uHasMap: { value: number };
  uQuadSize: { value: THREE.Vector2 };
  uTileHalf: { value: THREE.Vector2 };
  uRadius: { value: number };
  uImgCenter: { value: THREE.Vector2 };
  uImgSize: { value: number };
  uBorder: { value: THREE.Vector4 };
  uFade: { value: THREE.Vector4 };
  uBottomFade: { value: THREE.Vector2 };
};

type Tile = {
  ring: number;
  staticAngle: number;
  rounding: number;
  panX: number;
  panY: number;
  img: number;
  uniforms: TileUniforms;
  material: THREE.ShaderMaterial;
};

let colorParser: CanvasRenderingContext2D | null = null;

/** Parses any CSS color (incl. oklch tokens) to normalized RGBA. */
function parseCssColor(color: string): [number, number, number, number] {
  if (!colorParser) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorParser = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!colorParser) return [0, 0, 0, 0.15];
  colorParser.clearRect(0, 0, 1, 1);
  colorParser.fillStyle = color;
  colorParser.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = colorParser.getImageData(0, 0, 1, 1).data;
  return [(r ?? 0) / 255, (g ?? 0) / 255, (b ?? 0) / 255, (a ?? 0) / 255];
}

function FieldScene({
  images,
  reduced,
  velocity,
}: {
  images: RefObject<HTMLImageElement[]>;
  reduced: boolean;
  velocity: MotionValue<number>;
}): ReactNode {
  const { size, gl } = useThree();
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const textures = useRef<(THREE.Texture | null)[]>([]);
  const sim = useRef({
    angles: RINGS.map(() => 0),
    boosts: RINGS.map(() => 0),
  });

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    const cache = textures.current;
    return () => {
      cache.forEach((texture) => texture?.dispose());
    };
  }, []);

  const tiles = useMemo<Tile[]>(
    () =>
      RINGS.flatMap((ring, r) =>
        Array.from({ length: ring.count }, (_, i) => {
          const seed = r * 53 + i * 17;
          const panAngle = ((seed * 37) % 360) * DEG;
          const uniforms: TileUniforms = {
            uMap: { value: null },
            uHasMap: { value: 0 },
            uQuadSize: { value: new THREE.Vector2(1, 1) },
            uTileHalf: { value: new THREE.Vector2(1, 1) },
            uRadius: { value: 20 },
            uImgCenter: { value: new THREE.Vector2(0, 0) },
            uImgSize: { value: IMAGE_MAX_PX },
            uBorder: { value: new THREE.Vector4(0, 0, 0, 0.15) },
            uFade: { value: new THREE.Vector4(1, 1, 0, 0) },
            uBottomFade: { value: new THREE.Vector2(0, 1) },
          };
          // Built imperatively so this exact uniforms object belongs to the
          // material; r3f's uniforms prop clones, breaking later `.value =`
          // reassignments (e.g. attaching textures).
          const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: TILE_VERTEX,
            fragmentShader: TILE_FRAGMENT,
            transparent: true,
            depthWrite: false,
            depthTest: false,
          });
          return {
            ring: r,
            staticAngle: (ring.phase + (360 / ring.count) * i) * DEG,
            rounding: 20 + (seed % 14),
            panX: Math.cos(panAngle) * PAN_RADIUS,
            panY: Math.sin(panAngle) * PAN_RADIUS,
            img: (r * 9 + i) % IMAGE_COUNT,
            uniforms,
            material,
          };
        })
      ),
    []
  );

  useEffect(
    () => () => {
      tiles.forEach((tile) => tile.material.dispose());
    },
    [tiles]
  );

  const metrics = useMemo(() => {
    const vh = typeof window === "undefined" ? size.height : window.innerHeight;
    const vw = size.width;
    const vmax = Math.max(vw, vh) / 100;
    return {
      radii: RINGS.map((ring) =>
        Math.min(ring.radiusVmax * vmax, ring.radiusMax)
      ),
      tileW: Math.min(TILE_MAX_PX, vw * TILE_VW),
      imgSize: Math.min(IMAGE_MAX_PX, vw * IMAGE_VW),
    };
  }, [size.width, size.height]);

  // Resize-dependent uniforms.
  useEffect(() => {
    const tileH = metrics.tileW * 0.75;
    const rx = Math.min(size.width, FIELD_CAP_PX) * 1.2;
    const ry = size.height * 1.05;
    const fadeH = Math.min(
      BOTTOM_FADE_MAX_PX,
      size.height * BOTTOM_FADE_FRACTION
    );
    const yBottom = -size.height / 2;
    tiles.forEach((tile) => {
      tile.uniforms.uQuadSize.value.set(
        metrics.tileW + TILE_PAD,
        tileH + TILE_PAD
      );
      tile.uniforms.uTileHalf.value.set(metrics.tileW / 2, tileH / 2);
      tile.uniforms.uRadius.value = Math.min(tile.rounding, tileH / 2);
      tile.uniforms.uImgSize.value = metrics.imgSize;
      tile.uniforms.uFade.value.set(rx, ry, 0, 0);
      tile.uniforms.uBottomFade.value.set(yBottom, fadeH);
    });
  }, [tiles, metrics, size.width, size.height]);

  // Border color follows the theme token (canvas inherits `text-border`).
  useEffect(() => {
    const update = (): void => {
      const [r, g, b, a] = parseCssColor(getComputedStyle(gl.domElement).color);
      tiles.forEach((tile) => tile.uniforms.uBorder.value.set(r, g, b, a));
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [tiles, gl]);

  useFrame((_, delta) => {
    // Scroll velocity drives a per-ring boost that each ring chases with its
    // own lag, creating a staggered ripple through the rows.
    const dt = Math.min(delta, 0.064);
    const target = reduced
      ? 0
      : Math.min(Math.abs(velocity.get()) / SPEED_DIVISOR, MAX_BOOST);
    const { angles, boosts } = sim.current;
    RINGS.forEach((ring, i) => {
      const lag = LAG_BASE + LAG_STEP * i;
      const previous = boosts[i] ?? 0;
      const boost = previous + (target - previous) * (1 - Math.exp(-dt / lag));
      boosts[i] = boost;
      if (!reduced) {
        const speed = (360 / ring.duration) * DEG;
        angles[i] =
          (angles[i] ?? 0) + dt * speed * (1 + boost * (1 + BOOST_STAGGER * i));
      }
    });

    const imgs = images.current;
    tiles.forEach((tile, index) => {
      const mesh = meshes.current[index];
      if (!mesh) return;
      const boost = boosts[tile.ring] ?? 0;
      const stretch =
        1 + (boost / MAX_BOOST) * (STRETCH_BASE + STRETCH_STEP * tile.ring);
      const radius = (metrics.radii[tile.ring] ?? 0) * stretch;
      const theta = (angles[tile.ring] ?? 0) + tile.staticAngle;
      const x = radius * Math.sin(theta);
      const y = radius * Math.cos(theta);
      mesh.position.set(x, y, 0);
      mesh.rotation.z = -(theta + Math.PI / 2);
      tile.uniforms.uImgCenter.value.set(x + tile.panX, y - tile.panY);

      // Lazily attach textures as the preloaded images finish decoding.
      if (!tile.uniforms.uMap.value) {
        let texture = textures.current[tile.img];
        if (!texture) {
          const img = imgs[tile.img];
          if (img && img.complete && img.naturalWidth > 0) {
            texture = new THREE.Texture(img);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = Math.min(
              4,
              gl.capabilities.getMaxAnisotropy()
            );
            texture.needsUpdate = true;
            textures.current[tile.img] = texture;
          }
        }
        if (texture) {
          tile.uniforms.uMap.value = texture;
          tile.uniforms.uHasMap.value = 1;
        }
      }
    });
  });

  return (
    <>
      {tiles.map((tile, index) => (
        <mesh
          key={index}
          geometry={geometry}
          frustumCulled={false}
          ref={(el) => {
            meshes.current[index] = el;
          }}
        >
          <primitive object={tile.material} attach="material" />
        </mesh>
      ))}
    </>
  );
}

function OrbitField({
  images,
}: {
  images: RefObject<HTMLImageElement[]>;
}): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);

  return (
    // `text-border` lets the shader read the theme border token via CSS `color`.
    <div className="text-border absolute inset-0">
      <Canvas
        orthographic
        flat
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
        gl={{
          alpha: true,
          antialias: false,
          powerPreference: "high-performance",
        }}
        // offsetSize: the hero reveal scales an ancestor (0.96 → 1); rect-based
        // measurement would capture that transform and leave the canvas
        // undersized (tiles hard-clipping on the right). Offset sizes are pure
        // layout and immune to it.
        resize={{ scroll: false, offsetSize: true }}
        style={{ position: "absolute", inset: 0 }}
      >
        <FieldScene
          images={images}
          reduced={prefersReducedMotion}
          velocity={scrollVelocity}
        />
      </Canvas>
    </div>
  );
}

function IntroLoader({ progress }: { progress: number }): ReactNode {
  return (
    <motion.div
      exit={{ opacity: 0 }}
      transition={{ duration: 0.7, ease: softEase }}
      aria-hidden="true"
      className="bg-background fixed inset-0 z-40 flex items-center justify-center"
    >
      <p className="text-foreground absolute top-6 left-6 text-[clamp(88px,15vw,200px)] leading-none font-medium tracking-tighter sm:top-10 sm:left-10">
        Loading...
      </p>

      <div
        className="relative"
        style={{ width: "clamp(120px, 14vw, 170px)", aspectRatio: "3 / 4" }}
      >
        {Array.from({ length: STACK_COUNT }, (_, i) => {
          const shown = progress >= ((i + 1) * 100) / STACK_COUNT;
          return (
            <motion.div
              key={i}
              initial={false}
              animate={
                shown ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }
              }
              transition={{ duration: 0.5, ease: softEase }}
              className="border-border/30 absolute inset-0 overflow-hidden rounded-2xl border"
            >
              <Image
                src={imageSrc(i * 3)}
                alt=""
                width={340}
                height={453}
                unoptimized
                loading="eager"
                className="h-full w-full object-cover"
              />
            </motion.div>
          );
        })}
      </div>

      <p className="text-foreground absolute right-6 bottom-6 text-[clamp(88px,15vw,200px)] leading-none font-medium tracking-tighter tabular-nums sm:right-10 sm:bottom-10">
        {progress}
      </p>
    </motion.div>
  );
}

export function Hero(): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const [loading, setLoading] = useState(true);
  const [loadedCount, setLoadedCount] = useState(0);
  const [progress, setProgress] = useState(1);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const heroRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const scrollFade = useTransform(scrollYProgress, [0, 0.45], [1, 0]);

  useEffect(() => {
    let cancelled = false;
    for (let i = 0; i < IMAGE_COUNT; i += 1) {
      const img = new window.Image();
      const onSettled = (): void => {
        if (!cancelled) setLoadedCount((count) => count + 1);
      };
      img.onload = onSettled;
      img.onerror = onSettled;
      img.crossOrigin = "anonymous";
      img.src = imageSrc(i);
      imagesRef.current[i] = img;
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) markIntroDone();
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setProgress((prev) => {
        const cap = Math.round((loadedCount / IMAGE_COUNT) * 100);
        return Math.min(prev + 2, Math.max(cap, prev));
      });
    }, 28);
    return () => window.clearInterval(id);
  }, [loading, loadedCount]);

  useEffect(() => {
    if (!loading || progress < 100) return;
    const id = window.setTimeout(() => {
      setLoading(false);
      markIntroDone();
    }, 450);
    return () => window.clearTimeout(id);
  }, [loading, progress]);

  const revealed = prefersReducedMotion || !loading;

  // Lock scrolling (native + Lenis, which drives window scroll) while the
  // intro loader is covering the page.
  useEffect(() => {
    if (revealed) return;
    const { documentElement } = document;
    const previous = documentElement.style.overflow;
    documentElement.style.overflow = "hidden";
    return () => {
      documentElement.style.overflow = previous;
    };
  }, [revealed]);

  const fadeUp = (delay: number) => ({
    initial: false as const,
    animate: revealed
      ? { opacity: 1, y: 0 }
      : { opacity: 0, y: prefersReducedMotion ? 0 : 24 },
    transition: prefersReducedMotion
      ? { duration: 0.01 }
      : revealed
        ? { duration: 0.7, ease: softEase, delay: delay + 0.35 }
        : { duration: 0 },
  });

  return (
    <section
      ref={heroRef}
      className="relative flex h-svh min-h-[640px] items-center justify-center"
    >
      <motion.div
        style={{ opacity: prefersReducedMotion ? 1 : scrollFade }}
        className="absolute inset-0 flex items-center justify-center"
      >
        <motion.div
          initial={false}
          animate={
            revealed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }
          }
          transition={
            prefersReducedMotion
              ? { duration: 0.01 }
              : revealed
                ? { duration: 1.3, ease: softEase, delay: 0.15 }
                : { duration: 0 }
          }
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <OrbitField images={imagesRef} />
        </motion.div>

        <div className="relative z-10 flex max-w-3xl flex-col items-center px-6 text-center">
          <motion.h1
            {...fadeUp(0.2)}
            className="text-foreground mt-5 text-[clamp(44px,7.5vw,84px)] leading-[1.02] font-medium tracking-tight text-balance"
          >
            Your AI agent makes the marketing
          </motion.h1>
          <motion.p
            {...fadeUp(0.32)}
            className="text-muted-foreground mt-6 max-w-md text-base leading-relaxed"
          >
            Videos, SEO articles, and ads. You tell it what you sell. It
            creates the work. You set a budget so it cannot overspend.
          </motion.p>
          <motion.div
            {...fadeUp(0.44)}
            className="mt-9 flex items-center gap-3"
          >
            <MagneticLink
              href="/sign-up"
              reduce={prefersReducedMotion}
              className="focus-ring bg-foreground text-background inline-flex h-13 items-center rounded-full px-8 text-sm font-medium transition-opacity hover:opacity-85"
            >
              Start creating
            </MagneticLink>
            <a
              href="#product"
              className="focus-ring bg-background text-foreground border-border hover:bg-muted inline-flex h-13 items-center rounded-full border px-8 text-sm font-medium transition-colors"
            >
              See how it works
            </a>
          </motion.div>
        </div>
      </motion.div>

      <AnimatePresence>
        {!revealed && <IntroLoader key="intro" progress={progress} />}
      </AnimatePresence>
    </section>
  );
}
