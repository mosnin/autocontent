-- 0023: pluggable audio providers.
--
-- voice_provider: which TTS engine narrates this niche —
--   'openai' (stock gpt-4o-mini-tts) or 'elevenlabs' (premium voices,
--   requires MARKETER_ELEVENLABS_API_KEY + a voice id).
-- elevenlabs_voice_id: the ElevenLabs voice for this niche ('' = the
--   deploy's default voice).
-- music_provider: where background music comes from —
--   'auto'      generated when the key is configured, else library chain
--   'library'   local library -> Pixabay only (pre-0023 behavior)
--   'generated' ElevenLabs Music only (falls back to library on error)

alter table niches
    add column if not exists voice_provider text not null default 'openai',
    add column if not exists elevenlabs_voice_id text not null default '',
    add column if not exists music_provider text not null default 'auto';
