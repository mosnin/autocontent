"use client";

import { SectionHeading } from "@/components/marketing/section-heading";
import { useReducedMotion } from "@/lib/marketing/motion";
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import Image from "next/image";
import { useRef, type ReactNode } from "react";

type Shot = {
  src: string;
  prompt: string;
};

const ROW_A: Shot[] = [
  {
    src: "https://images.unsplash.com/photo-1779881718722-5e7fa09fad7f?q=80&w=770&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "portrait, 85mm, tungsten spill, smoke",
  },
  {
    src: "https://images.unsplash.com/photo-1780150048191-2e1eefe95665?q=80&w=812&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "city crosswalk at dusk, slight motion blur",
  },
  {
    src: "https://images.unsplash.com/photo-1778051131564-192e359b601d?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "north coast, 16mm, storm light",
  },
  {
    src: "https://images.unsplash.com/photo-1779465190086-021c2012bc4c?q=80&w=770&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "studio still, hard flash, chrome",
  },
  {
    src: "https://images.unsplash.com/photo-1779630541798-1f3d987aa440?q=80&w=770&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "desert highway, heat shimmer, 4pm",
  },
];

const ROW_B: Shot[] = [
  {
    src: "https://images.unsplash.com/photo-1776715139438-c4b4076cc592?q=80&w=770&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "greenhouse interior, soft overcast",
  },
  {
    src: "https://images.unsplash.com/photo-1769968065389-60c3a887d14c?q=80&w=776&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "dancer mid-turn, strobe freeze",
  },
  {
    src: "https://images.unsplash.com/photo-1775668076243-1676696bf27e?q=80&w=778&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "alpine lake, dawn fog, drone wide",
  },
  {
    src: "https://images.unsplash.com/photo-1773698719619-51e67f93a39f?q=80&w=818&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "night market, neon reflections, rain",
  },
  {
    src: "https://images.unsplash.com/photo-1771153568007-92b0997828ae?q=80&w=770&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    prompt: "kitchen scene, window light, 50mm",
  },
];

const COPIES = 5;
const SET_FRACTION = 100 / COPIES;
const BASE_SPEED = 0.55;
const MAX_VELOCITY_BOOST = 4;

function wrap(min: number, max: number, value: number): number {
  const range = max - min;
  return ((((value - min) % range) + range) % range) + min;
}

function ShotCard({ shot }: { shot: Shot }): ReactNode {
  return (
    <figure className="mr-5 w-[240px] shrink-0 sm:w-[300px]">
      <div className="overflow-hidden rounded-2xl">
        <Image
          src={shot.src}
          alt={`Generated frame: ${shot.prompt}`}
          width={600}
          height={800}
          unoptimized
          className="aspect-[3/4] w-full object-cover transition-transform duration-700 ease-out hover:scale-[1.04]"
        />
      </div>
      <figcaption className="text-muted-foreground mt-3 font-mono text-[11px] tracking-tight">
        “{shot.prompt}”
      </figcaption>
    </figure>
  );
}

function MarqueeRow({
  shots,
  direction,
}: {
  shots: Shot[];
  direction: 1 | -1;
}): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const baseX = useMotionValue(direction === 1 ? -SET_FRACTION / 2 : 0);
  const directionFactor = useRef<number>(direction);

  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const smoothVelocity = useSpring(scrollVelocity, {
    damping: 50,
    stiffness: 400,
  });
  const velocityFactor = useTransform(
    smoothVelocity,
    [0, 1200],
    [0, MAX_VELOCITY_BOOST],
    { clamp: false }
  );

  const x = useTransform(baseX, (value) => `${wrap(-SET_FRACTION, 0, value)}%`);

  useAnimationFrame((_, delta) => {
    if (prefersReducedMotion) return;
    const step = BASE_SPEED * (delta / 1000);
    const boost = velocityFactor.get();
    if (boost < 0) directionFactor.current = -direction;
    else if (boost > 0) directionFactor.current = direction;
    const moveBy = directionFactor.current * step * (1 + Math.abs(boost)) * -1;
    baseX.set(baseX.get() + moveBy);
  });

  if (prefersReducedMotion) {
    return (
      <div className="overflow-x-auto px-5 sm:px-8 lg:px-10">
        <div className="flex w-max">
          {shots.map((shot) => (
            <ShotCard key={shot.src} shot={shot} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      <motion.div style={{ x }} className="flex w-max">
        {Array.from({ length: COPIES }, (_, copy) =>
          shots.map((shot) => (
            <ShotCard key={`${copy}-${shot.src}`} shot={shot} />
          ))
        )}
      </motion.div>
    </div>
  );
}

export function Gallery(): ReactNode {
  return (
    <section
      id="gallery"
      className="scroll-mt-24 overflow-hidden pb-24 sm:pb-32"
    >
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <SectionHeading
          title="Made with marketer.sh"
          description="Every frame below came out of the pipelines. Prompts included. Nothing retouched, nothing staged."
        />
      </div>

      <div className="mt-14 flex flex-col gap-10">
        <MarqueeRow shots={ROW_A} direction={1} />
        <MarqueeRow shots={ROW_B} direction={-1} />
      </div>
    </section>
  );
}
