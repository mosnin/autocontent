# JOBS_AUDIT_LOG — cycle log for the Steve Jobs audit fix loop

Goal: see JOBS_AUDIT_GOAL.md. Audit source: STEVE_JOBS_AUDIT.md.

## Cycle 0 — 2026-08-18
- Audit written, committed, published. Goal + log files created. Loop armed.
- Next: Cycle 1 = Workstream 1 (Freeze the lie — marketing truth).

## Cycle 1 — 2026-08-18 · Workstream 1: Freeze the lie (marketing truth)
- Pack video estimates now derived from the real cost model × the 1.5 billing
  margin (default short ≈ $2.75 all-in): Starter ≈ 2–3, Creator ≈ 7–12,
  Studio ≈ 18–30 (was 8–12 / 35–50 / 90–125). Tile bullets no longer imply
  feature gating; Studio blurb says "channels".
- "No card required" removed from quickstart step 1; "fifty cents" headline →
  "a few dollars" with honest $2.75 sub; placeholder's "10 minutes" claim
  dropped; homepage ROI's unverifiable "10 min" stat → true "10 stages" stat.
- Pricing page: mini-FAQ cost answer honest; "exact cost after" → "every
  charge in your billing history"; "visible on your dashboard at all times" →
  where things actually live; closing CTA no longer promises 8–12 videos.
- Refund answers (FAQ + pricing) now state the 30-day window the Refund
  Policy imposes.
- Changelog entry corrected: balance lives in Settings → Billing; refusal is
  by the spend guard (up-front refusal lands in Cycle 2).
- Validation: tsc clean, next build clean.
- Next: Cycle 2 = Workstream 2 (the $0 first run — credit check at enqueue,
  Add-credit CTAs, Failures inbox hidden when empty).

## Cycle 2 — 2026-08-18 · Workstream 2: The $0 first run
- New `src/marketer/services/run_estimate.py`: whole-run cost estimate from
  the authoritative pricing tables (portrait 1024x1536 image tier — the
  client preview's square-tier under-estimate is noted for the money cycle),
  margin-inclusive `estimated_charge_usd`, and `refuse_if_credit_short`.
- `POST /api/v1/jobs` and `POST /jobs/{id}/retry` now refuse up front with
  402 and a human message ("This run is estimated at $X and you have $Y of
  credit. Add credit to run it.") when billing is on and the balance is
  short — no more queued jobs dying deep in the pipeline on their first run.
  Retry gates BEFORE the atomic reset so a refused retry stays `failed`.
- Run-confirm dialog: 402 keeps the dialog open and renders the server's
  message with an "Add credit" button (→ /settings/billing) instead of
  toasting a raw status line.
- Failures inbox: renders nothing when there are no failures (no more
  "Failures inbox" as the first thing a new user sees on Queue) and
  spend-cap rows now carry an "Add credit" action next to Retry.
- Tests: 3 new route tests (402 enqueue, 202 with balance, 402 retry leaves
  job untouched). ruff clean; pytest: my delta +3 passing/0 new failures
  (31 pre-existing env failures on this container — no ffmpeg/DATABASE_URL;
  identical on the clean tree, green in CI).
- Validation: tsc clean, next build clean.
- Next: Cycle 3 = re-audit pass over Cycles 1–2 surfaces, then Workstream 3
  (glossary purge) — per protocol, audit after every 2–3 fix cycles.

## Cycle 3 — 2026-08-18/19 · Re-audit + middleware/dead-code (part 1) and audit-fix fold (part 2)
Part 1 (4d21bb4): /campaigns, /library, /templates added to the Clerk
middleware; five zero-importer components deleted (820-line ui/sidebar kit,
dashboard-switcher, marketing site-nav/site-footer/final-cta).

Part 2 — re-audit verdicts folded (fresh-eyes agent report):
- **Every spend entry point now credit-gated up front**: failures replay
  (job/image_post/article), article enqueue + retry, image-post enqueue +
  retry, template remix (before the upload is stored). Repurpose-to-social's
  402 now speaks human per scope (credits vs cap).
- Retry 402-before-409 precedence fixed (gate only `failed` jobs).
- run_estimate now includes generated music (only when it would actually
  run: brief on + provider resolves to generated on this deploy), a 6-call
  LLM allowance, and portrait 1024x1536 image tiers; negative balances
  format as -$0.50.
- Five surviving false marketing claims fixed: homepage autopilot "10 min"
  stat, two "$0.50 per short" stats (creators use-case, features/video),
  FAQ-page CTA "8 to 12 videos", nav "ten minutes"; local-business "couple
  dollars a day" → five. Pack math re-harmonized to the honest ~$3 default
  (1–2 / 5–8 / 12–20) across tiles, FAQ, pricing mini-FAQ, quickstart.
  Literal \u escapes from Cycle 1's heredoc cleaned to real dashes.
- Client: cost-estimator switched to the portrait tier the pipeline
  actually bills; run dialog fetches billing margin and shows the true
  charge (headline, margin line item, "Run for $X" button) while cap math
  stays pre-margin to match server semantics; new lib/errors.ts humanizes
  402s with an "Add credit" toast action on queue retry, job-detail retry,
  and failures replay.
- Tests: +1 article 402 gate test (69 passing across touched routes).
  ruff clean, tsc clean, next build clean.
- Next: Cycle 4 = Workstream 3 (glossary purge) — then re-audit again.

## Cycle 4 — 2026-08-19 · Workstream 3: Glossary purge
- **Channel, not niche**: all user-facing copy across dashboard, niches
  pages, queue, articles, calendar, library, campaigns, onboarding,
  settings (caps/billing/privacy), command palette, admin, and the
  marketing FAQ now says "channel". Routes, API fields, and identifiers
  unchanged (/niches stays /niches).
- **Product names aligned with marketing**: sidebar now says Studio and
  Press (was Content / SEO); the $50 credit pack renamed Studio → Scale in
  the app, pricing tiles, FAQ, and pricing page — "Studio" now means
  exactly one thing.
- **Pipeline jargon gone from user copy**: "spawn a pipeline run" →
  "produce a new video"; "Run enqueued on reels" → "Run started — Reels"
  (new lib/labels.ts platformLabel; raw platform enums no longer render);
  "Retry/Replay enqueued" → "Retry started"; "All pipeline runs" → "Every
  video run"; "New job" → "New video"; "Enqueuing…" → "Starting…";
  "Pipeline credits" → "Credits"; QA status → "Quality check";
  article Metadata/Imaging → "SEO metadata"/"Hero image"; failure
  categories "Render/Content QA" → "Render/Content check".
- Job-detail header: kicker "Job" → "Video" and the raw UUID removed from
  the header; queue fallback titles no longer print UUID prefixes.
- Validation: tsc clean, next build clean (backend untouched this cycle).
- Next: Cycle 5 = re-audit of the glossary + remaining raw-enum surfaces
  (remix statuses, image-post statuses, calendar ad rows), then
  Workstream 6 (money transparency) or 4 (first video on creation).
