# Showcase media — how to put real output on the site

This folder holds the **real assets generated on marketer.sh** that the
homepage showcases: ad creative, video ads, UGC clips, micro-drama episodes
and motion graphics.

Until a file lands here, each slot renders a deliberate on-brand
**placeholder** that prints exactly what belongs in it — the format, the pixel
size and the path below. Nothing looks broken while the folder is empty, and
nothing on the page moves when you fill it: every slot reserves its aspect
ratio up front.

**Only put genuine pipeline output here.** The whole point of the section is
that it is receipts, not stock footage.

---

## Adding a file — the whole procedure

**1. Drop the file in the right folder.** The placeholder on the page prints
the exact path it wants, e.g. `public/showcase/ads/ad-feed-a.jpg`.

**2. Point the registry at it.** Open
`web/components/site/media/showcase.config.ts`, find the slot by `id`, and
change its `src` from `null` to the public URL:

```ts
{
  id: "ad-feed-a",
  ...
  src: "/showcase/ads/ad-feed-a.jpg",   // was: null
}
```

For a **video slot**, set the poster too — it is the first thing painted, and
it is the *only* thing shown to visitors browsing with reduced motion turned
on, so a video without one shows a black box to those people:

```ts
{
  id: "ugc-testimonial",
  ...
  src: "/showcase/ugc/ugc-testimonial.mp4",
  poster: "/showcase/ugc/ugc-testimonial.jpg",
}
```

**3. Check the `alt`.** Each slot carries an `alt` describing what the asset
shows. It was written for the placeholder; once a real asset lands, make it
describe *that* asset. It is what a screen reader announces and what shows if
the file 404s.

That is everything. No component code changes. Paths under `/showcase/` are
served straight from this folder, so `public/showcase/ads/x.jpg` is
`/showcase/ads/x.jpg` in the config.

---

## Folders, and what goes in each

| Folder                 | Slot kind | Content                          | Default extension |
| ---------------------- | --------- | -------------------------------- | ----------------- |
| `showcase/ads/`        | `ad`      | Static ad creative, stills       | `.jpg`            |
| `showcase/video/`      | `video`   | Video ads / brand spots          | `.mp4` + `.jpg`   |
| `showcase/ugc/`        | `ugc`     | UGC-style creator clips          | `.mp4` + `.jpg`   |
| `showcase/drama/`      | `drama`   | Micro-drama episodes             | `.mp4` + `.jpg`   |
| `showcase/motion/`     | `motion`  | Motion graphics / kinetic type   | `.mp4` + `.jpg`   |

The suggested filename is the slot's `id` (e.g. slot `ad-feed-b` →
`ads/ad-feed-b.jpg`). Any filename works as long as the config points at it —
matching the id just keeps things findable.

---

## The slots the homepage currently shows

| id                    | kind   | aspect | expected file                                                       |
| --------------------- | ------ | ------ | ------------------------------------------------------------------- |
| `video-brand-spot`    | video  | 16:9   | `video/video-brand-spot.mp4` + `video/video-brand-spot.jpg`          |
| `ad-feed-a`           | ad     | 4:5    | `ads/ad-feed-a.jpg`                                                  |
| `ad-feed-b`           | ad     | 4:5    | `ads/ad-feed-b.jpg`                                                  |
| `ad-feed-c`           | ad     | 4:5    | `ads/ad-feed-c.jpg`                                                  |
| `ugc-testimonial`     | ugc    | 9:16   | `ugc/ugc-testimonial.mp4` + `ugc/ugc-testimonial.jpg`                |
| `ugc-unboxing`        | ugc    | 9:16   | `ugc/ugc-unboxing.mp4` + `ugc/ugc-unboxing.jpg`                      |
| `drama-episode-hook`  | drama  | 9:16   | `drama/drama-episode-hook.mp4` + `drama/drama-episode-hook.jpg`      |
| `motion-kinetic-type` | motion | 9:16   | `motion/motion-kinetic-type.mp4` + `motion/motion-kinetic-type.jpg`  |

The registry is the source of truth — add, remove or re-order slots there.

---

## Dimensions

Ship the asset at (or above) the slot's native size. It is cropped to fill,
so keep the subject away from the edges.

| Aspect | Ship at       | Used for                                    |
| ------ | ------------- | ------------------------------------------- |
| 16:9   | 1920 × 1080   | Video ads, brand spots, landscape stills    |
| 4:5    | 1080 × 1350   | Portrait feed ads (Instagram / Facebook)    |
| 1:1    | 1080 × 1080   | Square feed ads                             |
| 9:16   | 1080 × 1920   | UGC, micro-drama, Reels / TikTok / Shorts   |

## Formats and file size

**Images.** `.jpg` or `.webp`. WEBP is roughly 30% smaller at the same
quality; prefer it when your export supports it. Optimised images are served
through Next's image pipeline, which resizes and re-encodes automatically, so
you do not need to hand-make multiple sizes.

- Target: **under 400 KB** per still. Anything over ~1 MB is a raw export —
  re-encode it.
- Do not upload PNG screenshots of photography; PNG is for flat UI only.

**Video.** `.mp4`, **H.264 (High profile) + AAC**, `yuv420p`, and the
`faststart` flag so it begins playing before it finishes downloading. Clips
play **muted and looping**, so audio is optional — but keep the track if it
exists, since visitors can unmute nothing today and the file may get reused.

- Target: **under 3 MB**, ideally under 2 MB. Keep clips to **6–12 seconds**;
  this is a showcase, not a player.
- 1080p is plenty. 4K on a card that renders 300 px wide is wasted bandwidth.
- Burn captions into the frame for UGC and drama clips — they autoplay muted.

A dependable encode:

```bash
ffmpeg -i input.mov \
  -vf "scale=1080:-2" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 24 -preset slow \
  -c:a aac -b:a 96k \
  -movflags +faststart \
  public/showcase/ugc/ugc-testimonial.mp4
```

**Poster frames are required for video.** One JPG per clip, same dimensions
as the video, ideally a frame from the clip itself:

```bash
ffmpeg -i public/showcase/ugc/ugc-testimonial.mp4 \
  -ss 00:00:01 -frames:v 1 -q:v 3 \
  public/showcase/ugc/ugc-testimonial.jpg
```

Why it matters: the poster is what paints first, what stands in if autoplay is
refused (data saver, low power mode), and what a visitor with
`prefers-reduced-motion: reduce` sees instead of a moving picture — the
showcase never autoplays for them.

---

## Playback behaviour, so you can predict what visitors see

- Clips are `muted`, `loop`, `playsInline`, and only play **while on screen**.
- Every clip has a real **Play / Pause button**, keyboard reachable, with a
  text label. A visitor who pauses stays paused.
- With **reduced motion** enabled, nothing autoplays; the poster stays up and
  the visitor can press Play if they want it.
- Slots reserve their aspect ratio before any media loads, so filling a slot
  never shifts the page.
