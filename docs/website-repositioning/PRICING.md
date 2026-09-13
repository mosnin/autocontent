# Proposed monthly pricing

Status: reviewable commercial proposal, 2026-09-12. No subscription catalog, charges, or entitlements changed. Public preview clearly identifies unavailable plans. Company OS financial/customer context and actual invoices unavailable. Owner acceptance, real cohort economics, billing implementation, and customer willingness to pay remain gates.

## Recommended packaging

| Plan | Monthly base, USD | Included generation credit | Active content channels | Proposed scope |
| --- | ---: | ---: | ---: | --- |
| Launch | $49 | $20 | 1 | Video, articles, all creative formats, review, manual scheduling, library, basic analytics |
| Grow | $149 | $75 | 5 | Launch plus recurring production, SEO audit, campaign planning, ad draft workflows |
| Scale | $399 | $200 | 20 | Grow plus API/SDK/CLI/MCP workflows, webhooks, channel budgets and reporting |

A content channel is a saved brief/voice/schedule, not a tenant, brand workspace, social connection, seat, or permission boundary. Basic account spend controls, consent, review, export access and security must remain available in every plan. Channel reporting is a management feature; account financial visibility cannot be withheld. No unlimited generation, premium-support SLA, client portal, or team seats are promised. Entitlement gating is proposed work, not implemented functionality.

$1 credit = $1 in retail metered production charges. Existing meter is provider usage times configured billing_margin (source default 1.5), not a fixed unit per video. Do not introduce opaque points or guarantee output counts. Prices exclude applicable tax. Monthly cancellable renewal; no annual discount until retention and support costs are understood. Existing $5/$20/$50 one-time packs remain today’s purchasable offer with current access intact.

Included credit refreshes each paid billing period and does not roll over; optional purchased top-ups retain current nonexpiry terms and are consumed after the included allowance. No automatic overages or top-up by default. Proposed cancel-at-period-end with existing paid access through the period. Preserve unused purchased credit and historical entitlements when designing migration. Do not retroactively apply new limits. Written notice and explicit choice before any subscription enrollment.

## Why this proposal

Platform access pays for persistent workflow utility; metered generation keeps expensive model usage bounded. Launch is usable for evaluating one publishing routine. Grow addresses multiple streams and repeatable work. Scale targets builders/operators whose automation usage adds operational burden. Higher tiers do not claim higher-quality models or stronger fundamental protection.

Alternatives: keep pay-as-you-go for sporadic users; one $99 base plan with $40 credit for simpler selection; pure credits if recurring value is not demonstrated. Current research does not establish that $49/$149/$399 is optimal or that these feature boundaries improve conversion. API gating may discourage acquisition by builders; test it against offering limited API access on every plan before finalizing.

## Source-grounded economics and stress cases

Inspected src/marketer/config.py declares billing_margin=1.5; services/spend_context.py reserves and settles generation charges; services/run_estimate.py estimates model-dependent jobs. This is a source default, not observed hosted margin or validated provider invoice. Web cost estimates omit some production steps and are not sufficient for a fixed-video promise. No competitor cost figures or customer budgets are used to set willingness to pay.

At complete allowance use, nominal provider cost = included retail credit / 1.5. Sensitivity models multiply this cost by 1.0/1.5/2.0 to represent pricing drift, leakage or unmetered work. Hypothetical payment expense is 3% of base + $0.30; hypothetical fixed monthly delivery/support is $10/$25/$60. These are assumptions, not current processor rates or observed support costs. See economics.csv. Contribution excludes acquisition, tax, fixed company payroll, refunds and unknown publishing-provider profile costs; it is not profit. Unknown costs must be collected before launch. Low usage increases apparent margin but can signal poor customer value; never rely on breakage to justify pricing.

Stress cases: at zero usage monitor activation and cancellation; at full allowance verify contribution; at exhausted allowance pause paid production or use explicitly purchased credit; failed operations settle actual paid steps without double charging; refunds reverse the correct source balance; downgrades block new excess channels after notice rather than delete work; cancellation preserves retrieval under the final retention policy. Retain existing purchases and terms. Separate platform media spend in all messaging.

## Metering and rollout work needed

Billing needs a versioned subscription catalog, authoritative entitlement checks, account billing-period grants, separate included/purchased credit ledgers, idempotent webhook grant/revoke logic, reversal handling, upgrade/proration/cancel policies, failed-payment recovery, reconciliation, and tests for duplicate/out-of-order events. Use period grants once per paid invoice, consumption oldest-expiring included credit first, decimal USD accounting, atomic reservation/settlement, release unused holds, explicit same-period late usage policy, and owner-reviewed disputes. Do not overload current prepaid purchase metadata.

No automatic enrollment or migration. Stage entitlement enforcement before exposing purchase links. Test sandbox invoices, renewals, refunds, disputed payments and cancellation; reconcile then inspect a bounded live purchase only with separate authorization. Rollback hides subscription purchase and preserves balances/receipts; it cannot simply reverse an already fulfilled charge.

## Validation plan

Interview users about the last content task and current alternatives, without leading with these prices. Observe first-draft completion, reviewed publication, setup time, revision spend and recurring usage. Test whether users can explain the base fee, dollar credit, separate ad spend and rollover policy. Pilot only after billing and permissions work is accepted. Primary outcome: paid retention among customers achieving a reviewed publishing routine. Guardrails: refund requests, cost surprises, queue failures, support burden and opt-out clarity. Pause exposure on misleading bills or negative full-usage contribution; revise feature boundaries when users cannot complete the advertised job.

Market reference check: official Jasper pricing (https://www.jasper.ai/pricing), Copy.ai plans (https://www.copy.ai/prices), and Buffer pricing (https://buffer.com/pricing) read via web search on 2026-09-12. Jasper documentation describes a platform-fee-plus-credits approach (https://help.jasper.ai/hc/en-us/articles/46644376016923-Credits-Based-Pricing). These demonstrate alternative packaging, not Marketer’s willingness to pay or equivalence of products. Do not use unsourced competitor savings claims on the site.
