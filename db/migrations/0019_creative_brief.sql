-- 0019: Creative DNA — per-niche structured creative brief (hooks,
-- narrative voice, visual constraints, audio/caption styling, per-agent
-- prompt overrides). '{}' = platform defaults everywhere.
alter table niches
    add column if not exists creative_brief jsonb not null default '{}'::jsonb;
