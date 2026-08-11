-- 0030: saved cinematography selections.
--
-- The cinematography catalog (lenses, capture formats, apertures,
-- lighting, diffusion, color grades) and its twenty named presets live
-- in code (`marketer.cinema`) — they are product content that ships and
-- versions with the app, exactly like `marketer.style_presets`.
--
-- This table holds only what the *user* chose: a named combination of
-- catalog keys. We store the seven keys, never the rendered prompt
-- text, so improving a phrase in the catalog upgrades every saved
-- selection instead of leaving frozen strings behind.

create table if not exists cinema_presets (
    id         uuid primary key default gen_random_uuid(),
    user_id    text not null references users(id) on delete cascade,
    name       text not null,
    -- The named catalog preset this selection started from, when it
    -- did. Provenance only: nothing resolves through it, so retiring a
    -- preset key cannot break a saved row.
    preset_key text,
    -- {"format_key","lens_key","focal_mm","aperture_key",
    --  "lighting_key","diffusion_key","grade_key"}
    selection  jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Saving under an existing name overwrites it, which makes the save
-- button idempotent; this index is what the upsert conflicts on.
create unique index if not exists cinema_presets_user_name_idx
    on cinema_presets (user_id, name);
create index if not exists cinema_presets_user_recent_idx
    on cinema_presets (user_id, updated_at desc);
