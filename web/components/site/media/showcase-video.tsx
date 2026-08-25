"use client";

/**
 * A clip generated on the platform - a video ad, a UGC piece, a micro-drama
 * episode, a motion-graphics render.
 *
 * The only client component in the showcase, because the behaviour has to
 * live in the browser:
 *
 *   - it plays muted, looping, inline, and only while it is on screen, so a
 *     page of clips never decodes eight videos at once;
 *   - `prefers-reduced-motion: reduce` switches autoplay off entirely and
 *     leaves the poster frame up - the media query is watched live, so
 *     changing the OS setting takes effect without a reload;
 *   - there is a real, keyboard-reachable Pause/Play button with a text
 *     label, not a hover-only affordance. A viewer who pauses stays paused,
 *     including when the clip scrolls back into view, and a viewer with
 *     reduced motion on can still choose to play it.
 *
 * The frame reserves its aspect ratio server-side, so hydration and the
 * first frame both land without moving the page.
 */

import * as React from "react";

import { SlotFrame, SlotPlaceholder } from "./placeholder";
import type { ShowcaseAspect, ShowcaseKind } from "./showcase.config";

type Intent = "auto" | "play" | "pause";

export function ShowcaseVideo({
  src,
  poster,
  alt,
  aspect,
  kind = "video",
  dimensions,
  formats,
  path,
  posterPath,
  title,
  note,
  dense,
  className,
}: {
  /** Public URL of the real clip. Absent -> placeholder. */
  src?: string | null;
  /** Public URL of the poster frame. Always ship one alongside `src`. */
  poster?: string | null;
  /** Required. What the clip shows - the player's accessible name. */
  alt: string;
  aspect: ShowcaseAspect;
  kind?: ShowcaseKind;
  dimensions: string;
  formats: string;
  path: string;
  posterPath?: string;
  title?: string;
  note?: string;
  dense?: boolean;
  className?: string;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  const [intent, setIntent] = React.useState<Intent>("auto");
  const [playing, setPlaying] = React.useState(false);
  const [inView, setInView] = React.useState(false);
  // Assume reduced until measured, so no frame ever autoplays before the
  // preference is known.
  const [reduced, setReduced] = React.useState(true);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src]);

  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const shouldPlay =
      inView && (intent === "play" || (intent === "auto" && !reduced));
    if (shouldPlay) {
      // Autoplay can still be refused (data saver, low power); the poster
      // simply stays up, which is the same outcome as reduced motion.
      void v.play().catch(() => undefined);
    } else if (!v.paused) {
      v.pause();
    }
  }, [inView, intent, reduced, src]);

  if (!src) {
    return (
      <SlotFrame
        aspect={aspect}
        className={className}
        dense={dense}
        note={note}
        title={title}
      >
        <SlotPlaceholder
          alt={alt}
          aspect={aspect}
          dimensions={dimensions}
          formats={formats}
          kind={kind}
          path={path}
          posterPath={posterPath}
        />
      </SlotFrame>
    );
  }

  return (
    <SlotFrame
      aspect={aspect}
      className={className}
      dense={dense}
      note={note}
      title={title}
    >
      <div className="ms-video" ref={boxRef}>
        <video
          aria-label={alt}
          className="ms-slot__media"
          loop
          muted
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          playsInline
          poster={poster ?? undefined}
          preload="metadata"
          ref={videoRef}
          src={src}
        />
        <button
          className="ms-video__btn"
          onClick={() => setIntent(playing ? "pause" : "play")}
          type="button"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span>{playing ? "Pause" : "Play"}</span>
          <span className="ms-sr">{` ${title ?? alt}`}</span>
        </button>
      </div>
    </SlotFrame>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden fill="currentColor" height="11" viewBox="0 0 12 12" width="11">
      <path d="M3 1.6v8.8L10 6z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden fill="currentColor" height="11" viewBox="0 0 12 12" width="11">
      <rect height="9" rx="0.5" width="3" x="2.5" y="1.5" />
      <rect height="9" rx="0.5" width="3" x="6.5" y="1.5" />
    </svg>
  );
}
