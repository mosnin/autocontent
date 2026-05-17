# db

Supabase Postgres schema for autocontent. Migrations are plain SQL files
managed by **yoyo-migrations** — a lightweight, file-based runner that
records applied versions in a `_yoyo_migration` table it creates automatically.

## Workflow

### Local development

Apply all pending migrations:

```bash
autocontent-migrate up
```

Check which migrations are applied vs. pending:

```bash
autocontent-migrate status
```

Roll back the last migration:

```bash
autocontent-migrate down
```

Roll back the last N migrations:

```bash
autocontent-migrate down 3
```

The tool reads `AUTOCONTENT_DATABASE_URL` from your environment (or `.env`).

### Modal (production)

Modal does not have native pre-deploy hooks. Run migrations manually
**before** deploying new application code:

```bash
modal run modal_app.py::apply_migrations
modal deploy modal_app.py
```

`apply_migrations` is idempotent — already-applied migrations are skipped.

### Health check

`GET /healthz/deep` reports migration status under the `migrations` key:

```json
{
  "ok": true,
  "checks": {
    "migrations": {"ok": true, "applied": 3, "pending": 0},
    ...
  }
}
```

If `pending > 0`, the endpoint returns **503** — pending migrations in
production indicate the deploy sequence was not followed.

## Adding a new migration

1. Create `db/migrations/NNNN_descriptive_name.sql` where `NNNN` is the next
   sequential number (zero-padded to 4 digits).
2. Create the companion `db/migrations/NNNN_descriptive_name.rollback.sql`
   with the reverse SQL (e.g. `DROP TABLE` for a `CREATE TABLE`).
   - If the migration is non-reversible (e.g. a destructive data migration),
     leave the rollback file empty and add a comment explaining why.
3. Run `autocontent-migrate up` locally to verify the migration applies cleanly.
4. Commit both files in the same PR as the application code that depends on
   the new schema.

## Migration file format

yoyo identifies migration files by their names. The expected format is:

```
NNNN_descriptive_name.sql
NNNN_descriptive_name.rollback.sql
```

Rollback files are automatically associated with their forward migration by
matching the base name (excluding `.rollback`).

## Tables

- `users` — Clerk-owned identity (PK is Clerk's `user_id`).
- `niches` — per-user content channels with generation prefs, posting
  windows, daily spend cap, and Ayrshare profile.
- `jobs` — one row per pipeline run; `payload` jsonb holds the full
  in-memory `Job` snapshot for resumability.
- `spend_ledger` — every credit-spending API call. Sum by
  `(user_id, niche_id, date)` to enforce the daily cap.
- `personal_access_tokens` — long-lived API tokens for CLI / MCP / agent use.
- `_yoyo_migration` — created automatically by yoyo; tracks applied
  migrations. Do not modify manually.
