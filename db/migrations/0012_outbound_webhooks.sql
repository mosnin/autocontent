-- 0012: outbound webhooks (event notifications to user-registered endpoints).
--
-- Lets an agent/agency register HTTPS endpoints that marketer.sh POSTs to
-- when content events occur (job.done, job.failed, job.awaiting_approval,
-- article.done, article.failed). Each delivery is HMAC-SHA256 signed with
-- the endpoint's secret so the receiver can verify authenticity.

create table if not exists webhook_endpoints (
    id             uuid primary key default gen_random_uuid(),
    user_id        text not null references users(id) on delete cascade,
    url            text not null,
    secret         text not null,               -- shown once on create; used for HMAC
    events         text[] not null default '{}', -- subscribed event names; empty = all
    enabled        boolean not null default true,
    description    text not null default '',
    last_status    integer,                      -- HTTP status of the last delivery
    last_delivery_at timestamptz,
    created_at     timestamptz not null default now()
);

create index if not exists webhook_endpoints_user_idx on webhook_endpoints(user_id);
create index if not exists webhook_endpoints_enabled_idx
    on webhook_endpoints(user_id) where enabled;
