-- 0026: company knowledge brain (opencompany-inspired).
--
-- Durable, verbatim spans the harness extracted from operator turns.
-- Jev cannot generate knowledge text — code slices the source, Jev only
-- classifies each span (brand_rule / constraint / decision / audience).
-- Injected into brand-voice / article tone as a prompt block.

create table if not exists company_knowledge (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    kind        text not null,
    span        text not null,
    source      text not null default '',
    confidence  double precision not null default 0,
    backend     text not null default '',
    created_at  timestamptz not null default now()
);

create index if not exists company_knowledge_user_created_idx
    on company_knowledge (user_id, created_at desc);

create index if not exists company_knowledge_user_kind_idx
    on company_knowledge (user_id, kind);
