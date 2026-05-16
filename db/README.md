# db

Supabase Postgres schema for autocontent. Migrations are plain SQL files,
applied in filename order.

## Apply

```bash
export SUPABASE_DB_URL="postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
for f in db/migrations/*.sql; do
  psql "$SUPABASE_DB_URL" -f "$f"
done
```

Use the **pooler** (`pgbouncer`) connection string for the runtime app
(Modal containers are short-lived); use the direct connection for
running migrations.

## Tables

- `users` — Clerk-owned identity (PK is Clerk's `user_id`).
- `niches` — per-user content channels with generation prefs, posting
  windows, daily spend cap, and Ayrshare profile.
- `jobs` — one row per pipeline run; `payload` jsonb holds the full
  in-memory `Job` snapshot for resumability.
- `spend_ledger` — every credit-spending API call. Sum by
  `(user_id, niche_id, date)` to enforce the daily cap.
