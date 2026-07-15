# Apple redesign + Legal + x402 — cycle log

Progress tracker for DESIGN_X402_GOAL (30 cycles). Newest at the bottom.

- Cycle 0: research + plan. x402 = Coinbase HTTP-402 protocol (402 envelope with
  `accepts` requirements → client retries with `X-PAYMENT` → facilitator
  verify+settle onchain USDC → `X-PAYMENT-RESPONSE`). Current display font is
  Bricolage Grotesque (the quirky "vibecoded" face) → unify on Geist. Wrote
  DESIGN_X402_GOAL.md. Merge authorized on completion. Starting cycle 1.

- Cycle 1 (type): unified on Geist (dropped Bricolage); Apple-tight display
  tracking (h1 -0.032em); --gradient-warm token + .text-gradient utility.
- Cycle 4 (hero): gradient-text payoff line on the marketing hero.
- Cycles 9-13 (legal): /legal shell (LegalDoc prose, LegalNav hairline) + 7
  documents (Terms, Privacy, Acceptable Use, Cookies, Subprocessors, DPA,
  Refund), footer + sitemap wired. Zero decorative icons.
- Cycles 14-22 (x402): config (off by default) + migration 0016 + services/
  x402.py (envelope, header decode, verify/settle) + POST /x402/credits
  (402 -> pay -> idempotent credit) + SDK/MCP. 11 tests (facilitator mocked).
- Cycles 23-28 (onboarding): Apple welcome experience framing the AI-draft
  flow; de-iconed end to end (dropped AlertTriangle/Link2/Sparkles/Pencil/
  arrows/platform-tile icons). Functional controls kept.
- Cycle 29 (audit): commissioned a ruthless review (x402 security, no-icons
  compliance, legal, design/a11y). Fresh-DB gate: 16 migrations apply,
  479 pytest green, ruff/tsc/build clean.
