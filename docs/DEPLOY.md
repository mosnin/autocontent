# Deploy runbook

Order matters: Modal and Vercel each need a value the other produces, so
the backend goes up first, then the web app, then the backend is updated
with the web app's domain.

App name is `marketer-sh` (`modal_app.py`), and the ASGI function is
`api()`, so the API URL will be:

```
https://<your-modal-workspace>--marketer-sh-api.modal.run
```

---

## Step 1 — create accounts, collect 5 values

| Service | What you need from it |
|---|---|
| Neon | Postgres **pooled** connection string, and the **direct** one |
| Clerk | publishable key, secret key, JWKS URL, issuer |
| OpenAI | API key |
| xAI | API key (the default video backend) |
| Modal | account, for `modal token set` |

Clerk's JWKS URL and issuer are on the API Keys page under "Show JWT
public key" / Frontend API URL. The app uses Clerk's **default session
token** (`getToken()` with no argument), so no custom JWT template is
needed.

---

## Step 2 — install tooling and authenticate

```bash
pip install -e .
modal token set --token-id <id> --token-secret <secret>
```

---

## Step 3 — create the seven Modal secrets

```bash
modal secret create marketer-database \
  MARKETER_DATABASE_URL='postgresql://<user>:<pw>@ep-xxx-pooler.<region>.aws.neon.tech/<db>?sslmode=require' \
  MARKETER_DATABASE_DIRECT_URL='postgresql://<user>:<pw>@ep-xxx.<region>.aws.neon.tech/<db>?sslmode=require'

modal secret create marketer-openai \
  MARKETER_OPENAI_API_KEY='sk-...'

modal secret create marketer-xai \
  MARKETER_XAI_API_KEY='xai-...'

modal secret create marketer-ayrshare \
  MARKETER_AYRSHARE_API_KEY=''

modal secret create marketer-clerk \
  MARKETER_CLERK_JWKS_URL='https://<app>.clerk.accounts.dev/.well-known/jwks.json' \
  MARKETER_CLERK_ISSUER='https://<app>.clerk.accounts.dev'

# These two MUST exist even when every value is empty. modal_app.py mounts
# them; a missing name fails deploy. Empty values keep features fail-closed
# until you fill them in — they will then reach production without another
# code change.
modal secret create marketer-extra \
  MARKETER_WEB_ORIGIN='' \
  MARKETER_APP_URL='' \
  MARKETER_BILLING_ENABLED='false' \
  MARKETER_STRIPE_SECRET_KEY='' \
  MARKETER_STRIPE_WEBHOOK_SECRET='' \
  MARKETER_CLERK_AUDIENCE='' \
  MARKETER_ALLOW_UNBILLED_USAGE='true' \
  MARKETER_BOOTSTRAP_ADMIN_EMAIL='' \
  MARKETER_RESEND_API_KEY='' \
  MARKETER_SENTRY_DSN=''

modal secret create marketer-providers \
  MARKETER_FAL_API_KEY='' \
  MARKETER_ELEVENLABS_API_KEY='' \
  MARKETER_OPENROUTER_API_KEY='' \
  MARKETER_EXA_API_KEY='' \
  MARKETER_WASABI_ENABLED='false' \
  MARKETER_COMPOSIO_API_KEY='' \
  MARKETER_INNGEST_SIGNING_KEY='' \
  MARKETER_INNGEST_EVENT_KEY='' \
  MARKETER_CONTEXT_DEV_API_KEY='' \
  MARKETER_MUAPI_API_KEY='' \
  MARKETER_PEXELS_API_KEY='' \
  MARKETER_PIXABAY_API_KEY='' \
  MARKETER_RESEND_API_KEY=''
```

Quote every value — connection strings and keys contain characters the
shell will otherwise eat.

**Neon gives you two connection strings and you need both.** The pooled
host has `-pooler` in it; the direct host does not. Copy them from the
Neon dashboard's connection widget by toggling "Connection pooling".

- `MARKETER_DATABASE_URL` — the **pooled** one. Modal starts a container
  per invocation, so a direct endpoint runs out of connections fast.
- `MARKETER_DATABASE_DIRECT_URL` — the **direct** one, used only by
  migrations. A pooler runs PgBouncer in transaction mode, where a
  multi-statement DDL migration can land on different backends mid-run.

Keep `?sslmode=require`; Neon refuses plaintext connections.

`marketer-ayrshare`, `marketer-extra`, and `marketer-providers` can be
empty for now, but each secret must **exist**: `modal_app.py` names all
seven, and a missing one fails the deploy.

---

## Step 4 — run migrations, then deploy the backend

Migrations run on Modal, so no local database access is needed. This
order is required — schema before code:

```bash
modal run modal_app.py::apply_migrations
modal deploy modal_app.py
```

`apply_migrations` is idempotent; yoyo records what it has applied.

Copy the URL Modal prints. Confirm it:

