alter table niches
    drop column if exists voice_provider,
    drop column if exists elevenlabs_voice_id,
    drop column if exists music_provider;
