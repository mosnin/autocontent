# Agentic Ads Cycle Log (of 30)

See `AGENTIC_ADS_GOAL.md` for the phase breakdown.

- **Cycle 0 — survey + plan.** Cloned and surveyed all 8 source repos.
  Findings that changed the plan:
  - Four of the seven ads repos (`meta-ads-kit`, `google-ads-copilot`, and
    both TikTok CLIs in part) are **Claude Skills, not libraries** — 83 md
    files in google-ads-copilot alone. The valuable payload is encoded
    operator judgement, which maps onto the `formats/gotchas.py`
    precedent rather than onto a client library.
  - `gemini-cli-googleadsagent` is a 2261-file fork of the Gemini CLI.
    Not portable; mine its a2a ideas only, vendor nothing.
  - `pipeboard-co/meta-ads-mcp` (87 py) is the one real implementation
    reference for the Meta Marketing API.
  - `cloudflare-os` is a TS/Workers monorepo. **We port the concept, not
    the code.** Its one novel idea — Gatekeepers that *simulate* an
    action and collect approvals in bulk instead of blocking the agent —
    is the spine of this plan, and it directly answers a real weakness in
    our existing `ad_actions_exec.py` (park-and-stop).
- **Cycle 1 — Gatekeeper core (Phase 1).** `src/marketer/gatekeeper/`:
  `Capability` (policy / simulate / apply), `Decision`/`Verdict`
  (allow / deny / speculate), `Outcome` (always labelled speculative),
  and the `Gatekeeper` broker. 12 tests.
  The load-bearing decisions are the refusals: a capability with no
  simulator, a caller that declared it cannot accept a speculative
  result, and a missing intent store all escalate to DENY rather than
  falling back to applying the action. A stranded intent — agent believes
  it succeeded, no human can ever approve it — is the one unrecoverable
  state, so it is unreachable by construction.
  Audit is asymmetric on purpose: a broken sink never fails an ALLOW
  (the platform call is its own record), but a store failure on a
  SPECULATE is fatal.
- **Cycles 2-4 — intent store, reconciliation, divergence (Phases 2-4).**
  Migration 0039 (`gatekeeper_intents` + append-only `gatekeeper_audit`),
  `repos/gatekeeper.py`, `gatekeeper/reconcile.py`,
  `gatekeeper/registry.py`, `gatekeeper/production.py`, and the approval
  inbox at `/api/v1/gatekeeper` (5 routes). Applying runs on a 4-minute
  Modal cron, never in-request. 31 gatekeeper tests; suite 2388 passed.
  Decisions worth remembering:
  - **Claim before the external call.** A crash mid-apply leaves a row
    the reaper can find; claiming after risks two workers both calling
    the platform, and double-spending real money is worse than a
    stranded row a human investigates.
  - **Divergence is conservative but not noisy.** `compare` reports a
    difference whenever it cannot prove equivalence, but ignores extra
    platform fields we never made a claim about — over-reporting would
    train operators to ignore the one signal that makes speculation
    defensible.
  - **Capability names are permanent.** Intents resolve by string days
    later, so `register` refuses to overwrite a name (a load-order
    dependent money bug) and `resolve` returns None rather than raising
    (an exception would stop the queue and strand other operators'
    approvals behind it).
  - Bulk decide is one statement, so a partially-applied bulk approval
    cannot exist; already-decided rows are skipped, not fatal.
  - A dedicated table rather than reusing `ad_approvals`: an intent is
    generic over every capability and stores the SIMULATED result, which
    is what makes divergence detection possible at all.