```bash
curl https://<workspace>--marketer-sh-api.modal.run/healthz
```

---

## Step 5 — deploy the web app on Vercel

Import the repo. **Set the root directory to `web/`.**

Environment variables (Production and Preview both):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = pk_...
CLERK_SECRET_KEY                  = sk_...
NEXT_PUBLIC_API_BASE_URL          = https://<workspace>--marketer-sh-api.modal.run
NEXT_PUBLIC_SITE_URL              = https://<your-domain>
```

No `MARKETER_*` variable belongs here. Deploy, then copy the domain.

---

## Step 6 — give the backend the web domain, redeploy

CORS rejects the web app until `MARKETER_WEB_ORIGIN` matches its origin
exactly (scheme, host, no trailing slash). If `WEB_ORIGIN` is empty the
API now falls back to `MARKETER_APP_URL`. `marketer-extra` is already
mounted — update the secret, then redeploy:

```bash
modal secret create marketer-extra \
  MARKETER_WEB_ORIGIN='https://<your-domain>' \
  MARKETER_APP_URL='https://<your-domain>'
```

If the secret already exists, edit it in the Modal dashboard (or
recreate it) rather than adding a second `from_name` line.

```bash
modal deploy modal_app.py
```

---

## Step 7 — verify

```bash
python -c "import sys;sys.path.insert(0,'src');\
from marketer.services.preflight import run_preflight;\
r=run_preflight();print(r.overall_status);\
[print(c.to_dict()['status'], c.to_dict()['capability']) for c in r.checks]"
```

Then in a browser: sign up, land on the dashboard, create a niche.

---

## Step 8 — enable optional features

Each is off by default and fails closed. For every one: add the keys to a
Modal secret, make sure that secret is in `modal_app.py`, and redeploy.

| Feature | Flag | Also needs |
|---|---|---|
| Voiceover / music | — | `MARKETER_ELEVENLABS_API_KEY` |
| Alt video provider | — | `MARKETER_FAL_API_KEY` |
| Social publishing | — | `MARKETER_AYRSHARE_API_KEY`, `MARKETER_AYRSHARE_WEBHOOK_SECRET` |
| Billing | `MARKETER_BILLING_ENABLED=true` | `MARKETER_STRIPE_SECRET_KEY`, `MARKETER_STRIPE_WEBHOOK_SECRET` |
| Ad creative studio | `MARKETER_AD_CREATIVE_ENABLED=true` | `MARKETER_CONTEXT_DEV_API_KEY` |
| SEO auditor | `MARKETER_SEO_AUDIT_ENABLED=true` | `MARKETER_CONTEXT_DEV_API_KEY` |
| UGC studio | `MARKETER_UGC_ENABLED=true` | `MARKETER_MUAPI_API_KEY`, `MARKETER_MUAPI_WEBHOOK_URL`, `MARKETER_MUAPI_WEBHOOK_SECRET` |
| Article research | — | `MARKETER_EXA_API_KEY` |
| Stock b-roll | — | `MARKETER_PEXELS_API_KEY` |
| Email | — | `MARKETER_RESEND_API_KEY`, `MARKETER_EMAIL_FROM` |
| Media storage | `MARKETER_WASABI_ENABLED=true` | bucket, access key, secret key |
| Paid ads | `MARKETER_ADS_ENABLED=true` | `MARKETER_COMPOSIO_API_KEY` + the two auth config IDs |

Stripe and MuAPI webhooks point back at the Modal URL:

- Stripe: `https://<api>/api/v1/billing/webhook`, event `checkout.session.completed`
- MuAPI: whatever you set as `MARKETER_MUAPI_WEBHOOK_URL`

---

## Local development

```bash
cp .env.example .env          # fill in the same MARKETER_* values
python scripts/migrate.py up  # or: status / down N
uvicorn backend.main:create_app --factory --reload --port 8000

cd web
cp .env.local.example .env.local
# NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm install && npm run dev
```

Modal does not read `.env`; the local file and the Modal secrets are
separate copies of the same values.

---

## Gotchas

1. **`OPENAI_API_KEY` is never read.** `config.py` sets
   `env_prefix="MARKETER_"`. It must be `MARKETER_OPENAI_API_KEY`.
2. **Seven secrets must exist.** `marketer-extra` and `marketer-providers`
   are mounted alongside the original five. A missing name fails deploy;
   empty values keep the feature fail-closed until you fill them in.
3. **`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is read at build time.** Changing
   it requires a redeploy, not just a restart.
4. **Migrations before deploy.** Code expecting a column that does not
   exist yet fails at request time, not at deploy time.
5. **`MARKETER_WEB_ORIGIN` must match exactly** — no trailing slash.

---

**Not verified:** this runbook is assembled from `modal_app.py`,
`config.py`, `scripts/migrate.py`, `db.py`, the preflight service and the
`web/` tree. Nobody has executed it end to end against live Neon,
Clerk, Modal and Vercel accounts.
