-- 0034: brand personas — a persistent, conversable brand voice asset.
--
-- A brand_kit (0013) is the account's identity card: name, tone, banned
-- words, hashtags, accent color. One per user, flat, read by every
-- generator. A brand persona is the *speaker* layered on top of it: a
-- named character with backstory, greeting, explicit voice rules, a topic
-- blocklist, and a locked visual reference. Many per user. The persona
-- deliberately does NOT restate any brand-kit field — the chat prompt
-- renders the kit first, then the persona — so tone stays single-sourced.
--
-- Privacy: both tables carry user_id and FK-cascade from users(id), so
-- DELETE /users/me (repos.privacy.erase_user, which deletes the user row
-- and lets cascades do the rest) erases personas and every message. The
-- user_id on brand_persona_messages is also what makes the conversation
-- visible to the data-portability export, which discovers per-user tables
-- by looking for a user_id column.

create table if not exists brand_personas (
    id               uuid primary key default gen_random_uuid(),
    user_id          text not null references users(id) on delete cascade,
    -- Optional: attributes the persona's LLM/image spend to a niche and
    -- subjects it to that niche's daily cap. Null = global cap + prepaid
    -- credit only. set null (not cascade): archiving a niche must not
    -- destroy a brand asset that outlives it.
    niche_id         uuid references niches(id) on delete set null,

    name             text not null,
    tagline          text not null default '',
    -- Backstory / personality brief. Untrusted text: it is interpolated
    -- into a system prompt as fenced DATA, never as instructions.
    persona          text not null default '',
    greeting         text not null default '',
    voice_rules      text not null default '',
    banned_topics    text[] not null default '{}',

    -- Locked visual reference, produced by the existing character-sheet
    -- service. Write-once: the repo only stamps visual_locked_at when it
    -- is still null, so a persona's face cannot be swapped by a race or a
    -- later edit. A persona already used in published creative must keep
    -- looking like itself.
    visual_ref_path  text not null default '',
    visual_locked_at timestamptz,

    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists brand_personas_user_idx
    on brand_personas (user_id, created_at desc);
create index if not exists brand_personas_niche_idx
    on brand_personas (niche_id) where niche_id is not null;

create table if not exists brand_persona_messages (
    id         uuid primary key default gen_random_uuid(),
    persona_id uuid not null references brand_personas(id) on delete cascade,
    -- Denormalized owner. Two reasons, both deliberate: every read is
    -- ownership-scoped without a join, and the GDPR export finds this
    -- table automatically (it enumerates public tables having a user_id).
    user_id    text not null references users(id) on delete cascade,
    role       text not null check (role in ('user', 'assistant')),
    content    text not null,
    created_at timestamptz not null default now()
);

-- The conversation read path: newest-N for one persona, oldest-first after
-- reversal. id breaks ties for messages written in the same transaction
-- (a turn writes the user message and the reply at the same now()).
create index if not exists brand_persona_messages_thread_idx
    on brand_persona_messages (persona_id, created_at desc, id desc);
create index if not exists brand_persona_messages_user_idx
    on brand_persona_messages (user_id);
