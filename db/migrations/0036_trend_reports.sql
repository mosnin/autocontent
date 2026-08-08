-- 0036: trend research reports.
--
-- One row per research run for one niche: what themes are live, which
-- hooks open a loop on them, and which angles are worth making (each
-- already matched to a video format key from marketer.formats.registry).
--
-- `report` holds the whole TrendReport blob (themes, hooks, angles,
-- sources, notes) so the detail view is a single-row read and never
-- re-runs the research. The blob is the schema of record; only the two
-- things the LIST view needs are promoted to columns:
--
--   status    — the run is async (spawned on Modal), so the list view
--               shows queued/researching rows before a blob exists.
--   grounded  — false when Exa was unconfigured or failed and the
--               findings are model knowledge only. The UI must badge
--               those, and reading every blob to find one boolean is how
--               a list endpoint becomes a slow one.
--
-- Spend attribution rides on niche_id exactly like the video, article,
-- and design lanes: the one metered LLM call runs under a SpendContext
-- built from this niche, so per-niche caps, global caps, and prepaid
-- credit all apply with no new ledger column.

create table if not exists trend_reports (
    id         uuid primary key default gen_random_uuid(),
    user_id    text not null references users(id) on delete cascade,
    niche_id   uuid not null references niches(id) on delete cascade,
    -- queued | researching | done | failed
    status     text not null default 'queued'
               check (status in ('queued', 'researching', 'done', 'failed')),
    -- False until a run proves otherwise: an ungrounded report must
    -- never be able to *look* sourced because a write went missing.
    grounded   boolean not null default false,
    report     jsonb not null default '{}'::jsonb,
    error      text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- The list endpoint is always "this user's reports, newest first",
-- optionally narrowed to one niche.
create index if not exists trend_reports_user_idx
    on trend_reports (user_id, created_at desc);
create index if not exists trend_reports_niche_idx
    on trend_reports (niche_id, created_at desc);
-- The stale-run reaper scans non-terminal rows by last progress.
create index if not exists trend_reports_stale_idx
    on trend_reports (status, updated_at);
