-- Custom characters: an optional per-niche description of the recurring
-- cast that steers the character/style reference sheet (and through it,
-- every scene keyframe).
alter table niches add column if not exists character_description text;
