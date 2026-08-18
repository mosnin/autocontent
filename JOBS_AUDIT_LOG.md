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
