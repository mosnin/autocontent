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

## Cycle 5/6 — 2026-08-19 · Empty-state CTAs + glossary re-audit fold
Cycle 5 (403beeb): every dead-end empty state links to its action (article
dialog, campaigns tip, campaign-lane picker, queue + calendar cells,
library finals); templates empty state stops naming the admin console.

Cycle 6 — glossary re-audit verdicts folded:
- P0s: garbled "captions captioning" sentence fixed; Stripe pack names
  corrected (checkout now says "Scale — $50 of credit", no "pipeline
  credit"); job header renders "TikTok" via platformLabel, not
  CSS-capitalized "Tiktok".
- Same-screen collisions fixed: NichesTable (header/button/empty/footer),
  article dialog "for the channel", campaign lanes copy, FAQ question,
  templates prompt hint, "Recent jobs" → "Recent videos", uuid8 subtitle
  removed from queue rows, "Open job <uuid>" aria-labels humanized.
- Jargon survivors fixed: article toasts, command palette "Enqueue" →
  "Run" + platform labels, kits/admin/spend-cap copy, spend chart.
- Backend user-visible detail strings now say "channel" ("channel not
  found", "tiktok isn't enabled for this channel", template style).
- Raw enums humanized via lib/labels (humanizeStatus/titleWord): remix
  statuses, image-post strip, calendar ad rows, edit-form platform
  checkboxes, voice names in both selects.
- Deferred (logged): full marketing "niche" sweep (~80 sites — agencies/
  features/guides positioning language), ads dotted-action enums +
  account labels (Workstream 7 cycle), consolidating duplicate platform
  maps onto lib/labels.
- Validation: ruff clean, route tests green, tsc clean, next build clean.
- Next: Cycle 7 = Workstream 6 (money transparency: receipts, balance in
  shell, ledger rollups) or Workstream 4 (first video on creation).

## Cycle 7 — 2026-08-19 · Workstream 6: Money transparency
- **Balance in the shell**: the sidebar footer's permanent "Get more
  credits" is now the live balance ("$12.40 credit", 60s refresh) linking
  to billing; plain "Billing" when billing is disabled.
- **Per-video receipt**: new `GET /jobs/{id}/receipt` (metered spend from
  spend_ledger + actual charged credit from the run's debit rows via new
  `billing.charged_for_job`); the job Costs tab now shows "Actual metered
  cost" and "Charged to your balance" once a run is terminal, with vendor
  names dropped from the estimate rows (Scene images / Animation /
  Voiceover / Captions).
- **Ledger legible**: per-call debits roll up into one row per video run
  ("Video run · 12 metered calls", per-call detail one click away);
  sub-cent amounts render at 4 decimals instead of $0.00; "Show full
  history" fetches up to 500 rows (backend limit param added).
- **No more one-click Stripe redirect**: pack cards open a confirm dialog
  ("Buy $20 of credit? … No subscription, no auto-renew") before checkout.
- Tests: +1 receipt route test. ruff clean, route tests green, tsc clean,
  next build clean.
- Next: Cycle 8 = Workstream 4 (first video on channel creation + staged
  progress) or the Review Room (Workstream 5); re-audit after.

## Cycle 8 — 2026-08-19 · Workstream 4: First video on creation + staged progress
- Onboarding's final step now carries "Render my first video now" (default
  on); the submit button becomes "Create channel & render my first video".
  The create action enqueues the first run on the first chosen platform
  and lands the user on the live job page — the wait is the show. Any
  enqueue failure (e.g. out of credit) falls back to the dashboard; the
  channel exists either way.
- Job detail gains a production rail: "Step 4 of 9 · Animating scenes",
  animated progress bar, and the full stage list with the current step
  lit — replacing a lone badge word as the only in-flight feedback.
  Queued runs show "Waiting for a machine…".
- Validation: tsc clean, next build clean.
- Next: Cycle 9 = re-audit of Cycles 7–8, then the Review Room
  (Workstream 5).

## Cycle 9 (part 1) — 2026-08-19 · Workstream 5: The Review Room
- **A rejection is a decision, not a failure**: migration 0026 adds a real
  `rejected` job status (PG enum); reject now lands there with no error
  text, stays out of the Failures inbox and the red badges, and isn't
  retryable. Python enum, TS union, and status labels updated; queue badge
  renders neutral "Rejected" (was falling through to "Failed").
- **Review where the video plays**: the job page shows a review bar for
  awaiting_approval — "Approve & schedule" and a styled Reject dialog
  (replacing decisions made blind from a table row; the row buttons
  remain as a quick path).
- **Download MP4** button under every rendered video — the first way to
  take your own video out of the product.
- "Logs" tab renamed "Issues" (it never showed logs) with honest empty
  copy. Deferred: "Post now" (needs backend scheduling param), caption
  editing (backend caption override), unified image-post approvals.
- Validation: ruff clean, approval/jobs/failures tests green, tsc clean,
  next build clean. Re-audit of Cycles 7–8 running in parallel.

## Cycle 10 — 2026-08-19 · Fold of the Cycles 7–8 re-audit
(The re-audit's H2 + download-gap were already fixed by Cycle 9's Review
Room; this cycle folds everything else.)
- **H1**: a failed first-run enqueue no longer dies silently — the reason
  travels to /dashboard (?first_render=failed&reason=…) and toasts, with
  the Add-credit action on a 402.
- **H3**: awaiting_approval slow-polls (30s) instead of freezing, so an
  approval made anywhere else updates the open page.
- **M1**: buy() is exception-safe (try/finally) — a thrown checkout action
  can't brick the billing page.
- **M2/M3**: receipts render at 4-decimal precision via a shared
  formatUsdPrecise (lib/format), and terminal zero-spend runs say "no
  metered spend" instead of promising a number that never comes.
- **L1/L2/L3**: full-history ledger notes its 500-entry boundary; sidebar
  formats negative balances as -$3.21; ProgressRail counts the current
  stage as half-done (no more full bar mid-scheduling).
- **Gap 4**: the first-video celebration now fires on the job page where
  the moment happens (same one-shot localStorage key).
- **Honorable mention**: the ReviewBar warns when socials aren't connected
  — before the user approves into a late scheduling failure.
- Validation: ruff clean, tsc clean, next build clean.
- Next: Cycle 11 = ads governance UI (Workstream 7) or marketing niche
  sweep; re-audit after.

## Cycle 11 — 2026-08-19 · Workstream 7: Ads governance UI
- **Guardrails visible and editable**: each connected ad account on
  /ads/connect gets a "Spending guardrails" editor — daily/monthly caps
  and the kill-switch (the setGovernance client that no component ever
  called is finally wired), with an explicit warning while the
  kill-switch is on and honest copy when no cap is set.
- **Approvals name what they govern**: rows now show and link the
  campaign (server-resolved name map), the action enum renders as human
  words via a shared adActionLabel, and both the header and the empty
  state state the approval threshold ("Changes above $50/day always stop
  here") — sourced from a new overview field, no more invisible env var.
- **The audit log is traceable**: actions render as human labels,
  ad_campaign targets link to the campaign, and denial rows show the
  guard's actual reason (after_json.reason, previously recorded but never
  displayed).
- **Disabled state labeled**: /ads and /ads/connect show an explicit
  "Ads isn't enabled on this workspace yet" banner (new ads_enabled
  overview field) and connect buttons disable, instead of a raw 409
  toast being the only signal.
- Validation: ruff clean, ads route tests green, tsc clean, next build
  clean.
- Next: Cycle 12 = re-audit (cycles 9-11) + Workstream 8/9 slices
  (ad-lane dropdown, repurpose save, front door) and the marketing
  truth-of-fence items.

## Cycle 12 (part 1) — 2026-08-19 · Workstream 8/10 slices
- **The UUID field is dead**: linking an ad campaign into a campaign lane
  is now a dropdown of your ad campaigns by name (best-effort fetch, empty
  when Ads is off, with a "Create an ad campaign" escape hatch); lane rows
  show the campaign's name instead of a uuid8.
- New-ad-campaign form: account options read "Google Ads — <name>" (no
  more "google ads — 3f2a1b9c"), and the no-accounts state links to
  /ads/connect.
- **Every route has a loading state now**: 15 new skeletons — /home,
  /campaigns(+detail), all seven /ads pages, /templates,
  /settings/billing, /settings/kits, /admin/media, /admin/templates —
  in the standard kicker+header+content pattern.
- Validation: tsc clean, next build clean. Re-audit of cycles 9–11
  running in parallel.

## Cycle 13 — 2026-08-19 · Workstream 9: One front door (quick wins)
- Topbar primary action is now context-aware: "New video" in Studio,
  "New article" in Press, "New ad campaign" in Ads, "New campaign" in
  Campaigns/Suite — no more global New-campaign button on the privacy page.
- Webhooks and Privacy join their siblings in the Suite sidebar (they were
  reachable only through the settings index); topbar breadcrumb labels for
  those routes come along for free.
- Help opens the FAQ in a new tab — it no longer ejects the user out of
  the authed shell with no way back.
- On /home the sidebar no longer falsely highlights Studio (the chrome
  stops disagreeing with itself); the Admin sidebar group renders only for
  admins, so non-admins never see a door that opens onto "Not authorized".
- Validation: tsc clean, next build clean.
- Remaining front-door work (logged): the full /home + /dashboard merge.

## Cycle 14 — 2026-08-19 · Fold of the Cycles 9–11 re-audit
- **F1 (HIGH)**: rejected jobs no longer count as pending work in the
  campaign budget projector (they could permanently stall a campaign's
  scheduling); also excluded from cadence "produced" totals (F4) and the
  admin active-jobs gauge (F2).
- **F3**: migration 0026 rollback now remaps the payload snapshot too, so
  rolled-back rejected rows don't vanish from listings.
- **F5**: a $0 ad cap audits as $0, not "cleared".
- **F6**: approvals page fetches independently — a failed enrichment can't
  blank the approvals list.
- **F7**: GuardrailsEditor remounts on account updates (no stale inputs).
- **F8**: ads toasts humanize 402s via toastActionError; unused import
  dropped.
- **Rejected discoverability**: the queue gains a "Rejected" filter with
  counts; the dead TERMINAL_STATUSES constant is deleted.
- **One review path**: queue rows now offer a single "Review" button into
  the Review Room for awaiting videos — no more blind approve/reject or
  window.confirm from a table row.
- **D2**: ads campaign detail shows its account's name, caps, and
  kill-switch state next to the budget form, with an Edit-guardrails link.
- **D5**: coming-soon pages (Insights, Creatives) render disabled with a
  "Soon" badge instead of being silently absent; campaigns-table account
  labels humanized (D4), guardrails "Enforced" line includes monthly.
- Validation: ruff clean, jobs/ads/approval tests green, tsc clean, next
  build clean.
- Deferred (logged): decided-approvals history view, per-day ad metrics
  table, marketing back-of-fence sweep.

## Cycle 15 — 2026-08-19 · Workstream 10: The back of the fence (marketing truth)
- **Fabricated social proof is gone**: the four invented testimonials +
  placeholder portraits + fake award marks become "Built to be trusted" —
  four first-party guarantees the product actually enforces, each with
  where to verify it; the fake customer-logo band becomes an honest
  "One brief ships to" destinations strip; the SOC2/GDPR/CCPA badge
  slots become truthful "Data & controls" claims (certification marks can
  join when real).
- Nav banner "See what shipped this week" → "See what's new" (the
  changelog's age no longer contradicts the banner).
- **Marketing channel sweep**: the word "niche" replaced with "channel"
  across 27 marketing files (guides, use-cases, features, resources,
  home sections), skipping API/code literals (niche_id, /niches routes,
  CLI and SDK samples stay accurate). Marketing and app now speak one
  language end to end.
- Validation: tsc clean, next build clean.
- Next: Cycle 16 = final full re-audit through the original lens; fold
  anything found; then assess loop completion against the goal.

## Cycle 16/17 — 2026-08-19 · Final re-audit + fold: ONE number
Final full re-audit verdict: ~30 of 45 original findings fully fixed, 8
partial, 7 remaining — "coherent, honest, humane — with one asterisk the
size of a price tag": the fix cycles had left four different prices for
the same video ($1.96 settings / $2.94 dialog / ~$3 marketing / $3.39+
server gate). This cycle closes it:
- **THE number**: new `POST /api/v1/niches/estimate` — the server's own
  gate/ledger arithmetic (portrait tier, LLM allowance, music-when-real,
  margin) — and every price surface now reads from it: run dialog
  (headline, button, cap math on the pre-margin figure, "agents & music
  allowance" breakdown line), onboarding step-2 preview + step-3
  videos/day, edit-form preview, SpendCapForm reference figure. The
  client rate card survives only as instant-feedback fallback. +1 test
  asserting endpoint ≡ gate arithmetic.
- Raw JSON toasts humanized at the last three holdouts (home hub,
  campaigns create, template remix); spend-cap failure rows show a human
  sentence instead of the guard's internal string.
- "You can never owe us money" replaced with the true statement (a few
  cents below zero, then it stops; no invoice ever).
- Templates finally keep their on-screen promise: the exact prompt is
  shown and copyable on every card.
- Stragglers: "Create niche" button, "Niche" kicker, privacy-list nouns,
  quickstart "QA", and the `profile_key` label → "Posting profile".
- Validation: ruff clean, jobs+niches tests green, tsc clean, next build
  clean.
- Remaining (ranked by the final audit, for future cycles): onboarding
  money moment, /home+/dashboard merge, Press stage rail + quality-grid
  scales, repurpose persistence, connect disconnect + named voices,
  caption edit / post now, x402 surfacing, design-system consolidation.

## Cycle 18 — 2026-08-19 · The money moment + Press gets the Studio treatment
- **Onboarding money moment** (final audit #2): step 3 now states the
  balance against the first render's actual charge ("Your balance is
  $0.00; the first render will charge about $3.39") with an Add-credit
  link that opens billing in a new tab so the wizard isn't lost — the 402
  is now impossible to hit unwarned.
- **Press production rail** (final audit #8): the article page shows
  "Step 3 of 6 · Writing sections" with the full stage list, replacing
  the permanent "Writing" kicker (now stage-accurate as well).
- **Quality scores make sense**: 0–1 model scores render as "82 / 100",
  keyword density as "1.2%", with one sentence naming the 60 pass bar and
  the healthy density range — no more unscaled 0.82 beside 0.01.
- Validation: ruff clean, tsc clean, next build clean.

## Loop conclusion — 2026-08-19
Eighteen cycles, four independent re-audits in between, all pushed green.
Final scorecard against STEVE_JOBS_AUDIT.md: ~35 of 45 findings fully
fixed, the rest partial or deliberately deferred. The final full re-audit's
verdict: "coherent, honest, humane" — its one asterisk (four different
prices for one video) and its top follow-ups (onboarding money moment,
Press rail, raw-JSON toasts, template promise) were closed in Cycles 17–18.

Remaining, deliberately left for product-owner direction (not autonomous
iteration):
1. The /home + /dashboard merge — the product's identity question.
2. Repurpose persistence (save & schedule social posts; needs a table).
3. Caption editing + Post now on the Review Room (backend params).
4. Connect: disconnect action + named voice picker (replacing raw
   ElevenLabs IDs); decided-approvals history; per-day ad metrics.
5. Design-system consolidation (15 files still mix the two kits) and
   x402 surfacing on billing/docs.
Restart with /loop anytime to continue into these.
