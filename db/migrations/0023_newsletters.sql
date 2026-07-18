-- 0023: newsletter digests -- per-user settings + generated digest history.
--
-- newsletter_settings: one row per user (upserted from
-- PUT /api/v1/newsletters/settings), governing whether the hourly
-- newsletter_cron (marketer.services.newsletter_cron, run from
-- press_growth_cron) composes+sends a periodic digest for them, on what
-- cadence, and to which address. send_to is intentionally allowed to stay
-- empty -- an empty value falls back to the account's users.email at send
-- time, so a users.email change never requires a settings backfill.
create table if not exists newsletter_settings (
    user_id       text primary key references users(id) on delete cascade,
    enabled       boolean not null default false,
    cadence       text not null default 'weekly'
                      check (cadence in ('weekly', 'biweekly', 'monthly')),
    send_to       text not null default '',
    last_sent_at  timestamptz
);

-- newsletter_digests: one row per composed digest. Created as 'draft'
-- (manual POST /newsletters/compose, or the cron's compose step) and
-- flipped to 'sent'/'failed' by services.newsletter.send -- mirroring the
-- always-record discipline article_publishes uses for publish attempts.
-- article_ids is the ordered set of done articles the digest links, kept
-- for audit/debugging even though the rendered markdown/html is the
-- durable copy actually mailed.
create table if not exists newsletter_digests (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null references users(id) on delete cascade,
    subject      text not null default '',
    markdown     text not null default '',
    html         text not null default '',
    article_ids  uuid[] not null default '{}',
    status       text not null default 'draft'
                     check (status in ('draft', 'sent', 'failed')),
    error        text not null default '',
    created_at   timestamptz not null default now(),
    sent_at      timestamptz
);

create index if not exists newsletter_digests_user_idx
    on newsletter_digests(user_id, created_at desc);
