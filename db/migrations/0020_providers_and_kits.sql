-- 0020: pluggable providers + kits.
--
-- Providers: per-niche choice of animation backend (Grok Imagine or a
-- Fal-hosted model) and scriptwriter LLM (OpenRouter model id). Empty/
-- default values preserve stock behavior.
--
-- Kits: user-level reusable "skills" — instruction sets injected into
-- agent runtimes. kind='design' steers video direction (scriptwriter +
-- visual director), kind='writing' steers the article pipeline,
-- kind='ad' steers the ads optimization proposer (propose-only; the
-- fail-closed spend guard is untouched by kits).

alter table niches
    add column if not exists video_provider text not null default 'grok',
    add column if not exists fal_model text not null default '',
    add column if not exists script_model text not null default '';

create table if not exists kits (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    kind        text not null check (kind in ('design', 'ad', 'writing')),
    name        text not null,
    description text not null default '',
    -- The skill itself: free-form instructions the agent receives verbatim.
    content     text not null default '',
    -- Structured knobs (ad kits: target metrics/limits the optimizer
    -- honors when proposing, e.g. {"target_roas": 2.5, "max_cpa_usd": 30}).
    rules       jsonb not null default '{}'::jsonb,
    -- One default kit per (user, kind); the pipeline falls back to it
    -- when a niche doesn't pin a specific kit.
    is_default  boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists kits_user_kind_idx on kits (user_id, kind, created_at desc);
create unique index if not exists kits_one_default_per_kind
    on kits (user_id, kind) where is_default;

alter table niches
    add column if not exists design_kit_id uuid references kits(id) on delete set null,
    add column if not exists writing_kit_id uuid references kits(id) on delete set null;
