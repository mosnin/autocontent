-- 0038: per-niche video format selection.
--
-- video_format names one of the beat contracts in
-- src/marketer/formats/registry.py ('explainer', 'myth_buster',
-- 'what_if', 'listicle', 'tutorial', 'ugc_testimonial'). The scriptwriter
-- is given that format's beat structure, pacing math, and voice
-- direction, and the resulting script is graded against the same
-- contract offline.
--
-- Default is '' rather than 'explainer' on purpose. '' means "the caller
-- never chose", which `formats.resolve('')` maps to the default format —
-- so every existing niche keeps behaving exactly as it does today, and a
-- later change to which format is default does not silently rewrite the
-- stored intent of niches that predate this column.
--
-- Deliberately NOT a check constraint or an enum: the format catalog
-- lives in Python and gains entries there. A DB-side allowlist would
-- have to be migrated in lockstep with every new format, and drifting
-- out of lockstep would reject a format the application considers valid.
-- The API validates against the live catalog on write instead.

alter table niches
    add column if not exists video_format text not null default '';
