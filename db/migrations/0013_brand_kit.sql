-- 0013: per-user brand kit — a reusable brand identity that seeds niche
-- drafts and keeps voice/style consistent across channels.
--
-- One kit per user (keyed on user_id). Multi-kit (per client, for agencies)
-- can layer on later with an id + a niche.brand_kit_id FK.

create table if not exists brand_kits (
    user_id            text primary key references users(id) on delete cascade,
    brand_name         text not null default '',
    tagline            text not null default '',
    tone_of_voice      text not null default '',   -- e.g. "warm, practical, no hype"
    target_audience    text not null default '',
    banned_words       text[] not null default '{}',
    preferred_hashtags text[] not null default '{}',
    color_hex          text not null default '',    -- brand accent, "#rrggbb"
    updated_at         timestamptz not null default now(),
    created_at         timestamptz not null default now()
);

drop trigger if exists brand_kits_updated_at on brand_kits;
create trigger brand_kits_updated_at before update on brand_kits
    for each row execute function set_updated_at();
