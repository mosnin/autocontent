# The plan screen, invite codes and pilot codes

Marketer is prepaid: a workspace buys packs of credit (Stripe Checkout,
`backend/routes/billing.py`) and every provider call debits it. Before this
change a new workspace finished onboarding and landed on a dashboard where
nothing could run. Now the **plan screen** sits between the two, and a
workspace can also get started with an **invite** or **pilot code**.

## When the plan screen shows

`GET /api/v1/billing/access` answers `needs_plan: true` when all of these hold:

- billing is on for the deployment (`MARKETER_BILLING_ENABLED`);
- the workspace's balance is zero or less;
- it has never bought a pack (no `purchase` row in `credit_transactions`);
- it has never redeemed a code.

Then:

- **Onboarding** still runs in full. The playbook is drafted from the person's
  own sentence and saved (that is the proof, before any payment). The first
  piece is not started (it would fail for want of credit). The last button,
  "Choose how to start", goes to `/plans?start=<playbook>&kind=video|article`
  (or `?next=` for paid media) instead of sending the `arrive` wave.
- **The app layout** sends any page to `/plans?next=<page>` while `needs_plan`
  is true, so closing the tab after onboarding doesn't skip it. An API that
  can't answer never blocks the app.
- **`/plans`** shows three packs (prices from the server) and the code flow.
  When credit arrives it starts the prepared piece and opens it, so the first
  dashboard view is that piece (RULES R5.3).

Once a workspace has bought or redeemed anything, the plan screen never comes
back. Running out of credit later is handled where it happens (the existing
402 and the balance in Settings → Billing).

### No purchase, no skip

There is no "Skip" on the plan screen. Without credit, every action in the
dashboard fails, so a skip would only lead to a broken first session. What the
person keeps without paying: their account, their workspace, the playbook
onboarding drafted, a way to redeem a code, and "Sign out". Members whose role
can't buy (`billing:manage`) see the packs disabled with one line asking an
owner, admin or billing member to add credit.

### Coming back from Stripe

Checkout is created with `return_to: "plans"`, so Stripe returns to
`/plans?purchase=success|cancelled` (a fixed choice; the client never sends a
URL). The piece to start is kept in `sessionStorage` for the trip. On success
the screen polls `/billing/access` every 2 seconds for up to 90 seconds while
the webhook credits the balance, then offers "Start my first video". Cancelled
shows "Checkout was cancelled. Nothing was charged." on the plans.

## Codes

| | Invite | Pilot |
|---|---|---|
| Prefix | `INV-` | `PLT-` |
| Meant for | A person a friend or someone at Marketer invited | A team in a pilot with us |
| Grants | `credit_usd` | `credit_usd` and/or `trial_days` |

- **Format:** `INV-7K2M-Q9XD-4T1B`: a prefix and 12 random Crockford base32
  characters (60 bits). Case, spaces and dashes don't matter, and O/I/L are
  read as 0/1/1.
- **Storage:** only `sha256(normalized code)` (`access_codes.code_hash`) and
  the last four characters (`code_hint`, so staff can tell codes apart). The
  code itself is shown once, to the platform admin who created it, and is
  never stored or logged. With 60 random bits the hash needs no pepper:
  guessing is bounded by the rate limit, not the hash.
- **Credit** goes through the ledger like a purchase: one `grant` row in
  `credit_transactions` (`reference = access-code:<code>:<tenant>`, unique)
  and the balance moves in the same transaction.
- **Pilot window:** `trial_days` sets `access_until` on the redemption and is
  shown to the workspace ("Your pilot runs until 26 December"). It doesn't
  meter or unlock spend on its own: credit pays for work. A pilot code with
  no credit still clears the plan screen (the team gets in; credit is
  arranged with us).
- **Limits:** `max_redemptions` workspaces per code, optional expiry, and a
  kill switch (`disabled_at`). One redemption per (code, workspace), ever.

### Redeeming

`POST /api/v1/billing/redeem {"code": "..."}`

- **Who:** `billing:manage` (owners, admins, billing members; the person who
  just onboarded is the owner). A person only: the agent and personal access
  tokens get `403 person_only`.
- **Rate limit:** 5 a minute and 20 an hour per workspace.
- **Answers:** `200` with what it unlocked (`kind`, `credit_usd`,
  `trial_days`, `access_until`), or a stable error code in `detail`:

| Status | `detail` | Shown as |
|---|---|---|
| 404 | `code_unknown` | We couldn't find that code. Check it and try again. |
| 410 | `code_expired` | That code is no longer active (also for a disabled code). |
| 409 | `code_used_up` | That code has been used as many times as it allows. |
| 409 | `code_already_redeemed` | This workspace has already used that code. |

- **Idempotent:** the code row is locked, the redemption insert is unique per
  (code, workspace), and the ledger reference is unique, so a retry or a
  double click can't grant twice.
- **Audit:** every attempt writes `billing.code_redeemed` to
  `security_audit_log`: `success` with the kind and amount, or `failure` with
  the reason. The attempted code is never written.

### Managing codes (platform admins)

| Route | |
|---|---|
| `GET /api/v1/admin/access-codes` | List (no hashes) |
| `POST /api/v1/admin/access-codes` | `{kind, credit_usd, trial_days, max_redemptions, expires_in_days, note}`; returns `code` once |
| `POST /api/v1/admin/access-codes/{id}/disable` | Stop it working |

All three are `PLATFORM_ADMIN` in `backend/policy.py` and audited in the admin
audit log (`access_code.created`, `access_code.list`, `access_code.disabled`).
There is no admin screen yet; use the API.

## Schema

`db/migrations/0034_access_codes.sql` (rollback alongside): `access_codes`,
`access_code_redemptions` (unique `(code_id, tenant_id)`), and a unique index
on code grants in `credit_transactions`.

## Tests

- `tests/test_access_codes.py`: routes (success, each failure code, person
  only, permission, rate limit, access read, admin routes), normalization.
- `tests/integration/test_pg_access_codes.py`: against Postgres: only a hash
  stored, one grant per workspace (also under concurrency), used up, expired,
  disabled, unknown, a pilot without credit.
