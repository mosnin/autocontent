-- 0037: Tracker, the workspace's own tables (docs/tracker.md).
--
-- A marketing team tracks content, posts, A/B tests, campaigns, launches and
-- briefs in small typed tables with grid, board, calendar and gallery views.
-- Every table is tenant-scoped by user_id (the workspace's tenant id) like
-- every product table. Children carry user_id too and reference their parent
-- through (id, user_id), so a row, field or view can never point at another
-- workspace's table even if application code had a bug.
--
-- Cell values live in tracker_rows.data, a JSON object keyed by field id. The
-- shape of each value is validated in src/marketer/tracker/fields.py before it
-- is written. tracker_row_history keeps every change (append-only).

create table if not exists tracker_tables (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    name        text not null check (char_length(name) between 1 and 120),
    description text not null default '' check (char_length(description) <= 2000),
    -- the template key it was created from ('content_calendar', ...), null when blank
    template    text,
    created_by  text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (id, user_id)
);
create index if not exists tracker_tables_user_idx on tracker_tables (user_id, created_at);

create table if not exists tracker_fields (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null,
    table_id    uuid not null,
    name        text not null check (char_length(name) between 1 and 80),
    type        text not null check (type in (
                    'text', 'long_text', 'number', 'single_select', 'multi_select',
                    'date', 'checkbox', 'url', 'person', 'link_row', 'marketer_link')),
    -- type options: choices [{id,label,color}], decimals, include_time,
    -- table_id (link_row), kind (marketer_link)
    options     jsonb not null default '{}'::jsonb,
    position    integer not null default 0,
    is_primary  boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (id, user_id),
    unique (table_id, name),
    foreign key (table_id, user_id) references tracker_tables (id, user_id) on delete cascade
);
create index if not exists tracker_fields_table_idx on tracker_fields (table_id, position);
-- One primary field per table: the row's title everywhere.
create unique index if not exists tracker_fields_primary_idx on tracker_fields (table_id) where is_primary;

create table if not exists tracker_rows (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null,
    table_id    uuid not null,
    -- manual order; fractional so a move rewrites one row
    position    numeric not null default 0,
    data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
    created_by  text,
    updated_by  text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (id, user_id),
    foreign key (table_id, user_id) references tracker_tables (id, user_id) on delete cascade
);
create index if not exists tracker_rows_table_pos_idx on tracker_rows (table_id, position, created_at);
create index if not exists tracker_rows_user_idx on tracker_rows (user_id);

create table if not exists tracker_views (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null,
    table_id     uuid not null,
    name         text not null check (char_length(name) between 1 and 80),
    type         text not null check (type in ('grid', 'board', 'calendar', 'gallery')),
    -- group_field_id (board), date_field_id (calendar), card_field_ids, field_widths
    config       jsonb not null default '{}'::jsonb,
    filters      jsonb not null default '[]'::jsonb,
    filter_type  text not null default 'and' check (filter_type in ('and', 'or')),
    sorts        jsonb not null default '[]'::jsonb,
    hidden_fields jsonb not null default '[]'::jsonb,
    position     integer not null default 0,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    foreign key (table_id, user_id) references tracker_tables (id, user_id) on delete cascade
);
create index if not exists tracker_views_table_idx on tracker_views (table_id, position);

-- Every row change: who, when, what. Survives the row (no FK on row_id) so a
-- deleted row's history can still be read by its table's members.
create table if not exists tracker_row_history (
    id          bigserial primary key,
    user_id     text not null,
    table_id    uuid not null,
    row_id      uuid not null,
    action      text not null check (action in ('created', 'updated', 'deleted')),
    -- {field_id: {"before": v, "after": v}}
    changes     jsonb not null default '{}'::jsonb,
    actor_id    text,
    actor_type  text not null default 'user',
    at          timestamptz not null default now(),
    foreign key (table_id, user_id) references tracker_tables (id, user_id) on delete cascade
);
create index if not exists tracker_row_history_row_idx on tracker_row_history (row_id, at desc);
create index if not exists tracker_row_history_table_idx on tracker_row_history (table_id, at desc);

create or replace function tracker_history_append_only() returns trigger
language plpgsql as $$
begin
    -- A table delete cascades here; that is the only way rows leave.
    if tg_op = 'DELETE' and not exists (select 1 from tracker_tables where id = old.table_id) then
        return old;
    end if;
    raise exception 'tracker_row_history is append-only';
end;
$$;

drop trigger if exists tracker_row_history_no_update on tracker_row_history;
create trigger tracker_row_history_no_update before update on tracker_row_history
    for each row execute function tracker_history_append_only();
drop trigger if exists tracker_row_history_no_delete on tracker_row_history;
create trigger tracker_row_history_no_delete before delete on tracker_row_history
    for each row execute function tracker_history_append_only();
