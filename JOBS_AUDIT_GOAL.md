# Autonomous /goal — Fix the Steve Jobs audit (self-paced loop)

Persisted so progress survives container restarts. Update JOBS_AUDIT_LOG.md as
cycles land. Branch: `claude/steve-jobs-audit-wty1fw`. Source of truth for the
findings: `STEVE_JOBS_AUDIT.md` (every claim carries file:line evidence).

## /GOAL (final deliverable)
Every issue in STEVE_JOBS_AUDIT.md fixed — nothing cut, everything finished —
verified by fresh audits between iterations, until a re-audit through the same
lens finds the product coherent, honest, and humane. Loop shape: fix cycle →
commit + push → re-audit the touched surfaces → next cycle, repeat.

## Workstreams (from the audit's Part VIII/IX, in priority order)
1. **Freeze the lie** — marketing pricing math honest (post-margin numbers),
   "no card required" / "fifty cents" / "8–12 videos" corrected; pricing tiles
   stop implying feature gating their own FAQ denies; claims the product
   doesn't back ("balance on dashboard at all times", "exact cost after")
   either become true or leave the page.
2. **The $0 first run** — credit checked at enqueue (402 with a human message,
   not a deep-pipeline SpendCapExceeded); out-of-credit moments carry an
   "Add credit" action; Failures inbox hidden when empty; spend/credit failure
   rows link to billing, not just Retry.
3. **Glossary purge** — "channel" everywhere (drop "niche" from user-facing
   copy); product names aligned app ↔ marketing (rename the "Studio" credit
   pack); one meaning of "campaign" per surface; kill pipeline/enqueue/spawn/
   QA/job from user copy; humanize every enum at the choke points; no raw
   UUIDs or `{"detail":…}` JSON in the UI.
4. **First video on channel creation** — wizard's last step offers render-now;
   staged progress view (step N of M, scene N of M) on the job page.
5. **The Review Room** — approve/reject where the video plays, editable
   caption, Approve & schedule / Post now / Reject-with-reason; rejection is a
   decision, never "Failed"; unify the image-post approval surface.
6. **Money transparency** — post-margin numbers everywhere (estimator,
   run-confirm, settings); per-video receipt (estimate vs actual); balance in
   the shell; ledger rollups + pagination + 4-decimal precision; caps and
   billing co-located; confirm step before Stripe redirect; fix
   "never owe us money" vs negative-balance debit.
7. **Ads governance UI** — caps/kill-switch/approval-threshold visible and
   editable on the account card; approvals name + link their campaign; audit
   log links target_id and shows denial reasons; disabled-ads state labeled.
8. **Sew the suite** — ad-lane UUID field becomes a select; repurposed posts
   get save/schedule; article→video and content→ad bridges; calendar anchored
   on publish intent; connect page honesty + disconnect.
9. **One front door** — merge /home + /dashboard story; chrome never disagrees
   about location; context-aware topbar primary button; Webhooks/Privacy in
   sidebar; Help stays in-app.
10. **Back of the fence** — remove fabricated testimonials/logos/compliance
    badges; changelog honest; dead code deleted (unused sidebar kit, switcher,
    dead marketing components); one design system; skeletons match pages;
    loading states for Ads + product landings; middleware covers /campaigns,
    /library, /templates; "Soon" hints rendered; video Download button;
    empty states all carry their action.

## Loop protocol
- Each cycle: pick the highest-priority unfinished workstream slice small
  enough to land green, implement, validate, commit, push, log it.
- **Audits in between**: after every 2–3 fix cycles, run a re-audit pass over
  the changed surfaces with fresh eyes (subagent walkthrough as a new
  customer); append findings to JOBS_AUDIT_LOG.md; fold regressions into the
  next cycle before starting new work.
- Done = a full re-audit finds no remaining item from STEVE_JOBS_AUDIT.md and
  no new violations of the same principles.

## Invariants (never break)
- Python: ruff clean, pytest green before every push.
- Web: tsc clean + next build compiles before every push.
- No feature removed — finished, not cut. (Deleting dead/unused code and
  fabricated marketing content is explicitly in scope, per the audit.)
- Every claim on the marketing site must be true of the product as shipped.
- Commit + push to `claude/steve-jobs-audit-wty1fw` after each landable unit.

## Progress: see JOBS_AUDIT_LOG.md
