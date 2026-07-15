# Autonomous /goal — Apple redesign + Legal + x402 agent payments (30-cycle loop)

Persisted so progress survives restarts. Update DESIGN_X402_LOG.md as work lands.
Autonomous mode: free reign; loop until fully done, audited, and merged.

## /GOAL (final deliverable)
A shipped, deeply-audited marketer.sh with:
1. **Apple-grade design** — one sleek unified typeface (drop the quirky display
   face), gradient-text accents, generous whitespace, minimal/near-zero
   decorative borders, and **NO decorative icons** on legal / x402 / onboarding
   pages. De-"vibecoded" throughout.
2. **Comprehensive legal pages** — Terms, Privacy, Acceptable Use, Cookies,
   Subprocessors, DPA, Refund — text-first, no decorative icons.
3. **x402 agent payments** — agents pay for the platform themselves over HTTP
   402 (Coinbase x402: 402 envelope → `X-PAYMENT` → facilitator verify/settle →
   credit the user's prepaid balance). Config-gated, mocked in tests.
4. **Truly unique Apple-inspired onboarding** — full-bleed, minimal, gradient
   headline, motion, no decorative icons.

Everything green (ruff, pytest incl. real-PG, tsc, next build), migration-clean,
then **merged**.

## Design principles (the de-vibecode rubric)
- **Type**: one family (Geist) everywhere; display = tight tracking + large
  sizes, not a novelty font. A restrained gradient-text utility for hero words.
- **Space over ornament**: remove decorative icon tiles (AppIcon), ornamental
  lucide glyphs, and "weird" borders. Prefer whitespace + type hierarchy.
- **Borders**: hairlines only where they carry meaning (table rows, inputs);
  no boxed-in decorative cards on content pages.
- **Legal / x402 / onboarding pages: ZERO decorative icons.** Functional
  controls only.
- Keep it accessible (contrast, focus, reduced-motion) and theme-aware.

## Phases (deliverable + tasks)

### A. Design system de-vibecode (cycles 1-8)
1. **Type + gradient.** Unify on Geist (drop Bricolage); Apple-tight display
   tracking; `.text-gradient` utility (warm brand gradient) + sizes.
2. **Whitespace + borders.** Spacing rhythm; strip decorative borders; calmer
   cards.
3. **Icon audit (marketing).** Remove ornamental icons/AppIcon tiles from the
   landing + subpages; keep only functional ones.
4. **Home hero.** Rebuild the hero with gradient headline + open space.
5. **Marketing subpages.** Features / use-cases / pricing / resources refine.
6. **App shell.** Calmer sidebar/header chrome; less border noise.
7. **Primitives.** Buttons / cards / badges: lighter borders, more air.
8. **Verify.** Dark mode + reduced-motion + responsive; tsc + build.

### B. Legal pages (cycles 9-13) — no decorative icons
9. **Legal shell + prose.** `/legal` layout, clean typographic prose, footer nav.
10. **Terms of Service.**
11. **Privacy Policy** (GDPR/CCPA; ties to the existing data export/erasure).
12. **Acceptable Use + content/DMCA.**
13. **Cookies + Subprocessors + DPA + Refund**; wire footer + sitemap + robots.

### C. x402 agent payments (cycles 14-22)
14. **Design + config.** x402 flow, settings (x402_enabled, network, asset,
    pay-to address, facilitator url, price), models. Off by default.
15. **Migration.** `x402_payments` (facilitator tx id, payer, amount, credited,
    idempotent).
16. **Envelope service.** Build the 402 `accepts` requirements JSON (scheme
    `exact`, CAIP-2 network, USDC asset, payTo, maxAmount, resource, expiry).
17. **Verify/settle adapter.** Facilitator verify + settle; config-gated, lazy,
    mocked in tests (`X402Disabled` when off — never a 500).
18. **Paid top-up route.** `POST /api/v1/x402/credits`: no/invalid `X-PAYMENT`
    → 402 + envelope; valid → verify, settle, credit prepaid balance
    idempotently, return `X-PAYMENT-RESPONSE`.
19. **Opt-in gating helper.** Reusable dependency to 402-gate any agent endpoint.
20. **Crediting.** Reuse billing.credit_purchase idempotency keyed on tx id.
21. **SDK/MCP.** Agent-facing "get price → pay → retry" helper + tool.
22. **Tests.** 402 envelope shape, verify/settle mocked, idempotent credit,
    disabled-by-default, bad-payment rejection.

### D. Apple onboarding (cycles 23-28) — no decorative icons
23. **Architecture.** Multi-step, full-bleed, gradient headline, progress, no
    icons; route + state.
24. **Welcome + intent** step.
25. **First brand/channel** step (agent-assisted draft).
26. **Connect / skip** step.
27. **Motion + a11y.** Reduced-motion, focus order, keyboard, mobile.
28. **Finish → /home**; polish + copy.

### E. Audit + merge (cycles 29-30)
29. **Comprehensive deep audit.** Commission a ruthless review (design
    consistency, no-decorative-icons compliance on the 3 page groups, x402
    correctness + security, a11y); fix findings; full test matrix; migrations
    fresh-DB; ruff/pytest/tsc/build.
30. **Docs + MERGE.** README/legal/x402 docs; final gate; push branch; open +
    merge PR.

## Invariants
- Every landable unit: ruff clean + pytest green (incl. real-PG) + tsc clean +
  next build compiles.
- x402 external calls off by default, mocked in tests; crediting is idempotent.
- Legal / x402 / onboarding pages carry NO decorative icons.
- Commit locally per unit; single push at the merge (user authorized merge).

## Progress: see DESIGN_X402_LOG.md
