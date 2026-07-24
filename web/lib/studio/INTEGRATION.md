# Studio port — binding integration contract

We are porting an MIT-licensed generative-media studio suite into
marketer.sh. Everything below is binding for every file in the port.
When this contract and the reference implementation disagree, THIS WINS.

## 1. Naming — it is all ours

- The suite is **marketer.sh Studio**. Never "Open Generative AI",
  never "MuAPI", never "muapi", never "Muapi" — not in UI copy, route
  names, component names, file names, comments, class names, env vars,
  error strings, or test names.
- Upstream API-client naming becomes ours: `muapi.js` → our
  `web/lib/studio/client.ts`; `generateImage`/`generateVideo` keep their
  plain verbs but live under our namespace.
- Our own env/config keys only (`MARKETER_*`). No upstream keys.
- **Third-party MODEL names stay factual**: "Flux Dev", "Kling",
  "Veo 3", "Seedance 2.0", "Nano Banana" are real model identifiers
  from their vendors — renaming them would misrepresent what runs. Keep
  model `id`/`name`/`endpoint` data verbatim; brand only OUR product.
- Provider attribution stays truthful in the model catalog
  (`provider: "google"` etc.). We do not claim to have built the models.

## 2. Where it lives — our shell, our nav

- New top-level product in `web/lib/products.ts`:
  - id `studio-gen`, label **"Studio"**, home `/studio/image`,
    match prefix `/studio`.
  - Order in `PRODUCTS`: Campaigns, **Studio**, Content, SEO, Ads, Suite.
  - Its `groups[].items` are the studio pages, in this order:
    Image `/studio/image`, Video `/studio/video`, Audio `/studio/audio`,
    Lip Sync `/studio/lip-sync`, Cinema `/studio/cinema`,
    Recast `/studio/recast`, Clipping `/studio/clipping`,
    Motion `/studio/motion`, Marketing `/studio/marketing`,
    Influencer `/studio/influencer`, Workflows `/studio/workflows`,
    Agents `/studio/agents`, Design `/studio/design`,
    Apps `/studio/apps`, History `/studio/history`.
- Every page is a route under `web/app/(app)/studio/…` so it renders
  inside `SiteShell` automatically (sidebar + header + inset panel).
  Do NOT build a second shell, sidebar, header, or theme switcher —
  ours already exists.
- Add each new route to `web/middleware.ts` protected matchers.

## 3. UI kit — the Square template kit, nothing else

- Chrome comes from `web/components/square/ui/*` (card, button, badge,
  input, select, table, dropdown-menu, checkbox, tooltip, separator,
  skeleton, sheet, progress, avatar, chart).
- Where the kit lacks a primitive (dialog, label, textarea, switch,
  tabs, slider, spinner), use the existing app primitive in
  `web/components/ui/*`. **Never invent a new design system** and never
  copy upstream CSS/`studio.css`/glassmorphism.
- Light theme, our tokens. The reference is dark glassmorphism — drop
  it entirely. No neon, no glass, no gradient chrome.
- Shared studio layout primitives live in
  `web/components/studio/*` and are built FROM the kit above.

## 4. Taste rules still bind

`.claude/skills/no-vibecoded-ui/SKILL.md` applies in full:
- No decorative icons. An icon beside a visible text label is
  decoration — remove it. Functional glyphs only (icon-only controls
  with aria-labels, carets, sort arrows, real media playback controls,
  data-bound status indicators).
- No fake data, ever. Real values or an em dash. Model counts, prices,
  and durations come from the catalog; generation results come from the
  API.
- Placeholders are flat: a plain surface with one small text tag. No
  shapes, blobs, or gradient scenes.

## 5. Execution model — our backend, our caps

- The browser NEVER calls a third-party generation API directly and
  NEVER holds a provider key. All generation goes through
  `POST /api/v1/studio/generations` and is polled via
  `GET /api/v1/studio/generations/{id}`.
- Spend caps are fail-closed on the server. The UI surfaces the real
  cap state; it never simulates or bypasses it.
- Uploads go through our upload endpoint to our object storage; user
  URLs are SSRF-checked server-side.
- Generation history is server-side and per-user (it must survive a
  device change), not localStorage. Client-side storage is allowed only
  for ephemeral UI preferences (last model, last aspect ratio).

## 6. Behavioral fidelity — this is the point

Port the *operation* exactly, even though the chrome is ours:
- Schema-driven controls: every control's visibility, options, and
  default derive from the selected model's `inputs` schema via the
  selectors in `model-selectors.ts`. Never hardcode option lists.
- Mode switching: attaching a reference image switches the model set
  (t2i↔i2i, t2v↔i2v) with the same reset/persist rules as upstream.
- Multi-image input: order badges, batch upload, count and `+` badges,
  "Use Selected" confirmation, per-model max.
- Submit → poll → progress → result, with pending jobs surviving a
  reload and resuming their poll.
- Result actions: download, reuse as input, and the studio-specific
  follow-ups (extend, animate, upscale) where upstream has them.
