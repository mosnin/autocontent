# Value case and claim registry

Version 1, 2026-09-12. Local source evidence, not Company OS context or verified customer results. Skill methods applied by the implementing agent; no independent agent review.

| ID | Capability → mechanism → possible benefit → customer outcome | Evidence and limit | Copy treatment |
| --- | --- | --- | --- |
| V1 | Scene pipeline → script, visuals, narration and captions in one workflow → fewer separate production handoffs → a reviewable product explanation | src/marketer/pipeline.py; services/run_estimate.py; source-only, not measured time saving | Create product videos from a brief; retain reviewer responsibility |
| V2 | Article pipeline → research/outline/draft/meta → a concrete editorial starting point → publish useful answers | src/marketer/articles/pipeline.py; no ranking evidence | Answer buyer questions; no traffic guarantee |
| V3 | Ad drafts and approvals → inspect proposed campaign → deliberate launch decisions → controlled campaign preparation | backend/routes/ads* and app ads routes; provider availability not exercised | Review before authorizing; media spend separate |
| V4 | Saved channels/scheduling → reusable direction and calendar → repeatable work → sustainable publishing routine | models/schemas.py, products.ts and scheduling routes | Good-fit hypothesis, not an observed behavior claim |
| V5 | Meter and budget checks → estimates/reservations/settlement → cost visibility → informed production decisions | spend_context.py, run_estimate.py, billing/packs.py | Generation consumes credit; rejected/partial work can cost money |
| V6 | API/SDK/CLI/MCP → programmatic work → connect an existing agent workflow → usable production output | interface routes and docs; not live integration proof | Inspect final job status; accepted request is not completion |
| V7 | Original campaign artwork → inspectable visual direction → understand creative medium | campaign-media.ts says fictional imagery for the website | Caption as illustrative artwork, not customer result or unretouched pipeline proof |
| V8 | Proposed base fee plus included credit → predictable commitment and variable production → choose suitable operating scope | PRICING.md; proposed unvalidated prices and entitlements | Clearly unavailable monthly plans; no fake subscription checkout |

Alternatives include manual writing/editing, existing point tools, an agency, and doing less content. Manual work retains direct craft and avoids setup; existing tools may already be paid for; a human production team may be preferable for precise likeness, original reporting, or sensitive claims. No cross-tool savings comparison was measured. No buyer ROI calculator is used: time, revision rate, adoption, and economic value are unknown.

Net value hypothesis requires accurate briefs, enough repeat work to justify setup, reviewer time, acceptable creative output and useful distribution. More drafts can make net value worse if review burden or paid retries grow. Compare completed reviewed pieces on the same period and quality basis, not raw generation counts. Observe learning and refusal as well as purchase intent.
