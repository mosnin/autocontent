# Autonomous /goal — agentic advertising + the Gatekeeper spine (30 cycles)

Persisted so progress survives container restarts. Update
`AGENTIC_ADS_LOG.md` as work lands. Follows the same convention as
`AUTONOMOUS_GOAL.md` / `CYCLE_LOG.md`.

## North star

marketer.sh already produces media autonomously. It does **not** yet
*advertise* autonomously: the Ads product can govern spend, but an agent
cannot plan a campaign, write the creative, launch it, read what happened,
and change its mind — end to end, safely, without a human in the critical
path.

That gap is the whole goal. When this is done, an operator states an
outcome ("$50/day, these three products, get me profitable ROAS on Meta
and Google") and the system runs it: research → structure → creative →
launch → measure → optimise → report, with every money-moving action
policy-checked, simulated, and reversible.

## The strategic decision, stated up front

**We are not porting Cloudflare OS.** It is a TypeScript monorepo on
Cloudflare Workers; we are Python/FastAPI on Modal plus Next.js. Adopting
it wholesale is a runtime rewrite, not an integration, and it would buy us
nothing we cannot build in a week.

What we take is its one genuinely novel idea, which is worth more than the
code: **Gatekeepers with speculative execution.**

Today, `services/ad_actions_exec.py` parks any above-threshold action as a
pending approval and stops. Cloudflare OS's insight is that synchronous
approval is why people end up running agents with
`--dangerously-skip-permissions`: the agent stalls on step one, so
operators disable the guardrail entirely. Their answer is to let the
Gatekeeper **simulate** the action, tell the agent it succeeded, serve
simulated read-backs, and queue the real effect for **bulk approval
later**. The agent keeps working; the human approves when convenient; the
guardrail survives contact with reality.

That is the spine everything else hangs off, and it generalises past ads to
every external system we touch.

## What each source repo actually contributes

Surveyed, not assumed:

| Repo | Shape | What we take |
| --- | --- | --- |
| `TheMattBerman/meta-ads-kit` | 15 md, 14 sh — **skills, not code** | The *playbooks*: budget-optimizer, ad-copy-generator, ad-creative-monitor, pixel-CAPI, ad-upload. Operator judgement encoded as rules. |
| `pipeboard-co/meta-ads-mcp` | 87 py — real implementation | Meta Marketing API surface: ad-set creation, creative assembly, image crops, duplication, DSA compliance. The closest thing to a reference client. |
| `TheMattBerman/google-ads-copilot` | 83 md — **skills** | 12 playbooks: audit, structure, RSAs, negatives, search-terms, intent-map, tracking, landing-review, daily. This is the Google Ads operating manual. |
| `itallstartedwithaidea/gemini-cli-googleadsagent` | 2261 files — a Gemini CLI **fork** | Not portable. Mine its a2a-server agent-to-agent protocol ideas only. Do not vendor. |
| `bin-huang/tiktok-ads-cli` | 12 ts | TikTok Ads API surface: advertiser, campaigns, adgroups, creatives, audiences, reporting. |
| `abbasam8910/TikTok-Ad-Agent-CLI` | 7 py | A compact agent loop + tool schema over TikTok ads. Read `PROMPT_DESIGN.md`. |
| `jshorwitz/awesome-agentic-advertising` | curated list | Landscape/positioning input. No code. |
| `cloudflare/cloudflare-os` | 420 ts | The Gatekeeper pattern + speculative execution. Concept only. |

**The pattern across the ads repos is that the valuable part is prose, not
code.** Four of them are Claude Skills — encoded operator judgement about
what to actually do with a Google Ads account. That maps directly onto our
existing `formats/gotchas.py` precedent: distilled craft as structured
data, with the *why* preserved.

## Phases

Each phase is one or more cycles. Every phase ends green: ruff + pytest +
tsc + `next build`, and nothing committed that is half-wired.

### Spine (1-6)

1. **Gatekeeper core.** `services/gatekeeper/` — a typed capability broker.
   Every external side effect declares a capability, a policy, and a
   simulator. Generalises `ad_actions_exec.py` rather than replacing it.
2. **Speculative execution.** Simulate an action, return a plausible
   result, record the intent. The agent proceeds; nothing external moved.
3. **Reconciliation + bulk approval.** An inbox of speculated actions;
   approve/reject singly or in bulk; apply in dependency order; re-guard at
   apply time; single-use, no replay.
4. **Divergence detection.** When a simulated read-back later contradicts
   reality, say so loudly. This is the failure mode speculative execution
   introduces and the one thing that makes it dangerous if unhandled.
5. **Gatekeeper audit + provenance.** Every simulate/approve/apply/deny is
   append-only, with actor, policy verdict, and the diff it caused.
6. **Retrofit the existing choke point.** `ad_actions_exec` becomes a
   Gatekeeper capability. No behaviour change without a flag.

### Platform clients (7-12)

7. **Meta Ads client** — from `meta-ads-mcp`: campaigns, ad sets, creatives,
   insights. Pinned, typed, mocked in tests.
8. **Meta creative assembly** — image crops, DSA fields, ad upload.
9. **Google Ads client** — campaigns, ad groups, RSAs, keywords, negatives,
   search terms.
10. **TikTok Ads client** — from both TikTok repos: advertiser, campaigns,
    adgroups, creatives, audiences, reporting.
11. **Unified ad-platform seam.** One interface, three implementations, so
    the agent reasons about "a campaign", not about three vendor dialects.
12. **Insights normalisation.** One metrics shape across platforms; spend,
    impressions, clicks, conversions, ROAS, comparable and stored once.

### Playbooks (13-18)

13. **Playbook engine.** Skills-as-data: a playbook is a named, versioned
    set of checks and actions with preconditions. Mirrors
    `formats/gotchas.py`.
14. **Google Ads playbooks** — audit, structure, RSAs, negatives,
    search-terms, intent-map, tracking, landing-review, daily.
15. **Meta playbooks** — budget-optimizer, ad-copy-generator,
    creative-monitor, pixel/CAPI health.
16. **TikTok playbooks** — creative refresh cadence, audience expansion.
17. **Cross-platform budget allocator** — move spend toward what is working,
    inside caps, every move a Gatekeeper action.
18. **Creative feedback loop.** Wire the existing ad-creative studio,
    headshots, UGC and motion output into ad creative, with performance
    read back onto the creative that produced it.

### Autonomy (19-22)

19. **Campaign agent.** Outcome in, plan out: research → structure →
    creative → launch, entirely through Gatekeepers.
20. **Optimisation loop.** Scheduled: read insights, run playbooks, propose
    changes, speculate, queue for approval.
21. **Autonomy levels.** Per-account: propose-only → approve-in-bulk →
    bounded-autonomous, with hard money ceilings at every level.
22. **Explainability.** Every action answers "why did you do that" from
    stored evidence, not from a re-prompt.

### UI (23-26)

23. **Editorial rollout, continued** — `/motion`, `/queue`, `/dramas`,
    `/library`, `/dashboard` onto the editorial system; `SpendMeter` finally
    used where money is spent.
24. **The approval inbox** — the product's most important new surface.
    Bulk review of speculated actions with their simulated diffs.
25. **Campaign command surface** — one live view of spend, pacing,
    creative performance and pending decisions.
26. **`/articles/[id]/edit`** — the outstanding CMS page (client already
    landed and unused).

### Hardening + real-world (27-30)

27. **Money-path integration tests** against real Postgres: guard, cap,
    approval, reconciliation, idempotency, replay refusal.
28. **Adversarial pass** — prompt injection through ad copy and landing
    pages, replay, cross-tenant reads, simulated/real divergence.
29. **Sandbox validation** — every platform client against its vendor test
    account. No real spend. This is the gate before any live money.
30. **Ship readiness** — preflight coverage for every new key, runbook,
    rollback per migration, load check on the optimisation cron.

## Hard rules (non-negotiable, every phase)

- **Fail closed.** Flag off or key missing ⇒ clean 409. Never a 500, never
  an ImportError, never a silent no-op.
- **Metered.** Every LLM/image/video call through `SpendContext`. Every
  platform spend action through the Gatekeeper.
- **No vendored runtimes.** Concepts port; TypeScript monorepos do not.
- **Craft knowledge keeps its reasons.** A rule ported from a skill without
  the failure it prevents is just a string.
- **Tests prove the money path**, not the happy path.
- **One component kit, one design system.** See
  `tests/test_web_design_system.py`.

## Known-open from prior loops

- `/articles/[id]/edit` — CMS API live, client landed, page never written.
- 36 pipeline tests fail in this container for lack of
  `MARKETER_DATABASE_URL`; identical on the parent commit. Environmental.
- 224 distinct lucide icons — cut hard as the editorial rollout proceeds.
