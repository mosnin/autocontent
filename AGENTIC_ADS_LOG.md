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
