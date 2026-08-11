alter table niches
    drop column if exists design_kit_id,
    drop column if exists writing_kit_id,
    drop column if exists video_provider,
    drop column if exists fal_model,
    drop column if exists script_model;
drop table if exists kits;
