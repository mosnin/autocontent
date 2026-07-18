-- 0020: keyword research — harvested keyword candidates for a niche's SEO
-- backlog (Team Keywords).
--
-- Lifecycle: candidate -> tracked | dismissed | promoted. Candidates are
-- seeded by POST /keywords/harvest (one metered LLM call per batch),
-- optionally difficulty-scored against live SERPs (POST
-- /keywords/{id}/score), and finally promoted into the press planner's
-- topic_proposals approval queue (POST /keywords/{id}/promote, migration
-- 0017) once they're worth writing about. Promotion is the only path out
-- of 'candidate'/'tracked' that hands off to another subsystem; dismiss is
-- a dead end.
--
-- Apply via the yoyo runner (marketer-migrate up).

create table if not exists keyword_candidates (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null references users(id) on delete cascade,
    niche_id     uuid not null references niches(id) on delete cascade,
    keyword      text not null,
    intent       text not null default '',
    -- 0-100 SERP-derived difficulty score. Null until POST .../score runs,
    -- and stays null when MARKETER_EXA_API_KEY isn't configured or the
    -- SERP fetch yields no pages — see keyword_research.score_difficulty,
    -- which treats "no signal" as null rather than guessing a difficulty.
    difficulty   numeric(5,2)
                     check (difficulty is null or (difficulty >= 0 and difficulty <= 100)),
    volume_hint  text not null default '',
    rationale    text not null default '',
    status       text not null default 'candidate'
                     check (status in ('candidate', 'tracked', 'dismissed', 'promoted')),
    created_at   timestamptz not null default now(),
    -- The harvester is asked to avoid repeats (existing keywords are
    -- listed in its prompt) but that's best-effort; this constraint is the
    -- real backstop. repos.keywords.create() upsert-skips on conflict
    -- (returns None) rather than raising, so a re-harvest that overlaps a
    -- prior batch just skips the dupes.
    unique (user_id, niche_id, keyword)
);

-- Every read path (GET /keywords, and the harvester's own dedupe lookup)
-- filters by (user_id, niche_id, status).
create index if not exists keyword_candidates_lookup_idx
    on keyword_candidates(user_id, niche_id, status);
